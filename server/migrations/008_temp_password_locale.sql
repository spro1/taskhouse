-- Temporary passwords an admin hands out must be replaced at the next sign-in.
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
-- Interface and email language per account ('ko', 'en'); NULL = not chosen (Korean).
ALTER TABLE users ADD COLUMN locale TEXT CHECK (locale IN ('ko', 'en'));
