-- Accounts (users, sessions, groups) can be shared with Pagehouse in one database: see prepare() in db.ts.
-- Pagehouse reads last_sso_at for its API tokens, and marks which memberships came from SSO on the membership,
-- not on the group. groups.source stays but is no longer read.
-- From here on, changes to these four tables use IF NOT EXISTS: the other product may have made them already.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sso_at TIMESTAMPTZ;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS source TEXT;
UPDATE group_members gm SET source = 'oidc' FROM groups g WHERE g.id = gm.group_id AND g.source = 'oidc';
