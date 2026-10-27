-- The original expression rejected every reviewer role, including a reviewer without ADMIN.
ALTER TABLE "user" DROP CONSTRAINT "user_admin_not_business";
ALTER TABLE "user" ADD CONSTRAINT "user_admin_not_business"
  CHECK (NOT (
    'ADMIN'::"Role" = ANY("roles")
    AND "roles" && ARRAY['REVIEWER','SENIOR_REVIEWER','AUDITOR']::"Role"[]
  ));
