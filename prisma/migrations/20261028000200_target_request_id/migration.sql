ALTER TABLE "tgt_audit" ADD COLUMN "request_id" TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE "tgt_audit" ALTER COLUMN "request_id" DROP DEFAULT;
