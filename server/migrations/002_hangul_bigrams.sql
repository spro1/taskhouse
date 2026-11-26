-- Korean words are often two syllables ("배포", "장애"), too short for pg_trgm's index: such searches scanned every
-- issue (400 ms at 50,000 issues). Every pair of adjacent Hangul syllables goes into an indexed array instead;
-- a search first narrows by the pairs of its term, then checks the real text.
CREATE FUNCTION hangul_bigrams(t text) RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(DISTINCT g), '{}')
  FROM (SELECT substr(t, i, 2) AS g FROM generate_series(1, length(t) - 1) AS i) s
  WHERE g ~ '^[가-힣]{2}$'
$$;
ALTER TABLE issues ADD COLUMN grams text[] GENERATED ALWAYS AS (hangul_bigrams(title || ' ' || text)) STORED;
CREATE INDEX issues_grams ON issues USING gin (grams);
