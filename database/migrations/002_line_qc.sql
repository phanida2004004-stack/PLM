
CREATE TABLE IF NOT EXISTS line_qc_messages (
    id TEXT PRIMARY KEY,
    line_message_id TEXT NOT NULL UNIQUE,
    group_id TEXT,
    raw_text TEXT NOT NULL,
    sap_no TEXT,
    lot_no TEXT,
    quantity INTEGER,
    qc_result TEXT,
    review_status TEXT NOT NULL DEFAULT 'pending',
    received_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS line_qc_status_idx
ON line_qc_messages(review_status, received_at);

CREATE INDEX IF NOT EXISTS line_qc_sap_idx
ON line_qc_messages(sap_no, lot_no);
