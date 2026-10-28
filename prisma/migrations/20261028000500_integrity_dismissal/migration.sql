ALTER TABLE "integrity_event" ADD COLUMN "dismissed_reason" TEXT;
ALTER TABLE "integrity_event" ADD COLUMN "dismissed_by_id" TEXT;
ALTER TABLE "integrity_event" ADD COLUMN "dismissed_at" TIMESTAMPTZ(6);
ALTER TABLE "integrity_event" ADD CONSTRAINT "integrity_event_dismissed_by_id_fkey" FOREIGN KEY ("dismissed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
