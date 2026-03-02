(function () {
  const script = document.currentScript;
  const tenant = script.getAttribute("data-tenant") || "demo";
  const base = script.getAttribute("data-base") || location.origin;

  const style = document.createElement("style");
  style.textContent = `
  .alb-btn{position:fixed;right:18px;bottom:18px;z-index:999999;border:0;border-radius:999px;padding:14px 16px;font-family:system-ui,Segoe UI,Arial;font-weight:700;box-shadow:0 10px 28px rgba(0,0,0,.18);cursor:pointer}
  .alb-box{position:fixed;right:18px;bottom:76px;z-index:999999;width:340px;max-width:calc(100vw - 36px);border-radius:16px;overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.22);font-family:system-ui,Segoe UI,Arial;background:#fff;display:none}
  .alb-h{padding:14px 14px 10px;background:#111;color:#fff;position:relative}
  .alb-h .t{font-size:14px;font-weight:800}
  .alb-h .s{opacity:.85;font-size:12px;margin-top:2px}
  .alb-b{padding:12px 14px}
  .alb-row{display:flex;gap:8px}
  .alb-i{width:100%;padding:10px 10px;border:1px solid #e5e5e5;border-radius:10px;font-size:13px}
  .alb-l{font-size:12px;color:#333;margin:10px 0 6px}
  .alb-send{width:100%;margin-top:10px;border:0;border-radius:12px;padding:12px;font-weight:800;cursor:pointer}
  .alb-msg{font-size:12px;margin-top:10px;line-height:1.35}
  .alb-x{position:absolute;right:10px;top:10px;border:0;background:transparent;color:#fff;font-size:18px;cursor:pointer}
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.className = "alb-btn";
  btn.textContent = "Varaa koeajo";
  btn.style.background = "#111";
  btn.style.color = "#fff";
  document.body.appendChild(btn);

  const box = document.createElement("div");
  box.className = "alb-box";
  box.innerHTML = `
    <div class="alb-h">
      <button class="alb-x" aria-label="Sulje">×</button>
      <div class="t">Varaa koeajo</div>
      <div class="s">30 sekunnissa</div>
    </div>
    <div class="alb-b">
      <div class="alb-l">Mistä autosta olet kiinnostunut?</div>
      <input class="alb-i" id="alb_car" placeholder="Esim. VW Golf 2019 / farmari / automaatti" />

      <div class="alb-l">Budjetti (valinnainen)</div>
      <input class="alb-i" id="alb_budget" placeholder="Esim. 15 000 € tai 250 €/kk" />

      <div class="alb-l">Vaihtoauto (valinnainen)</div>
      <input class="alb-i" id="alb_tradein" placeholder="Esim. Toyota Auris 2012, 180tkm" />

      <div class="alb-l">Toivottu aika koeajolle (valinnainen)</div>
      <input class="alb-i" id="alb_time" placeholder="Esim. huomenna klo 17 / lauantai" />

      <div class="alb-l">Yhteystiedot (puhelin tai email)</div>
      <div class="alb-row">
        <input class="alb-i" id="alb_name" placeholder="Nimi" />
      </div>
      <div class="alb-row" style="margin-top:8px">
        <input class="alb-i" id="alb_phone" placeholder="Puhelin" />
        <input class="alb-i" id="alb_email" placeholder="Email" />
      </div>

      <div class="alb-l">Lisätiedot (valinnainen)</div>
      <input class="alb-i" id="alb_notes" placeholder="Esim. haluan automaatin, mieluiten alle 120tkm" />

      <button class="alb-send" id="alb_send" style="background:#111;color:#fff">Lähetä</button>
      <div class="alb-msg" id="alb_msg"></div>
    </div>
  `;
  document.body.appendChild(box);

  const $ = (sel) => box.querySelector(sel);

  function toggle(open) {
    box.style.display = open ? "block" : "none";
  }

  btn.addEventListener("click", () => toggle(true));
  $(".alb-x").addEventListener("click", () => toggle(false));

  async function loadConfig() {
    try {
      const r = await fetch(`${base}/api/widget-config?tenant=${encodeURIComponent(tenant)}`);
      const j = await r.json();
      if (j?.tenant?.name) {
        box.querySelector(".alb-h .t").textContent = j.labels?.title || "Varaa koeajo";
        box.querySelector(".alb-h .s").textContent = j.tenant.name;
        btn.textContent = j.labels?.title || "Varaa koeajo";
      }
    } catch {}
  }

  $("#alb_send").addEventListener("click", async () => {
    const payload = {
      tenant,
      car: $("#alb_car").value,
      budget: $("#alb_budget").value,
      tradein: $("#alb_tradein").value,
      time: $("#alb_time").value,
      name: $("#alb_name").value,
      phone: $("#alb_phone").value,
      email: $("#alb_email").value,
      notes: $("#alb_notes").value,
      source_url: location.href
    };

    $("#alb_msg").textContent = "Lähetetään...";
    $("#alb_send").disabled = true;

    try {
      const r = await fetch(`${base}/api/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Virhe");
      $("#alb_msg").textContent = "Kiitos! Myyjä ottaa yhteyttä pian.";
      $("#alb_send").textContent = "Lähetetty";
    } catch (e) {
      $("#alb_msg").textContent = e.message || "Virhe. Yritä uudelleen.";
      $("#alb_send").disabled = false;
    }
  });

  loadConfig();
})();
