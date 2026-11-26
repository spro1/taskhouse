-- One-time links an admin hands out so someone can set a new password (no mail needed).
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
