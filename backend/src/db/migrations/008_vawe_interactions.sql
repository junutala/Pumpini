-- 008_vawe_interactions.sql
--
-- Platform table for VAWE → Pumpini operational interactions — the "SO
-- Instructions" a Sales Officer pushes to an outlet. VAWE owns the task and
-- creates one row per outlet via the signed webhook (see routes/vawe.js
-- POST /interactions); the outlet's manager acts on it from the operations
-- dashboard (sets a commit-by date, uploads proof, marks complete) and the
-- owner observes it read-only on the group dashboard.
--
-- Idempotent: on staging the table was created ad-hoc, so this uses
-- IF NOT EXISTS / ADD COLUMN IF NOT EXISTS to converge any environment to the
-- canonical shape without disturbing existing rows.
--
-- Access is enforced at the app layer (authenticate + requireStationAccess /
-- requireStationVia in routes/vawe.js), matching how the rest of the API guards
-- per-outlet reads. The inbound webhook writes on the bypass role (no identity
-- context), so it is unaffected by any future RLS policy added here.

CREATE TABLE IF NOT EXISTS vawe_interactions (
  id             UUID PRIMARY KEY,
  station_id     UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  task_name      TEXT NOT NULL,
  instruction    TEXT NOT NULL,
  desired_by     TIMESTAMPTZ,               -- SO's soft target (nullable)
  so_executed_at TIMESTAMPTZ NOT NULL,      -- when the SO pressed Execute
  committed_date DATE,                      -- manager's commit-by (operative deadline)
  status         VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  artifact_url   TEXT,                       -- proof of completion (base64 data URI)
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Converge older ad-hoc tables that predate these columns.
ALTER TABLE vawe_interactions ADD COLUMN IF NOT EXISTS committed_date DATE;
ALTER TABLE vawe_interactions ADD COLUMN IF NOT EXISTS artifact_url   TEXT;
-- Proof is stored inline as a base64 data URI — ensure the column is unbounded
-- even if an ad-hoc table created it as VARCHAR(n).
ALTER TABLE vawe_interactions ALTER COLUMN artifact_url TYPE TEXT;

CREATE INDEX IF NOT EXISTS idx_vawe_interactions_station ON vawe_interactions(station_id);
CREATE INDEX IF NOT EXISTS idx_vawe_interactions_status  ON vawe_interactions(status);
