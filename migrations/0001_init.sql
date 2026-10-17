CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), profile TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES (1, '{"roles":[],"skills":[],"exclude":[],"levels":[],"contracts":["CLT","PJ","Estágio"],"minSalary":0}');
CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL CHECK(provider IN ('lever','greenhouse')), slug TEXT NOT NULL, company TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_sync TEXT, error TEXT, UNIQUE(provider,slug));
INSERT OR IGNORE INTO sources(provider,slug,company) VALUES ('greenhouse','nubank','Nubank'),('lever','cloudwalk','CloudWalk'),('lever','truelogic','Truelogic');
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, source_id INTEGER NOT NULL, title TEXT NOT NULL, company TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, workplace TEXT NOT NULL, published TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(source_id) REFERENCES sources(id));
CREATE INDEX IF NOT EXISTS jobs_active ON jobs(active,first_seen);
CREATE TABLE IF NOT EXISTS saved (job_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('saved','applied','hidden')), updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_limits (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL);
