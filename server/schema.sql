-- MARSA v2 relational schema (SQLite). Each table stores the full record in `doc` (JSON) and exposes the
-- relational keys as generated, indexed columns.
-- Relationships:
--   users.org_id → organizations.id · users.port_id → ports.id · users.vessel_id → vessels.id
--   vessels.company_id → organizations.id · vessels.dest_id → ports.id
--   predictions.port_id → ports.id · closure_recs.port_id → ports.id
--   warnings.port_id → ports.id · warnings.replaces_id → warnings.id · hazards.warning_id → warnings.id
--   deliveries.warning_id → warnings.id · deliveries.vessel_id → vessels.id
--   recs.vessel_id → vessels.id · recs.warning_id → warnings.id
--   decisions.ref_id → closureRecs.id | warnings.id | recs.id | ports.id · notices.decision_id → decisions.id
--   notifications (audience: roles, port_id, vessel_id, company_id, user_id) · integrationLogs.integration_id → integrations.id
--   audit: append-only hash chain (prev_hash → hash)
CREATE TABLE IF NOT EXISTS meta          (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings      (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, doc TEXT NOT NULL, kind TEXT GENERATED ALWAYS AS (json_extract(doc,'$.kind')) VIRTUAL);
CREATE TABLE IF NOT EXISTS users         (id TEXT PRIMARY KEY, doc TEXT NOT NULL,
  username TEXT GENERATED ALWAYS AS (json_extract(doc,'$.username')) VIRTUAL, role TEXT GENERATED ALWAYS AS (json_extract(doc,'$.role')) VIRTUAL,
  org_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.orgId')) VIRTUAL, port_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.portId')) VIRTUAL,
  vessel_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.vesselId')) VIRTUAL);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users(username);
CREATE TABLE IF NOT EXISTS ports         (id TEXT PRIMARY KEY, doc TEXT NOT NULL, status TEXT GENERATED ALWAYS AS (json_extract(doc,'$.status')) VIRTUAL, country TEXT GENERATED ALWAYS AS (json_extract(doc,'$.country')) VIRTUAL);
CREATE TABLE IF NOT EXISTS stations      (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vessels       (id TEXT PRIMARY KEY, doc TEXT NOT NULL, mmsi TEXT GENERATED ALWAYS AS (json_extract(doc,'$.mmsi')) VIRTUAL,
  imo TEXT GENERATED ALWAYS AS (json_extract(doc,'$.imo')) VIRTUAL, company_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.companyId')) VIRTUAL, dest_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.destId')) VIRTUAL);
CREATE UNIQUE INDEX IF NOT EXISTS ux_vessels_mmsi ON vessels(mmsi);
CREATE INDEX IF NOT EXISTS ix_vessels_company ON vessels(company_id);
CREATE TABLE IF NOT EXISTS trucks        (id TEXT PRIMARY KEY, doc TEXT NOT NULL, company_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.companyId')) VIRTUAL, port_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.portId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS met           (id TEXT PRIMARY KEY, doc TEXT NOT NULL, point_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.pointId')) VIRTUAL, received_at INTEGER GENERATED ALWAYS AS (json_extract(doc,'$.receivedAt')) VIRTUAL);
CREATE INDEX IF NOT EXISTS ix_met_point_time ON met(point_id, received_at);
CREATE TABLE IF NOT EXISTS forecasts     (id TEXT PRIMARY KEY, doc TEXT NOT NULL, issued_at INTEGER GENERATED ALWAYS AS (json_extract(doc,'$.issuedAt')) VIRTUAL);
CREATE TABLE IF NOT EXISTS predictions   (id TEXT PRIMARY KEY, doc TEXT NOT NULL, port_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.portId')) VIRTUAL, category TEXT GENERATED ALWAYS AS (json_extract(doc,'$.category')) VIRTUAL, severity TEXT GENERATED ALWAYS AS (json_extract(doc,'$.severity')) VIRTUAL);
CREATE TABLE IF NOT EXISTS timelines     (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hazards       (id TEXT PRIMARY KEY, doc TEXT NOT NULL, status TEXT GENERATED ALWAYS AS (json_extract(doc,'$.status')) VIRTUAL, warning_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.warningId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS closureRecs   (id TEXT PRIMARY KEY, doc TEXT NOT NULL, number TEXT GENERATED ALWAYS AS (json_extract(doc,'$.number')) VIRTUAL, port_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.portId')) VIRTUAL, status TEXT GENERATED ALWAYS AS (json_extract(doc,'$.status')) VIRTUAL);
CREATE TABLE IF NOT EXISTS warnings      (id TEXT PRIMARY KEY, doc TEXT NOT NULL, number TEXT GENERATED ALWAYS AS (json_extract(doc,'$.number')) VIRTUAL, level TEXT GENERATED ALWAYS AS (json_extract(doc,'$.level')) VIRTUAL,
  status TEXT GENERATED ALWAYS AS (json_extract(doc,'$.status')) VIRTUAL, port_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.portId')) VIRTUAL, official_ref TEXT GENERATED ALWAYS AS (json_extract(doc,'$.officialRef')) VIRTUAL, replaces_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.replacesId')) VIRTUAL);
CREATE UNIQUE INDEX IF NOT EXISTS ux_warnings_number ON warnings(number);
CREATE TABLE IF NOT EXISTS deliveries    (id TEXT PRIMARY KEY, doc TEXT NOT NULL, warning_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.warningId')) VIRTUAL, vessel_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.vesselId')) VIRTUAL, status TEXT GENERATED ALWAYS AS (json_extract(doc,'$.status')) VIRTUAL);
CREATE INDEX IF NOT EXISTS ix_deliveries_warning ON deliveries(warning_id);
CREATE TABLE IF NOT EXISTS recs          (id TEXT PRIMARY KEY, doc TEXT NOT NULL, number TEXT GENERATED ALWAYS AS (json_extract(doc,'$.number')) VIRTUAL, vessel_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.vesselId')) VIRTUAL, status TEXT GENERATED ALWAYS AS (json_extract(doc,'$.status')) VIRTUAL, warning_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.warningId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS decisions     (id TEXT PRIMARY KEY, doc TEXT NOT NULL, number TEXT GENERATED ALWAYS AS (json_extract(doc,'$.number')) VIRTUAL, kind TEXT GENERATED ALWAYS AS (json_extract(doc,'$.kind')) VIRTUAL, ref_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.refId')) VIRTUAL, by_user TEXT GENERATED ALWAYS AS (json_extract(doc,'$.by')) VIRTUAL, at INTEGER GENERATED ALWAYS AS (json_extract(doc,'$.at')) VIRTUAL);
CREATE INDEX IF NOT EXISTS ix_decisions_ref ON decisions(ref_id);
CREATE TRIGGER IF NOT EXISTS decisions_no_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT, 'decisions are immutable'); END;
CREATE TABLE IF NOT EXISTS notices       (id TEXT PRIMARY KEY, doc TEXT NOT NULL, decision_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.decisionId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, doc TEXT NOT NULL, category TEXT GENERATED ALWAYS AS (json_extract(doc,'$.category')) VIRTUAL, created_at INTEGER GENERATED ALWAYS AS (json_extract(doc,'$.createdAt')) VIRTUAL);
CREATE TABLE IF NOT EXISTS bulletins     (id TEXT PRIMARY KEY, doc TEXT NOT NULL, number TEXT GENERATED ALWAYS AS (json_extract(doc,'$.number')) VIRTUAL, status TEXT GENERATED ALWAYS AS (json_extract(doc,'$.status')) VIRTUAL);
CREATE TABLE IF NOT EXISTS integrations  (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS integrationLogs (id TEXT PRIMARY KEY, doc TEXT NOT NULL, integration_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.integrationId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS audit         (id TEXT PRIMARY KEY, doc TEXT NOT NULL, seq INTEGER GENERATED ALWAYS AS (json_extract(doc,'$.seq')) VIRTUAL, ts INTEGER GENERATED ALWAYS AS (json_extract(doc,'$.ts')) VIRTUAL,
  actor TEXT GENERATED ALWAYS AS (json_extract(doc,'$.actor')) VIRTUAL, action TEXT GENERATED ALWAYS AS (json_extract(doc,'$.action')) VIRTUAL, entity_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.entityId')) VIRTUAL, hash TEXT GENERATED ALWAYS AS (json_extract(doc,'$.hash')) VIRTUAL);
CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit(ts);
-- Audit log is append-only at the database level (in addition to the application hash chain).
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit WHEN (SELECT COUNT(*) FROM meta) > 0 AND NOT EXISTS (SELECT 1 FROM meta WHERE json_extract(doc,'$.resetting') = 1) BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
