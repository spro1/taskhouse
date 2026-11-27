-- Profile, as in Pagehouse (same columns and formats, so the account tables can be shared; IF NOT EXISTS because
-- the other product may have added them already):
--   avatar: "<sha256>:<mime>" of a file in the attachment store
--   theme:  'system', 'light' or 'dark' (NULL = system)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT;
