-- Live updates: every committed change to an issue, its comments or a sprint announces {p: project, i: issue}.
-- Only ids leave the database: clients fetch the issue again over REST, where permissions are checked.
-- NOTIFY is delivered at commit and identical payloads in one transaction are merged, so bulk edits stay cheap.
CREATE FUNCTION notify_live() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pid bigint;
  iid bigint;
BEGIN
  IF TG_TABLE_NAME = 'issues' THEN
    pid := NEW.project_id; iid := NEW.id;
  ELSIF TG_TABLE_NAME = 'comments' THEN
    iid := NEW.issue_id; SELECT project_id INTO pid FROM issues WHERE id = iid;
  ELSE
    pid := NEW.project_id;
  END IF;
  PERFORM pg_notify('th_live', json_build_object('p', pid, 'i', iid)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER issues_live AFTER INSERT OR UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION notify_live();
CREATE TRIGGER comments_live AFTER INSERT OR UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION notify_live();
CREATE TRIGGER sprints_live AFTER INSERT OR UPDATE ON sprints FOR EACH ROW EXECUTE FUNCTION notify_live();
