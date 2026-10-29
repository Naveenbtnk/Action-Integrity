-- A compensation must preserve the state immediately before its own target write.
ALTER TABLE "restore_point" ALTER COLUMN "outbound_action_id" DROP NOT NULL;
ALTER TABLE "action_execution" ADD COLUMN "pre_write_restore_point_id" TEXT;
CREATE UNIQUE INDEX "action_execution_pre_write_restore_point_id_key"
  ON "action_execution"("pre_write_restore_point_id");
ALTER TABLE "action_execution"
  ADD CONSTRAINT "action_execution_pre_write_restore_point_id_fkey"
  FOREIGN KEY ("pre_write_restore_point_id") REFERENCES "restore_point"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
