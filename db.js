const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.sqlite");

function initDb() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);

  // Seed: yksi demotenant jos ei ole
  const count = db.prepare("SELECT COUNT(*) as c FROM tenants").get().c;
  if (count === 0) {
    db.prepare(
      "INSERT INTO tenants (id, name, notify_email, created_at) VALUES (?, ?, ?, ?)"
    ).run(
      "demo",
      "Demo Autoliike",
      process.env.DEFAULT_NOTIFY_EMAIL || null,
      new Date().toISOString()
    );
  }

  return db;
}

module.exports = { initDb };
