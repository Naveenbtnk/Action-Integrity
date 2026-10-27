-- Phase 1 database invariants. These guards also protect raw SQL and nested writes.
CREATE UNIQUE INDEX "action_hold_open_unique"
  ON "action_hold" ("outbound_action_id") WHERE "released_at" IS NULL;

CREATE UNIQUE INDEX "policy_version_one_active"
  ON "policy_version" ("status") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "break_glass_one_open_per_admin"
  ON "break_glass_elevation" ("requested_by_id")
  WHERE "status" IN ('PENDING_COSIGN', 'ACTIVE');

ALTER TABLE "user" ADD CONSTRAINT "user_admin_not_business"
  CHECK (NOT ("roles" && ARRAY['ADMIN','REVIEWER','SENIOR_REVIEWER','AUDITOR']::"Role"[]));

ALTER TABLE "break_glass_elevation" ADD CONSTRAINT "break_glass_distinct_cosigner"
  CHECK ("cosigned_by_id" IS NULL OR "requested_by_id" <> "cosigned_by_id");

ALTER TABLE "break_glass_elevation" ADD CONSTRAINT "break_glass_max_duration"
  CHECK ("expires_at" > "created_at" AND "expires_at" - "created_at" <= interval '60 minutes');

CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable record: %', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_anchor_immutable BEFORE UPDATE OR DELETE ON "audit_anchor"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER investigation_report_immutable BEFORE UPDATE OR DELETE ON "investigation_report"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER verification_result_immutable BEFORE UPDATE OR DELETE ON "verification_result"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER escalation_event_immutable BEFORE UPDATE OR DELETE ON "escalation_event"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER tgt_audit_immutable BEFORE UPDATE OR DELETE ON "tgt_audit"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION guard_approval_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'Approval decision fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_decision_immutable BEFORE UPDATE ON "approval"
  FOR EACH ROW EXECUTE FUNCTION guard_approval_update();
CREATE TRIGGER approval_no_delete BEFORE DELETE ON "approval"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION guard_policy_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."document", NEW."hash", NEW."version") IS DISTINCT FROM
     (OLD."document", OLD."hash", OLD."version") THEN
    RAISE EXCEPTION 'Policy document fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER policy_document_immutable BEFORE UPDATE ON "policy_version"
  FOR EACH ROW EXECUTE FUNCTION guard_policy_document();
