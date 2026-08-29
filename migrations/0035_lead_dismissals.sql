-- 0035_lead_dismissals.sql
-- When an advisor chooses "No quote" on an open client request, record it so the
-- lead is hidden from that advisor's portal permanently. Other advisors are
-- unaffected. One row per (advisor, request).
CREATE TABLE IF NOT EXISTS advisor_lead_dismissals (
  advisor_id       TEXT NOT NULL,
  quote_request_id TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (advisor_id, quote_request_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_dismissals_advisor
  ON advisor_lead_dismissals (advisor_id);
