ALTER TABLE "data_contract" ADD COLUMN "schema_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "data_contract" ADD COLUMN "required_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "data_contract" ALTER COLUMN "schema_hash" DROP DEFAULT;
ALTER TABLE "data_contract" ALTER COLUMN "required_fields" DROP DEFAULT;
