-- A status can be left off the board (e.g. a backlog-only "검토 대기" or an archive state); its issues stay everywhere else.
ALTER TABLE statuses ADD COLUMN on_board BOOLEAN NOT NULL DEFAULT true;
