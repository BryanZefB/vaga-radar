-- Public career board verified during deployment preparation.
INSERT OR IGNORE INTO sources(provider,slug,company)
VALUES ('greenhouse','gympass','Wellhub');
-- The suggested board returned HTTP 404; do not keep retrying it.
UPDATE sources SET enabled=0 WHERE provider='lever' AND slug='truelogic';
