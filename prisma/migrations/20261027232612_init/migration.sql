-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VIEWER', 'ANALYST', 'REVIEWER', 'SENIOR_REVIEWER', 'ADMIN', 'AUDITOR');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "IntegrityEventType" AS ENUM ('SCHEMA', 'ENUM', 'SEMANTIC', 'FRESHNESS', 'CROSS_SOURCE');

-- CreateEnum
CREATE TYPE "IntegrityEventStatus" AS ENUM ('OPEN', 'DISMISSED', 'LINKED');

-- CreateEnum
CREATE TYPE "OutboundActionType" AS ENUM ('ENTITLEMENT_REVOKE', 'ENTITLEMENT_GRANT', 'ACCOUNT_STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "OutboundActionStatus" AS ENUM ('PENDING', 'HELD', 'RELEASED', 'EXECUTED', 'BLOCKED', 'COMPENSATED');

-- CreateEnum
CREATE TYPE "GateDecision" AS ENUM ('ALLOW', 'HOLD', 'BLOCK');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('NEW', 'TRIAGED', 'HOLDING', 'INVESTIGATING', 'AWAITING_EVIDENCE', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'SAFE_REFUSAL', 'EXECUTING', 'VERIFYING', 'CLOSED_RESOLVED', 'CLOSED_NO_ACTION', 'CLOSED_ESCALATED', 'REOPENED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "CaseMode" AS ENUM ('AGENT', 'DETERMINISTIC');

-- CreateEnum
CREATE TYPE "Disposition" AS ENUM ('ALLOW', 'HOLD_FOR_EVIDENCE', 'BLOCK', 'RELEASE_AFTER_CORRECTION', 'COMPENSATE', 'ESCALATE', 'SAFE_REFUSAL');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'REJECT', 'OVERRIDE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('VALID', 'SUPERSEDED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ExecutionKind" AS ENUM ('RELEASE', 'RESTORE_LAST_KNOWN_GOOD');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('CONTRACT_RECORD', 'BILLING_RECORD', 'USAGE_SIGNAL', 'SUPPORT_TICKET', 'ACCOUNT_HISTORY', 'TARGET_STATE', 'OWNER_CONFIRMATION');

-- CreateEnum
CREATE TYPE "EvidenceStance" AS ENUM ('SUPPORTS', 'CONTRADICTS', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "EvidenceRequestStatus" AS ENUM ('REQUESTED', 'RECEIVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "HypothesisVerdict" AS ENUM ('SUPPORTED', 'REFUTED', 'OPEN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountSegment" AS ENUM ('ENTERPRISE', 'MIDMARKET', 'SMB');

-- CreateEnum
CREATE TYPE "TargetEntitlementStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ServiceState" AS ENUM ('ENABLED', 'RESTRICTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ScenarioType" AS ENUM ('PREVENTION', 'COMPENSATION', 'CONFLICT', 'VERIFICATION_FAILURE', 'SAFE_REFUSAL', 'FALSE_POSITIVE', 'IDEMPOTENCY', 'STALE_VALID', 'AGENT_SECURITY');

-- CreateEnum
CREATE TYPE "ScenarioRunStatus" AS ENUM ('RUNNING', 'PASSED', 'FAILED', 'ABORTED');

-- CreateEnum
CREATE TYPE "ScenarioRunKind" AS ENUM ('DETERMINISTIC', 'AGENT', 'ADVERSARIAL', 'LOAD', 'CHAOS', 'DR');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'AGENT', 'USER', 'SERVICE');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHING', 'DELIVERED', 'FAILED', 'DLQ');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "BreakGlassStatus" AS ENUM ('PENDING_COSIGN', 'ACTIVE', 'USED', 'EXPIRED', 'DENIED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DegradationLevel" AS ENUM ('L0_NORMAL', 'L1_LLM_DEGRADED', 'L2_TARGET_DEGRADED', 'L3_DB_DEGRADED', 'L4_AUDIT_BROKEN', 'L5_IDENTITY_DEGRADED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "roles" "Role"[] DEFAULT ARRAY['VIEWER']::"Role"[],
    "oidc_subject" TEXT,
    "session_epoch" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "src_contract_entitlement" (
    "id" TEXT NOT NULL,
    "record_ref" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "entitlement_key" TEXT NOT NULL,
    "status" "TargetEntitlementStatus" NOT NULL,
    "contract_version" TEXT NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "payload" JSONB NOT NULL,
    "ingested_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "src_contract_entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "src_billing_subscription" (
    "id" TEXT NOT NULL,
    "record_ref" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "plan_status" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "mrr_minor" BIGINT NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "source_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "src_billing_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "src_usage_event_daily" (
    "id" TEXT NOT NULL,
    "record_ref" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "event_date" DATE NOT NULL,
    "event_count" INTEGER NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "src_usage_event_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "src_support_ticket" (
    "id" TEXT NOT NULL,
    "record_ref" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source_created_at" TIMESTAMPTZ(6) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "src_support_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "src_account_registry" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segment" "AccountSegment" NOT NULL,
    "region" TEXT NOT NULL,
    "owner_team" TEXT NOT NULL,
    "account_status" "AccountStatus" NOT NULL,
    "source_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "src_account_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tgt_account" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tgt_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tgt_entitlement" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "entitlement_key" TEXT NOT NULL,
    "status" "TargetEntitlementStatus" NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "source_ref" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tgt_entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tgt_service_status" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "state" "ServiceState" NOT NULL,
    "reason" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tgt_service_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tgt_audit" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "actor" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_ref" TEXT NOT NULL,
    "before_state" JSONB NOT NULL,
    "after_state" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,

    CONSTRAINT "tgt_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_contract" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "field_path" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "semantic_definition" TEXT NOT NULL,
    "expected_values" TEXT[],
    "alias_map" JSONB NOT NULL,
    "invariants" JSONB NOT NULL,
    "freshness_sla_seconds" INTEGER NOT NULL,
    "owner_team" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "data_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_snapshot" (
    "id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "contract_id" TEXT,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "source_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "schema_hash" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "source_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrity_event" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "type" "IntegrityEventType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL,
    "summary" TEXT NOT NULL,
    "scope_selector" JSONB NOT NULL,
    "evidence_snapshot_ids" TEXT[],
    "status" "IntegrityEventStatus" NOT NULL,
    "fingerprint" TEXT NOT NULL,

    CONSTRAINT "integrity_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_action" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "source_agent" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "action_type" "OutboundActionType" NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "OutboundActionStatus" NOT NULL,
    "gate_decision" "GateDecision" NOT NULL,
    "gate_evaluated_at" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "integrity_event_id" TEXT,
    "case_id" TEXT,
    "restore_point_id" TEXT,

    CONSTRAINT "outbound_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_point" (
    "id" TEXT NOT NULL,
    "outbound_action_id" TEXT NOT NULL,
    "target_object_type" TEXT NOT NULL,
    "target_object_ref" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "state_hash" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "restore_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_hold" (
    "id" TEXT NOT NULL,
    "outbound_action_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "placed_at" TIMESTAMPTZ(6) NOT NULL,
    "released_at" TIMESTAMPTZ(6),
    "released_by_id" TEXT,

    CONSTRAINT "action_hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "integrity_event_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL,
    "severity" "Severity" NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "risk_band" TEXT NOT NULL,
    "exposure_count" INTEGER NOT NULL,
    "estimated_value_minor" BIGINT NOT NULL,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "mode" "CaseMode" NOT NULL,
    "resolution" TEXT,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "last_transition_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "assigned_to_id" TEXT,
    "sla_due_at" TIMESTAMPTZ(6),
    "approval_expires_at" TIMESTAMPTZ(6),
    "degradation_level" "DegradationLevel",

    CONSTRAINT "case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_exposed_account" (
    "case_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "outbound_action_id" TEXT,
    "external_ref" TEXT NOT NULL,

    CONSTRAINT "case_exposed_account_pkey" PRIMARY KEY ("case_id","account_id")
);

-- CreateTable
CREATE TABLE "investigation_report" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "mode" "CaseMode" NOT NULL,
    "recommended_disposition" "Disposition" NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL,
    "evidence_completeness" DECIMAL(3,2) NOT NULL,
    "reasoning" TEXT NOT NULL,
    "missing_evidence" TEXT[],
    "citations" JSONB NOT NULL,
    "suspicious_content" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uncited_claims" BOOLEAN NOT NULL DEFAULT false,
    "model_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "evidence_hash" TEXT NOT NULL,
    "is_fallback" BOOLEAN NOT NULL,
    "retried" BOOLEAN NOT NULL DEFAULT false,
    "tokens_used" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investigation_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hypothesis" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL,
    "verdict" "HypothesisVerdict" NOT NULL,
    "supporting_refs" TEXT[],
    "contradicting_refs" TEXT[],
    "position" INTEGER NOT NULL,

    CONSTRAINT "hypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_item" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "source_key" TEXT NOT NULL,
    "record_ref" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "stance" "EvidenceStance" NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "added_by_id" TEXT,

    CONSTRAINT "evidence_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_request" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "owner_team" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "EvidenceRequestStatus" NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "evidence_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_version" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "status" "PolicyStatus" NOT NULL,
    "review_ticket" TEXT NOT NULL,
    "activated_by_id" TEXT,
    "activated_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policy_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_decision" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "report_id" TEXT,
    "risk_score" INTEGER NOT NULL,
    "risk_band" TEXT NOT NULL,
    "disposition" "Disposition" NOT NULL,
    "allowed_dispositions" TEXT[],
    "approval_required" BOOLEAN NOT NULL,
    "required_approvals" INTEGER NOT NULL,
    "required_roles" TEXT[],
    "approval_expires_at" TIMESTAMPTZ(6),
    "reasons" JSONB NOT NULL,
    "policy_version" TEXT NOT NULL,
    "policy_hash" TEXT NOT NULL,
    "evidence_hash" TEXT NOT NULL,
    "inputs_hash" TEXT NOT NULL,
    "is_fallback" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policy_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "disposition" "Disposition" NOT NULL,
    "rationale" TEXT NOT NULL,
    "reopen_count" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'VALID',
    "bound_evidence_hash" TEXT NOT NULL,
    "bound_policy_hash" TEXT NOT NULL,
    "bound_report_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "break_glass" BOOLEAN NOT NULL DEFAULT false,
    "elevation_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_execution" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "outbound_action_id" TEXT,
    "reopen_count" INTEGER NOT NULL,
    "kind" "ExecutionKind" NOT NULL,
    "target_object_type" TEXT NOT NULL,
    "target_object_ref" TEXT NOT NULL,
    "restore_point_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "request_payload" JSONB NOT NULL,
    "response_payload" JSONB,
    "failure_code" TEXT,
    "resolved_by_verification" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "action_execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_result" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "execution_id" TEXT,
    "expected_state" JSONB NOT NULL,
    "observed_state" JSONB NOT NULL,
    "observed_state_hash" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "mismatches" JSONB NOT NULL,
    "attempt_count" INTEGER NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "verification_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_event" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "owner_team" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "escalation_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_elevation" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "cosigned_by_id" TEXT,
    "status" "BreakGlassStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "case_ref" TEXT NOT NULL,
    "cosign_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "break_glass_elevation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "case_id" TEXT,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "request_id" TEXT NOT NULL,
    "trace_id" TEXT,
    "ip" INET,
    "user_agent" TEXT,
    "policy_version" TEXT,
    "policy_hash" TEXT,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_anchor" (
    "id" TEXT NOT NULL,
    "from_seq" BIGINT NOT NULL,
    "to_seq" BIGINT NOT NULL,
    "event_count" INTEGER NOT NULL,
    "root_hash" TEXT NOT NULL,
    "previous_anchor_hash" TEXT,
    "external_uri" TEXT NOT NULL,
    "external_etag" TEXT,
    "status" TEXT NOT NULL,
    "anchored_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),

    CONSTRAINT "audit_anchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "delivered_at" TIMESTAMPTZ(6),
    "dead_lettered_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_heartbeat" (
    "job" TEXT NOT NULL,
    "last_started_at" TIMESTAMPTZ(6) NOT NULL,
    "last_success_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_heartbeat_pkey" PRIMARY KEY ("job")
);

-- CreateTable
CREATE TABLE "degradation_state" (
    "id" TEXT NOT NULL,
    "level" "DegradationLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "set_by" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "degradation_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ScenarioType" NOT NULL,
    "expected_report_disposition" "Disposition",
    "expected_policy_disposition" "Disposition",
    "fixture_path" TEXT NOT NULL,
    "suite_version" TEXT NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_run" (
    "id" TEXT NOT NULL,
    "suite_version" TEXT NOT NULL,
    "kind" "ScenarioRunKind" NOT NULL,
    "mode" "CaseMode" NOT NULL,
    "status" "ScenarioRunStatus" NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "model_id" TEXT,
    "prompt_version" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "policy_hash" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6) NOT NULL,
    "summary" JSONB NOT NULL,
    "triggered_by_id" TEXT,
    "error" TEXT,

    CONSTRAINT "scenario_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_result" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "expected" JSONB NOT NULL,
    "actual" JSONB NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "scenario_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_snapshot" (
    "id" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "window_end" TIMESTAMPTZ(6) NOT NULL,
    "metrics" JSONB NOT NULL,
    "policy_version" TEXT NOT NULL,
    "policy_hash" TEXT NOT NULL,

    CONSTRAINT "kpi_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_oidc_subject_key" ON "user"("oidc_subject");

-- CreateIndex
CREATE UNIQUE INDEX "src_contract_entitlement_record_ref_key" ON "src_contract_entitlement"("record_ref");

-- CreateIndex
CREATE INDEX "src_contract_entitlement_account_id_entitlement_key_idx" ON "src_contract_entitlement"("account_id", "entitlement_key");

-- CreateIndex
CREATE INDEX "src_contract_entitlement_status_idx" ON "src_contract_entitlement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "src_billing_subscription_record_ref_key" ON "src_billing_subscription"("record_ref");

-- CreateIndex
CREATE INDEX "src_billing_subscription_account_id_idx" ON "src_billing_subscription"("account_id");

-- CreateIndex
CREATE INDEX "src_billing_subscription_plan_status_idx" ON "src_billing_subscription"("plan_status");

-- CreateIndex
CREATE UNIQUE INDEX "src_usage_event_daily_record_ref_key" ON "src_usage_event_daily"("record_ref");

-- CreateIndex
CREATE INDEX "src_usage_event_daily_feature_key_event_date_idx" ON "src_usage_event_daily"("feature_key", "event_date");

-- CreateIndex
CREATE UNIQUE INDEX "src_usage_event_daily_account_id_feature_key_event_date_key" ON "src_usage_event_daily"("account_id", "feature_key", "event_date");

-- CreateIndex
CREATE UNIQUE INDEX "src_support_ticket_record_ref_key" ON "src_support_ticket"("record_ref");

-- CreateIndex
CREATE INDEX "src_support_ticket_account_id_idx" ON "src_support_ticket"("account_id");

-- CreateIndex
CREATE INDEX "src_support_ticket_source_created_at_idx" ON "src_support_ticket"("source_created_at");

-- CreateIndex
CREATE UNIQUE INDEX "src_account_registry_account_id_key" ON "src_account_registry"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "tgt_account_account_id_key" ON "tgt_account"("account_id");

-- CreateIndex
CREATE INDEX "tgt_entitlement_entitlement_key_status_idx" ON "tgt_entitlement"("entitlement_key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tgt_entitlement_account_id_entitlement_key_key" ON "tgt_entitlement"("account_id", "entitlement_key");

-- CreateIndex
CREATE UNIQUE INDEX "tgt_service_status_account_id_key" ON "tgt_service_status"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "tgt_audit_idempotency_key_key" ON "tgt_audit"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "data_contract_key_key" ON "data_contract"("key");

-- CreateIndex
CREATE INDEX "source_snapshot_source_key_captured_at_idx" ON "source_snapshot"("source_key", "captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "source_snapshot_contract_id_payload_hash_key" ON "source_snapshot"("contract_id", "payload_hash");

-- CreateIndex
CREATE UNIQUE INDEX "integrity_event_fingerprint_key" ON "integrity_event"("fingerprint");

-- CreateIndex
CREATE INDEX "integrity_event_status_detected_at_idx" ON "integrity_event"("status", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "integrity_event_severity_idx" ON "integrity_event"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_action_ref_key" ON "outbound_action"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_action_idempotency_key_key" ON "outbound_action"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "restore_point_outbound_action_id_key" ON "restore_point"("outbound_action_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_ref_key" ON "case"("ref");

-- CreateIndex
CREATE INDEX "case_status_severity_opened_at_idx" ON "case"("status", "severity", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "case_last_transition_at_idx" ON "case"("last_transition_at" DESC);

-- CreateIndex
CREATE INDEX "case_approval_expires_at_idx" ON "case"("approval_expires_at");

-- CreateIndex
CREATE INDEX "case_exposed_account_account_id_idx" ON "case_exposed_account"("account_id");

-- CreateIndex
CREATE INDEX "investigation_report_case_id_created_at_idx" ON "investigation_report"("case_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "investigation_report_case_id_evidence_hash_prompt_version_m_key" ON "investigation_report"("case_id", "evidence_hash", "prompt_version", "mode");

-- CreateIndex
CREATE INDEX "evidence_item_case_id_kind_idx" ON "evidence_item"("case_id", "kind");

-- CreateIndex
CREATE INDEX "evidence_request_case_id_idx" ON "evidence_request"("case_id");

-- CreateIndex
CREATE INDEX "evidence_request_status_due_at_idx" ON "evidence_request"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "policy_version_version_key" ON "policy_version"("version");

-- CreateIndex
CREATE UNIQUE INDEX "policy_version_hash_key" ON "policy_version"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "approval_one_per_reviewer" ON "approval"("case_id", "reopen_count", "reviewer_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_execution_idempotency_key_key" ON "action_execution"("idempotency_key");

-- CreateIndex
CREATE INDEX "action_execution_case_id_idx" ON "action_execution"("case_id");

-- CreateIndex
CREATE INDEX "action_execution_status_idx" ON "action_execution"("status");

-- CreateIndex
CREATE INDEX "action_execution_started_at_idx" ON "action_execution"("started_at");

-- CreateIndex
CREATE INDEX "escalation_event_case_id_created_at_idx" ON "escalation_event"("case_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_seq_key" ON "audit_event"("seq");

-- CreateIndex
CREATE INDEX "audit_event_case_id_created_at_idx" ON "audit_event"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_event_event_type_created_at_idx" ON "audit_event"("event_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_event_request_id_idx" ON "audit_event"("request_id");

-- CreateIndex
CREATE INDEX "audit_event_trace_id_idx" ON "audit_event"("trace_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_anchor_from_seq_to_seq_key" ON "audit_anchor"("from_seq", "to_seq");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_event_dedupe_key_key" ON "outbox_event"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_event_status_next_attempt_at_idx" ON "outbox_event"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbox_event_aggregate_type_aggregate_id_idx" ON "outbox_event"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_scope" ON "idempotency_record"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_key_key" ON "scenario"("key");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_result_run_id_scenario_id_key" ON "scenario_result"("run_id", "scenario_id");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_snapshot" ADD CONSTRAINT "source_snapshot_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "data_contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrity_event" ADD CONSTRAINT "integrity_event_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "data_contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_action" ADD CONSTRAINT "outbound_action_integrity_event_id_fkey" FOREIGN KEY ("integrity_event_id") REFERENCES "integrity_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_action" ADD CONSTRAINT "outbound_action_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_action" ADD CONSTRAINT "outbound_action_restore_point_id_fkey" FOREIGN KEY ("restore_point_id") REFERENCES "restore_point"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_point" ADD CONSTRAINT "restore_point_outbound_action_id_fkey" FOREIGN KEY ("outbound_action_id") REFERENCES "outbound_action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_hold" ADD CONSTRAINT "action_hold_outbound_action_id_fkey" FOREIGN KEY ("outbound_action_id") REFERENCES "outbound_action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_hold" ADD CONSTRAINT "action_hold_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_hold" ADD CONSTRAINT "action_hold_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_integrity_event_id_fkey" FOREIGN KEY ("integrity_event_id") REFERENCES "integrity_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_exposed_account" ADD CONSTRAINT "case_exposed_account_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_exposed_account" ADD CONSTRAINT "case_exposed_account_outbound_action_id_fkey" FOREIGN KEY ("outbound_action_id") REFERENCES "outbound_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_report" ADD CONSTRAINT "investigation_report_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hypothesis" ADD CONSTRAINT "hypothesis_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hypothesis" ADD CONSTRAINT "hypothesis_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "investigation_report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_item" ADD CONSTRAINT "evidence_item_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_item" ADD CONSTRAINT "evidence_item_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_request" ADD CONSTRAINT "evidence_request_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_activated_by_id_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_decision" ADD CONSTRAINT "policy_decision_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_decision" ADD CONSTRAINT "policy_decision_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "investigation_report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_bound_report_id_fkey" FOREIGN KEY ("bound_report_id") REFERENCES "investigation_report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_elevation_id_fkey" FOREIGN KEY ("elevation_id") REFERENCES "break_glass_elevation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution" ADD CONSTRAINT "action_execution_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution" ADD CONSTRAINT "action_execution_outbound_action_id_fkey" FOREIGN KEY ("outbound_action_id") REFERENCES "outbound_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution" ADD CONSTRAINT "action_execution_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_result" ADD CONSTRAINT "verification_result_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_result" ADD CONSTRAINT "verification_result_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "action_execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_event" ADD CONSTRAINT "escalation_event_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_event" ADD CONSTRAINT "escalation_event_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_elevation" ADD CONSTRAINT "break_glass_elevation_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_elevation" ADD CONSTRAINT "break_glass_elevation_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_elevation" ADD CONSTRAINT "break_glass_elevation_cosigned_by_id_fkey" FOREIGN KEY ("cosigned_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_run" ADD CONSTRAINT "scenario_run_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_result" ADD CONSTRAINT "scenario_result_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "scenario_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_result" ADD CONSTRAINT "scenario_result_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
