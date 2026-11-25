-- MARSA v4 schema (SQLite) for the TEST DATA environment. Each table stores the full record in `doc` (JSON)
-- and exposes relational keys as generated, indexed columns.
-- Relationships:
--   users.vessel_id → vessels.id · vessels.dest_id/origin_id → ports.id
--   weatherObservations.area_id / weatherForecasts.area_id → seaAreas.id
--   maritimeRisks.area_id → seaAreas.id · affectedVessels.risk_id → maritimeRisks.id, .vessel_id → vessels.id
--   alerts.risk_id → maritimeRisks.id · deliveryRecords.alert_id → alerts.id, .vessel_id → vessels.id
--   alternativeRoutes.vessel_id → vessels.id, .risk_id → maritimeRisks.id, .alert_id → alerts.id
--   bulletins.risk_id → maritimeRisks.id · navtexMessages.bulletin_id → bulletins.id
--   auditLogs: append-only hash chain (prev_hash → hash)
CREATE TABLE IF NOT EXISTS meta                (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings            (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users               (id TEXT PRIMARY KEY, doc TEXT NOT NULL, role TEXT GENERATED ALWAYS AS (json_extract(doc,'$.role')) VIRTUAL, vessel_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.vesselId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS seaAreas            (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ports               (id TEXT PRIMARY KEY, doc TEXT NOT NULL, status TEXT GENERATED ALWAYS AS (json_extract(doc,'$.status')) VIRTUAL);
CREATE TABLE IF NOT EXISTS vessels             (id TEXT PRIMARY KEY, doc TEXT NOT NULL, dest_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.destId')) VIRTUAL, origin_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.originId')) VIRTUAL, type TEXT GENERATED ALWAYS AS (json_extract(doc,'$.type')) VIRTUAL);
CREATE TABLE IF NOT EXISTS constraints         (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS weatherObservations (id TEXT PRIMARY KEY, doc TEXT NOT NULL, area_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.areaId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS weatherForecasts    (id TEXT PRIMARY KEY, doc TEXT NOT NULL, area_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.areaId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS maritimeRisks       (id TEXT PRIMARY KEY, doc TEXT NOT NULL, area_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.areaId')) VIRTUAL, level TEXT GENERATED ALWAYS AS (json_extract(doc,'$.level')) VIRTUAL);
CREATE TABLE IF NOT EXISTS affectedVessels     (id TEXT PRIMARY KEY, doc TEXT NOT NULL, risk_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.riskId')) VIRTUAL, vessel_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.vesselId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS alerts              (id TEXT PRIMARY KEY, doc TEXT NOT NULL, risk_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.riskId')) VIRTUAL, status TEXT GENERATED ALWAYS AS (json_extract(doc,'$.status')) VIRTUAL);
CREATE TABLE IF NOT EXISTS deliveryRecords     (id TEXT PRIMARY KEY, doc TEXT NOT NULL, alert_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.alertId')) VIRTUAL, vessel_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.vesselId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS alternativeRoutes   (id TEXT PRIMARY KEY, doc TEXT NOT NULL, vessel_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.vesselId')) VIRTUAL, alert_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.alertId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS bulletins           (id TEXT PRIMARY KEY, doc TEXT NOT NULL, risk_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.riskId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS navtexMessages      (id TEXT PRIMARY KEY, doc TEXT NOT NULL, bulletin_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.bulletinId')) VIRTUAL);
CREATE TABLE IF NOT EXISTS integrationEvents   (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dataSources         (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auditLogs           (id TEXT PRIMARY KEY, doc TEXT NOT NULL, seq INTEGER GENERATED ALWAYS AS (json_extract(doc,'$.seq')) VIRTUAL, entity_id TEXT GENERATED ALWAYS AS (json_extract(doc,'$.entityId')) VIRTUAL);
CREATE INDEX IF NOT EXISTS ix_aff_risk ON affectedVessels(risk_id);
CREATE INDEX IF NOT EXISTS ix_dr_alert ON deliveryRecords(alert_id);
CREATE INDEX IF NOT EXISTS ix_dr_vessel ON deliveryRecords(vessel_id);
CREATE INDEX IF NOT EXISTS ix_audit_seq ON auditLogs(seq);
