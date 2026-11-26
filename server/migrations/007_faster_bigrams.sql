-- 002's hangul_bigrams took substr() at every position of the whole text; on UTF-8 each substr counts from the start,
-- so a 50,000-character description took ~10 s to save. Cut the text into Hangul runs (words) first and take pairs
-- inside each short run: linear time, same result.
-- The generated column is rebuilt so it uses the new function.
CREATE OR REPLACE FUNCTION hangul_bigrams(t text) RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(DISTINCT substr(w[1], i, 2)), '{}')
  FROM regexp_matches(t, '[가-힣]{2,}', 'g') AS w, generate_series(1, length(w[1]) - 1) AS i
$$;
DROP INDEX issues_grams;
ALTER TABLE issues DROP COLUMN grams;
ALTER TABLE issues ADD COLUMN grams text[] GENERATED ALWAYS AS (hangul_bigrams(title || ' ' || text)) STORED;
CREATE INDEX issues_grams ON issues USING gin (grams);
