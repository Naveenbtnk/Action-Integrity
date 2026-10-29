-- ALLOW actions have no case but still require an execution intent and verification record.
ALTER TABLE "action_execution" ALTER COLUMN "case_id" DROP NOT NULL;
ALTER TABLE "verification_result" ALTER COLUMN "case_id" DROP NOT NULL;
