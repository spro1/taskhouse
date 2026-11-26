-- Phase 0/1 schema. Migrations only add: never edit a released file.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',          -- '' = SSO only
  oidc_sub      TEXT UNIQUE,
  is_admin      BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  disabled_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id     BIGSERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'local'               -- 'local' | 'oidc' (replaced at every SSO login)
);
CREATE TABLE group_members (
  group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user ON group_members (user_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE api_tokens (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE TABLE projects (
  id         BIGSERIAL PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name       TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('edit', 'view', 'private')),
  issue_seq  INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- level: 1 viewer, 2 reporter, 3 member, 4 admin. Granted to a user or a group.
CREATE TABLE project_roles (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    BIGINT REFERENCES users(id) ON DELETE CASCADE,
  group_id   BIGINT REFERENCES groups(id) ON DELETE CASCADE,
  level      SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 4),
  CHECK ((user_id IS NULL) <> (group_id IS NULL))
);
CREATE UNIQUE INDEX project_roles_user ON project_roles (project_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX project_roles_group ON project_roles (project_id, group_id) WHERE group_id IS NOT NULL;

-- level: 0 epic, 1 standard, 2 subtask. project_id NULL = available in every project.
CREATE TABLE issue_types (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  level      SMALLINT NOT NULL CHECK (level BETWEEN 0 AND 2)
);
INSERT INTO issue_types (name, level) VALUES ('에픽', 0), ('스토리', 1), ('작업', 1), ('버그', 1), ('하위 작업', 2);

-- category: 0 to do, 1 in progress, 2 done. Charts and sprint completion look at the category, never the name.
CREATE TABLE statuses (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  category   SMALLINT NOT NULL CHECK (category BETWEEN 0 AND 2),
  position   INT NOT NULL,
  UNIQUE (project_id, name)
);

-- A project without rows here allows every status -> status move (the default).
-- from_id NULL = from any status. rules: {conditions, validators, post}.
CREATE TABLE transitions (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  from_id    BIGINT REFERENCES statuses(id) ON DELETE CASCADE,
  to_id      BIGINT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  rules      JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX transitions_project ON transitions (project_id);

CREATE TABLE sprints (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  goal       TEXT NOT NULL DEFAULT '',
  state      TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'active', 'closed')),
  started_at TIMESTAMPTZ,
  ends_at    TIMESTAMPTZ,
  closed_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sprints_one_active ON sprints (project_id) WHERE state = 'active';

CREATE TABLE issues (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id),
  number       INT NOT NULL,                       -- plain int (not a sequence) so imported keys can keep their number
  type_id      BIGINT NOT NULL REFERENCES issue_types(id),
  parent_id    BIGINT REFERENCES issues(id),
  title        TEXT NOT NULL,
  doc          JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}',
  text         TEXT NOT NULL DEFAULT '',           -- plain text of doc, for search
  status_id    BIGINT NOT NULL REFERENCES statuses(id),
  priority     SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 4),
  assignee_id  BIGINT REFERENCES users(id),
  reporter_id  BIGINT NOT NULL REFERENCES users(id),
  sprint_id    BIGINT REFERENCES sprints(id),
  rank         TEXT NOT NULL COLLATE "C",
  points       NUMERIC(6,1),
  due_date     DATE,
  labels       TEXT[] NOT NULL DEFAULT '{}',
  lock_version INT NOT NULL DEFAULT 1,             -- bumps on every change; lets clients notice they are stale
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  UNIQUE (project_id, number)
);
CREATE INDEX issues_board ON issues (project_id, sprint_id, rank) WHERE deleted_at IS NULL;
CREATE INDEX issues_assignee ON issues (assignee_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX issues_parent ON issues (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX issues_updated ON issues (project_id, updated_at DESC);
CREATE INDEX issues_labels ON issues USING gin (labels);
CREATE INDEX issues_title_trgm ON issues USING gin (title gin_trgm_ops);
CREATE INDEX issues_text_trgm ON issues USING gin (text gin_trgm_ops);

-- Every field change. actor_id NULL = the system (automation, Git).
CREATE TABLE issue_changes (
  id       BIGSERIAL PRIMARY KEY,
  issue_id BIGINT NOT NULL REFERENCES issues(id),
  actor_id BIGINT REFERENCES users(id),
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  field    TEXT NOT NULL,
  old      JSONB,
  new      JSONB
);
CREATE INDEX changes_issue ON issue_changes (issue_id, id);
CREATE INDEX changes_field_at ON issue_changes (field, at) INCLUDE (issue_id);

CREATE TABLE issue_links (
  source_id BIGINT NOT NULL REFERENCES issues(id),
  target_id BIGINT NOT NULL REFERENCES issues(id),
  kind      TEXT NOT NULL CHECK (kind IN ('blocks', 'relates', 'duplicates')),
  PRIMARY KEY (source_id, target_id, kind),
  CHECK (source_id <> target_id),
  CHECK (kind <> 'relates' OR source_id < target_id)  -- undirected: stored once
);
CREATE INDEX links_target ON issue_links (target_id, kind);

CREATE TABLE watchers (
  issue_id BIGINT NOT NULL REFERENCES issues(id),
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, user_id)
);

CREATE TABLE comments (
  id         BIGSERIAL PRIMARY KEY,
  issue_id   BIGINT NOT NULL REFERENCES issues(id),
  author_id  BIGINT NOT NULL REFERENCES users(id),
  doc        JSONB NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX comments_issue ON comments (issue_id, id);

-- Files live in DATA_DIR/files/<sha256>; the same bytes are stored once.
CREATE TABLE attachments (
  id          BIGSERIAL PRIMARY KEY,
  issue_id    BIGINT NOT NULL REFERENCES issues(id),
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        BIGINT NOT NULL,
  sha256      TEXT NOT NULL,
  uploader_id BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX attachments_issue ON attachments (issue_id);
CREATE INDEX attachments_sha ON attachments (sha256);

-- Saved filters: query is the filter AST (the same tree TQL will parse into).
CREATE TABLE filters (
  id         BIGSERIAL PRIMARY KEY,
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  query      JSONB NOT NULL,
  sort       JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issue_id   BIGINT NOT NULL REFERENCES issues(id),
  actor_id   BIGINT REFERENCES users(id),
  kind       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX notifications_user ON notifications (user_id, id DESC);

-- format 'json' = signed event payload; 'chat' = {"text": ...} for Slack, Mattermost and Teams incoming webhooks.
CREATE TABLE webhooks (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  secret     TEXT NOT NULL,
  format     TEXT NOT NULL DEFAULT 'json' CHECK (format IN ('json', 'chat')),
  events     TEXT[] NOT NULL DEFAULT '{}',          -- empty = all
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Work queue. Rows are written in the same transaction as the change that causes them, so nothing is lost on a crash.
CREATE TABLE jobs (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts   INT NOT NULL DEFAULT 0,
  done_at    TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due ON jobs (run_at) WHERE done_at IS NULL;

CREATE TABLE audit_log (
  id       BIGSERIAL PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id BIGINT REFERENCES users(id),
  action   TEXT NOT NULL,
  target   TEXT,
  ip       TEXT,
  ok       BOOLEAN NOT NULL DEFAULT true,
  detail   JSONB
);
CREATE INDEX audit_log_at ON audit_log (at DESC);
