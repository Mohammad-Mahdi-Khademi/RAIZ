CREATE TABLE portal_members (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, login TEXT NOT NULL UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('student','admin')),
 active INTEGER NOT NULL CHECK(active IN (0,1)), credential TEXT,
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE portal_equipment (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL,
 holder TEXT REFERENCES portal_members(id), version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL
);
CREATE TABLE portal_logs (
 id TEXT PRIMARY KEY, equipment_id TEXT NOT NULL, user_id TEXT NOT NULL,
 equipment TEXT NOT NULL, student TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('borrow','return')), created_at TEXT NOT NULL
);
CREATE INDEX portal_logs_recent ON portal_logs(created_at);
CREATE TABLE portal_sessions (
 token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES portal_members(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX portal_session_expiry ON portal_sessions(expires_at);
CREATE TABLE portal_state (id INTEGER PRIMARY KEY CHECK(id=1), initialized_at TEXT NOT NULL);
