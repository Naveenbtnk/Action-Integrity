INSERT INTO "case_exposed_account" ("case_id", "account_id", "outbound_action_id", "external_ref")
SELECT action."case_id", action."account_id", action."id", action."account_id"
FROM "outbound_action" AS action
WHERE action."case_id" IS NOT NULL
ON CONFLICT ("case_id", "account_id") DO NOTHING;

UPDATE "case" AS case_row
SET "exposure_count" = exposed.count
FROM (
  SELECT "case_id", COUNT(*)::integer AS count
  FROM "case_exposed_account"
  GROUP BY "case_id"
) AS exposed
WHERE case_row."id" = exposed."case_id"
  AND case_row."exposure_count" <> exposed.count;
