-- Feedback sent from earprint.xyz/feedback/. Database: earprint-feedback (D1, Oceania).
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  kind TEXT NOT NULL CHECK (kind IN ('idea', 'bug', 'comment')),
  message TEXT NOT NULL,
  contact TEXT,          -- optional: how to reply, only if the person gave it
  page TEXT,             -- which page they came from
  details TEXT,          -- optional technical details (JSON), only if they ticked the box
  site TEXT,             -- earprint.xyz or a preview link
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created_at);
