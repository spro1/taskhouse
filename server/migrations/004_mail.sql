-- Email digests of unread notifications (when SMTP is configured). Each person can turn them off.
ALTER TABLE users ADD COLUMN email_notify BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE notifications ADD COLUMN mailed_at TIMESTAMPTZ;
CREATE INDEX notifications_unmailed ON notifications (user_id) WHERE read_at IS NULL AND mailed_at IS NULL;
