CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','ANALYST','VIEWER')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_groups (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID NOT NULL REFERENCES app_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id,user_id)
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS db_connections (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  database_name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_cipher TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS datasets (
  id UUID PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PHYSICAL','VIRTUAL')),
  source_name TEXT,
  sql_definition TEXT,
  aliases_json TEXT NOT NULL DEFAULT '{}',
  owner_id UUID NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saved_queries (
  id UUID PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sql_text TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS charts (
  id UUID PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  chart_type TEXT NOT NULL CHECK (chart_type IN ('bar','line','pie')),
  dimension TEXT NOT NULL,
  metric TEXT NOT NULL,
  aggregate TEXT NOT NULL CHECK (aggregate IN ('sum','count','avg')),
  owner_id UUID NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dashboards (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES app_users(id),
  share_token UUID UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE charts ADD COLUMN IF NOT EXISTS time_grain TEXT CHECK (time_grain IS NULL OR time_grain = 'month');
CREATE TABLE IF NOT EXISTS dashboard_charts (
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  chart_id UUID NOT NULL REFERENCES charts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (dashboard_id,chart_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES app_users(id),
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE SCHEMA IF NOT EXISTS uploads;
CREATE TABLE IF NOT EXISTS file_imports (
  id UUID PRIMARY KEY,
  file_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_count BIGINT NOT NULL,
  missing_count BIGINT NOT NULL,
  invalid_count BIGINT NOT NULL,
  columns_json TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  month_dataset_id UUID REFERENCES datasets(id) ON DELETE SET NULL,
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE file_imports ADD COLUMN IF NOT EXISTS month_dataset_id UUID REFERENCES datasets(id) ON DELETE SET NULL;

-- Chat AI tables for conversation history
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at ASC);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sequence BIGINT GENERATED ALWAYS AS IDENTITY;
