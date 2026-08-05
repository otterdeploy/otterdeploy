-- Shorten every entity ID prefix in place (project_… -> prj_…, resource_… -> res_…).
--
-- The prefix map below is LEGACY_ID_PREFIX -> ID_PREFIX from
-- packages/shared/src/id.ts. If those tables ever change again, update this map
-- from them; the two must agree or IDs are rewritten to a spelling zId rejects.
--
-- ORDERING: run this DURING the deploy of the code that mints short prefixes,
-- never before it. The old build's zId() has no legacy table, so it rejects a
-- short ID at the API boundary -- migrating first breaks the live app.
--
-- SCOPE: every primary-key and foreign-key TEXT column, plus the seven ID
-- columns that carry no constraint (UNCONSTRAINED_ID_COLUMNS below). It
-- deliberately excludes free text -- project_env_var.value, deployment_log
-- lines -- where a literal "project_..." is user data, not an ID.
--
-- The column set is enumerated, not inferred from the data: matching on content
-- would rewrite whatever happened to look like an ID on the day it ran.
--
-- NOT covered, by design: IDs embedded in jsonb (project.manifest, deployment
-- snapshots, audit payloads) and in live swarm container labels. Those stay on
-- the long spelling and keep validating, because zId()/hasPrefix() accept both
-- (LEGACY_ID_PREFIX); they converge on the next write.
--
-- Idempotent: re-running matches nothing, because no long prefix remains.

BEGIN;

-- Both sides of every FK move in this transaction, so the constraints can only
-- hold at COMMIT, not statement-by-statement. None of the 70 FKs was declared
-- DEFERRABLE, and SET CONSTRAINTS can only defer one that is.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND NOT condeferrable
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE',
                   r.tbl, r.conname);
  END LOOP;
END $$;

SET CONSTRAINTS ALL DEFERRED;

DO $$
DECLARE
  prefixes jsonb := '{"account":"acct","apikey":"ak","audit":"aud","bakdest":"bdst","baksched":"bsch","blocklist":"blk","regcred":"reg","deployment":"dep","guest":"gst","gitinst":"giti","gitprov":"gitp","gitrepo":"gitr","invite":"inv","member":"mbr","enroll":"enr","notif":"ntf","notifchan":"ntfc","notifdlv":"ntfd","notifsub":"ntfs","orphres":"orph","project":"prj","proxy_route":"rt","resource":"res","server":"srv","session":"sess","sshkey":"ssh","user":"usr","verification":"vrf","whdlv":"whd"}'::jsonb;
  col      record;
  m        record;
  moved    bigint;
  total    bigint := 0;
BEGIN
  FOR col IN
    SELECT DISTINCT k.table_name AS tbl, k.column_name AS name
    FROM information_schema.table_constraints t
    JOIN information_schema.key_column_usage k
      ON k.constraint_name = t.constraint_name AND k.table_schema = t.table_schema
    JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = k.table_name
     AND c.column_name = k.column_name
    WHERE t.table_schema = 'public'
      AND t.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
      AND c.data_type = 'text'

    UNION

    -- UNCONSTRAINED_ID_COLUMNS: these hold entity IDs but declare no FK, so the
    -- key-usage query above cannot see them. audit_log.target_id is polymorphic
    -- (it holds whichever entity the entry is about) and audit rows outlive the
    -- entities they reference, which is why neither can be a foreign key.
    SELECT tbl, name
    FROM (VALUES
      ('audit_log',        'actor_id'),
      ('audit_log',        'target_id'),
      ('resource_metric',  'resource_id'),
      ('proxy_route',      'resource_id'),
      ('preview',          'git_repo_id'),
      ('service_resource', 'git_repo_id'),
      -- better-auth's provider account id. For the credential provider it holds
      -- our own user id, so it has to move with it or sign-in stops resolving.
      -- An OAuth provider's id carries no prefix of ours and is left alone.
      ('account',          'account_id')
    ) AS extra(tbl, name)
  LOOP
    FOR m IN SELECT key AS old, value #>> '{}' AS new FROM jsonb_each(prefixes)
    LOOP
      -- `_` is a LIKE wildcard, so every underscore in the old prefix is
      -- escaped -- `proxy_route` must not also match `proxyXroute`.
      EXECUTE format(
        'UPDATE %I SET %I = %L || substring(%I FROM %s) WHERE %I LIKE %L',
        col.tbl, col.name,
        m.new || '_', col.name, length(m.old) + 2,
        col.name, replace(m.old, '_', '\_') || '\_%'
      );
      GET DIAGNOSTICS moved = ROW_COUNT;
      total := total + moved;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'shortened % id values', total;
END $$;

-- Fail loudly rather than half-migrate. The column list above is enumerated by
-- hand, so the risk is UNDER-coverage: an ID column nobody remembered, left on
-- the old spelling while everything pointing at it moved. Four such columns
-- turned up during testing. This re-reads every text column and aborts the
-- transaction if any legacy prefix survived.
--
-- A free-text column whose value merely begins with an old prefix would trip
-- this too; none does today. If one ever legitimately does, exclude that column
-- here rather than skipping the check.
DO $$
DECLARE c record; n bigint; leftovers text := '';
BEGIN
  FOR c IN
    SELECT table_name t, column_name col FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'text'
      -- The edge_log partitions carry no entity ids at all (bigint pk, HTTP
      -- fields) and are the bulk of the database. Skipping them keeps the check
      -- quick and keeps request paths out of a regex they could only trip by
      -- accident.
      AND table_name NOT LIKE 'edge\_log\_%'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I ~ %L', c.t, c.col, '^(verification|proxy_route|deployment|blocklist|notifchan|baksched|notifdlv|notifsub|resource|account|bakdest|regcred|gitinst|gitprov|gitrepo|orphres|project|session|apikey|invite|member|enroll|server|sshkey|audit|guest|notif|whdlv|user)_') INTO n;
    IF n > 0 THEN leftovers := leftovers || format(E'\n  %s.%s (%s rows)', c.t, c.col, n); END IF;
  END LOOP;
  IF leftovers <> '' THEN
    RAISE EXCEPTION 'legacy id prefixes survived in:%', leftovers;
  END IF;
END $$;

COMMIT;
