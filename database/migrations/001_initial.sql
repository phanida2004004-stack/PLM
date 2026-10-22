PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoices(
 id TEXT PRIMARY KEY, invoice_no TEXT UNIQUE NOT NULL, invoice_date TEXT, etd TEXT, eta TEXT, etr TEXT, owner TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_items(
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), item_ref TEXT NOT NULL,
 sap_no TEXT NOT NULL, description TEXT NOT NULL, received_date TEXT, source_note TEXT,
 source_json TEXT NOT NULL, source_hash TEXT NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(invoice_id,item_ref)
);
CREATE INDEX IF NOT EXISTS item_invoice_idx ON invoice_items(invoice_id);
CREATE TABLE IF NOT EXISTS qc_results(
 item_id TEXT PRIMARY KEY REFERENCES invoice_items(id), raw_result TEXT, result TEXT, qc_date TEXT,
 direct_confirmed INTEGER NOT NULL DEFAULT 0, confirmed_by TEXT, reference TEXT
);
CREATE TABLE IF NOT EXISTS wo_records(
 item_id TEXT PRIMARY KEY REFERENCES invoice_items(id), wo_number TEXT, model TEXT,
 verified INTEGER NOT NULL DEFAULT 0, opened_at TEXT, opened_by TEXT, reference TEXT
);
CREATE TABLE IF NOT EXISTS follow_up_notes(
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES invoice_items(id), note TEXT NOT NULL,
 author TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_confirmations(
 item_id TEXT PRIMARY KEY REFERENCES invoice_items(id), payload_json TEXT NOT NULL,
 base_hash TEXT NOT NULL, author TEXT NOT NULL, reason TEXT NOT NULL, confirmed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_history(
 id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL,
 imported_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_history(
 id TEXT PRIMARY KEY, item_id TEXT, action TEXT NOT NULL, before_json TEXT, after_json TEXT,
 source TEXT NOT NULL, author TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_item_idx ON audit_history(item_id,created_at);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
