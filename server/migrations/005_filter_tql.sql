-- Saved filters keep the TQL text they were written in (query holds the parsed tree).
ALTER TABLE filters ADD COLUMN tql TEXT;
