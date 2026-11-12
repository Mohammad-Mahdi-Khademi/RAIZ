CREATE TABLE site_admins (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 credential TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE admin_sessions (
 token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES site_admins(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX admin_session_expiry ON admin_sessions(expires_at);
CREATE TABLE site_state (key TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE site_content (
 key TEXT PRIMARY KEY CHECK(key IN ('about','projects','apply','contact','publications')),
 en TEXT NOT NULL, fa TEXT NOT NULL, updated_at TEXT NOT NULL
);
