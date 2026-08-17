PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  country TEXT,
  start_date TEXT,
  end_date TEXT,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('OWNER','EDITOR','VIEWER')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_members_trip ON members(trip_id);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_member ON device_tokens(member_id);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('EDITOR','VIEWER')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_invites_trip ON invites(trip_id);

CREATE TABLE IF NOT EXISTS daily_rates (
  day TEXT NOT NULL,
  pair TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(day,pair)
);

CREATE TABLE IF NOT EXISTS shared_locations (
  member_id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  shared_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_shared_locations_trip ON shared_locations(trip_id);
