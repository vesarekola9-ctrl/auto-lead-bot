require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const path = require("path");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const { initDb } = require("./db");

const app = express();
const db = initDb();

app.use(
  helmet({
    contentSecurityPolicy: false // MVP: helpottaa widgetin upotusta. Kiristä myöhemmin.
  })
);
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.SESSION_SECRET || "dev_secret"));

app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/views", express.static(path.join(__dirname, "views")));

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// --- Simple auth (MVP) ---
function signSession(payload) {
  const raw = JSON.stringify(payload);
  const sig = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "dev_secret")
    .update(raw)
    .digest("hex");
  return Buffer.from(raw).toString("base64") + "." + sig;
}

function verifySession(token) {
  if (!token || !token.includes(".")) return null;
  const [b64, sig] = token.split(".");
  const raw = Buffer.from(b64, "base64").toString("utf8");
  const expected = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "dev_secret")
    .update(raw)
    .digest("hex");
  if (sig !== expected) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const token = req.signedCookies?.session;
  const sess = verifySession(token);
  if (!sess || sess.role !== "admin") return res.redirect("/admin/login");
  req.admin = sess;
  next();
}

// --- Rate limit liidipostille ---
const leadLimiter = new RateLimiterMemory({ points: 10, duration: 60 }); // 10/min per IP

// --- Email transporter (optional) ---
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  if (!host || !user) return null;
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user, pass: process.env.SMTP_PASS }
  });
  return transporter;
}

function tenantById(tenantId) {
  return db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
}

function listLeads(tenantId) {
  return db
    .prepare("SELECT * FROM leads WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 500")
    .all(tenantId);
}

function insertLead(lead) {
  const stmt = db.prepare(`
    INSERT INTO leads
      (tenant_id, created_at, customer_name, phone, email, car_interest, budget, tradein, preferred_time, notes, source_url, status)
    VALUES
      (@tenant_id, @created_at, @customer_name, @phone, @email, @car_interest, @budget, @tradein, @preferred_time, @notes, @source_url, 'new')
  `);
  return stmt.run(lead).lastInsertRowid;
}

// --- Pages ---
app.get("/", (req, res) => {
  res
    .type("text/plain")
    .send("Auto Lead Bot running.\n\nAdmin: /admin\nWidget script: /public/widget.js\n");
});

app.get("/admin/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.post("/admin/login", (req, res) => {
  const u = req.body.user || "";
  const p = req.body.pass || "";
  if (u === (process.env.ADMIN_USER || "admin") && p === (process.env.ADMIN_PASS || "admin123")) {
    const token = signSession({ role: "admin", user: u, at: Date.now() });
    res.cookie("session", token, { signed: true, httpOnly: true, sameSite: "lax" });
    return res.redirect("/admin");
  }
  return res.status(401).send("Väärä käyttäjä/tunnus. <a href='/admin/login'>Takaisin</a>");
});

app.get("/admin/logout", (req, res) => {
  res.clearCookie("session");
  res.redirect("/admin/login");
});

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});

// --- Admin API ---
app.get("/api/admin/tenants", requireAdmin, (req, res) => {
  const tenants = db.prepare("SELECT * FROM tenants ORDER BY created_at DESC").all();
  res.json({ tenants });
});

app.post("/api/admin/tenants", requireAdmin, (req, res) => {
  const id = String(req.body.id || "").trim();
  const name = String(req.body.name || "").trim();
  const notify_email = String(req.body.notify_email || "").trim() || null;

  if (!id || !/^[a-zA-Z0-9_-]{2,40}$/.test(id)) {
    return res.status(400).json({ error: "Tenant id virheellinen (sallitut: a-zA-Z0-9_- 2..40)" });
  }
  if (!name) return res.status(400).json({ error: "Nimi puuttuu" });

  const exists = tenantById(id);
  if (exists) return res.status(409).json({ error: "Tenant id on jo käytössä" });

  db.prepare("INSERT INTO tenants (id, name, notify_email, created_at) VALUES (?, ?, ?, ?)")
    .run(id, name, notify_email, new Date().toISOString());

  res.json({ ok: true });
});

app.get("/api/admin/leads", requireAdmin, (req, res) => {
  const tenantId = String(req.query.tenant || "demo");
  const tenant = tenantById(tenantId);
  if (!tenant) return res.status(404).json({ error: "Tenant ei löydy" });
  const leads = listLeads(tenantId);
  res.json({ tenant, leads });
});

app.post("/api/admin/leads/:id/status", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || "").trim();
  if (!["new", "contacted", "won", "lost"].includes(status)) {
    return res.status(400).json({ error: "Virheellinen status" });
  }
  db.prepare("UPDATE leads SET status = ? WHERE id = ?").run(status, id);
  res.json({ ok: true });
});

// --- Public API: submit lead ---
app.post("/api/lead", async (req, res) => {
  try {
    await leadLimiter.consume(req.ip);
  } catch {
    return res.status(429).json({ error: "Liian monta pyyntöä. Yritä kohta uudelleen." });
  }

  const tenant_id = String(req.body.tenant || "").trim();
  const tenant = tenantById(tenant_id);
  if (!tenant) return res.status(404).json({ error: "Tuntematon autoliike (tenant)" });

  const lead = {
    tenant_id,
    created_at: new Date().toISOString(),
    customer_name: String(req.body.name || "").trim().slice(0, 120),
    phone: String(req.body.phone || "").trim().slice(0, 50),
    email: String(req.body.email || "").trim().slice(0, 120),
    car_interest: String(req.body.car || "").trim().slice(0, 200),
    budget: String(req.body.budget || "").trim().slice(0, 80),
    tradein: String(req.body.tradein || "").trim().slice(0, 200),
    preferred_time: String(req.body.time || "").trim().slice(0, 120),
    notes: String(req.body.notes || "").trim().slice(0, 500),
    source_url: String(req.body.source_url || "").trim().slice(0, 500)
  };

  if (!lead.phone && !lead.email) {
    return res.status(400).json({ error: "Anna puhelin tai sähköposti." });
  }
  if (!lead.car_interest) {
    return res.status(400).json({ error: "Mitä autoa olet kiinnostunut? (malli / tyyppi)" });
  }

  const leadId = insertLead(lead);

  // Email notify (optional)
  const to = tenant.notify_email || process.env.DEFAULT_NOTIFY_EMAIL;
  const t = getTransporter();
  if (to && t) {
    const subject = `Uusi koeajopyyntö / liidi (${tenant.name})`;
    const text =
`UUSI LIIDI (#${leadId}) - ${tenant.name}

Nimi: ${lead.customer_name || "-"}
Puhelin: ${lead.phone || "-"}
Email: ${lead.email || "-"}
Kiinnostus: ${lead.car_interest}
Budjetti: ${lead.budget || "-"}
Vaihtoauto: ${lead.tradein || "-"}
Toivottu aika: ${lead.preferred_time || "-"}
Lisätiedot: ${lead.notes || "-"}
Lähde: ${lead.source_url || "-"}

Admin: ${BASE_URL}/admin (tenant: ${tenant_id})
`;
    try {
      await t.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        text
      });
    } catch (e) {
      console.error("Email send failed:", e?.message || e);
    }
  }

  res.json({ ok: true, leadId });
});

// --- Widget config endpoint ---
app.get("/api/widget-config", (req, res) => {
  const tenantId = String(req.query.tenant || "").trim();
  const tenant = tenantById(tenantId);
  if (!tenant) return res.status(404).json({ error: "Tuntematon tenant" });

  res.json({
    tenant: { id: tenant.id, name: tenant.name },
    labels: {
      title: "Varaa koeajo",
      subtitle: "30 sekunnissa",
      cta: "Aloita",
      send: "Lähetä",
      done: "Kiitos! Myyjä ottaa yhteyttä pian."
    }
  });
});

app.listen(PORT, () => {
  console.log(`Auto Lead Bot listening on ${BASE_URL}`);
});
