-- Serialize emergency elevations per requester even under concurrent requests.
CREATE UNIQUE INDEX "break_glass_one_active_per_requester"
ON "break_glass_elevation" ("requested_by_id")
WHERE "status" IN ('PENDING_COSIGN'::"BreakGlassStatus", 'ACTIVE'::"BreakGlassStatus");
