PRAGMA foreign_keys = ON;
CREATE TABLE exams (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 deadline TEXT, min_size INTEGER NOT NULL DEFAULT 1 CHECK(min_size BETWEEN 1 AND 20),
 max_size INTEGER NOT NULL DEFAULT 5 CHECK(max_size BETWEEN min_size AND 20),
 allow_replace INTEGER NOT NULL DEFAULT 1 CHECK(allow_replace IN (0,1)),
 version INTEGER NOT NULL DEFAULT 0, reference_version INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE reference_versions (
 exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, filename TEXT NOT NULL, digest TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(exam_id,version)
);
CREATE TABLE reference_records (
 exam_id TEXT NOT NULL, version INTEGER NOT NULL, row_id INTEGER NOT NULL, result INTEGER NOT NULL,
 PRIMARY KEY(exam_id,version,row_id),
 FOREIGN KEY(exam_id,version) REFERENCES reference_versions(exam_id,version) ON DELETE CASCADE
);
CREATE TABLE exam_students (
 id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
 full_name TEXT NOT NULL, student_number TEXT NOT NULL,
 credential TEXT NOT NULL, national_fingerprint TEXT NOT NULL,
 authorized INTEGER NOT NULL DEFAULT 1 CHECK(authorized IN (0,1)), created_at TEXT NOT NULL,
 UNIQUE(exam_id,student_number), UNIQUE(exam_id,national_fingerprint), UNIQUE(exam_id,id)
);
CREATE TABLE groups (
 id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
 name TEXT NOT NULL, name_key TEXT NOT NULL, leader_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','locked')),
 created_at TEXT NOT NULL, UNIQUE(exam_id,name_key), UNIQUE(exam_id,id),
 FOREIGN KEY(exam_id,leader_id) REFERENCES exam_students(exam_id,id)
);
CREATE TABLE group_members (
 exam_id TEXT NOT NULL, group_id TEXT NOT NULL, student_id TEXT NOT NULL,
 PRIMARY KEY(exam_id,student_id), UNIQUE(group_id,student_id),
 FOREIGN KEY(exam_id,group_id) REFERENCES groups(exam_id,id) ON DELETE CASCADE,
 FOREIGN KEY(exam_id,student_id) REFERENCES exam_students(exam_id,id)
);
CREATE INDEX members_by_group ON group_members(group_id);
CREATE TABLE submissions (
 id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, group_id TEXT NOT NULL,
 uploaded_by TEXT NOT NULL, reference_version INTEGER NOT NULL,
 filename TEXT NOT NULL, size INTEGER NOT NULL, digest TEXT NOT NULL, submitted_at TEXT NOT NULL,
 FOREIGN KEY(exam_id,group_id) REFERENCES groups(exam_id,id) ON DELETE CASCADE,
 FOREIGN KEY(exam_id,uploaded_by) REFERENCES exam_students(exam_id,id),
 FOREIGN KEY(exam_id,reference_version) REFERENCES reference_versions(exam_id,version)
);
CREATE INDEX submissions_by_group ON submissions(group_id,submitted_at);
CREATE TABLE submission_records (
 submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 row_id INTEGER NOT NULL, result INTEGER NOT NULL, PRIMARY KEY(submission_id,row_id)
);
CREATE TABLE evaluation_results (
 submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
 correct INTEGER NOT NULL, total INTEGER NOT NULL CHECK(total>0),
 final_score REAL NOT NULL CHECK(final_score BETWEEN 0 AND 100),
 engine TEXT NOT NULL, evaluated_at TEXT NOT NULL
);
CREATE TABLE current_submissions (
 group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
 submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, exam_id TEXT NOT NULL, student_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 FOREIGN KEY(exam_id,student_id) REFERENCES exam_students(exam_id,id) ON DELETE CASCADE
);
CREATE INDEX session_expiry ON sessions(expires_at);
CREATE TABLE imports (
 id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
 admin_uid TEXT NOT NULL, digest TEXT NOT NULL, total INTEGER NOT NULL,
 base_version INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE import_rows (
 import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, student_id TEXT NOT NULL, full_name TEXT NOT NULL,
 student_number TEXT NOT NULL, credential TEXT NOT NULL, national_fingerprint TEXT NOT NULL,
 PRIMARY KEY(import_id,position), UNIQUE(import_id,student_number), UNIQUE(import_id,national_fingerprint)
);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX rate_expiry ON rate_limits(expires_at);
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY, admin_uid TEXT NOT NULL, exam_id TEXT,
 action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX audit_by_exam ON audit_logs(exam_id,created_at);
-- Assertions live only inside atomic D1 batches; a failed CHECK rolls back the batch.
CREATE TABLE transaction_assertions (ok INTEGER NOT NULL CHECK(ok=1));
