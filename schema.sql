-- D1 schema for DFD Checks

CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  stationId TEXT NOT NULL,
  apparatusId TEXT NOT NULL,
  checkType TEXT NOT NULL,
  submitter TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  summary TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checks_ts ON checks(timestamp);
CREATE INDEX IF NOT EXISTS idx_checks_station ON checks(stationId);
CREATE INDEX IF NOT EXISTS idx_checks_apparatus ON checks(apparatusId);
CREATE INDEX IF NOT EXISTS idx_checks_type ON checks(checkType);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  created_ts TEXT NOT NULL,
  updated_ts TEXT NOT NULL,
  stationId TEXT NOT NULL,
  apparatusId TEXT NOT NULL,
  text TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL,      -- 'open' or 'cleared'
  cleared_ts TEXT,
  cleared_by TEXT,
  ack_ts TEXT,
  ack_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_issues_station_ap ON issues(stationId, apparatusId);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);

CREATE TABLE IF NOT EXISTS weekly_config (
  checkKey TEXT PRIMARY KEY,
  weekday TEXT NOT NULL,
  updated_ts TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_recipients (
  groupKey TEXT PRIMARY KEY,
  emails_json TEXT NOT NULL,
  updated_ts TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drug_master (
  unit TEXT NOT NULL,
  drug_name TEXT NOT NULL,
  last_known_exp TEXT NOT NULL,
  last_qty INTEGER,
  updated_ts TEXT NOT NULL,
  PRIMARY KEY (unit, drug_name)
);

