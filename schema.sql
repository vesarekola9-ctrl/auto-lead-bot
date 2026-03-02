PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notify_email TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  customer_name TEXT,
  phone TEXT,
  email TEXT,
  car_interest TEXT,
  budget TEXT,
  tradein TEXT,
  preferred_time TEXT,
  notes TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_created ON leads(tenant_id, created_at);
