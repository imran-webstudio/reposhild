ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "ScanRepo" ADD COLUMN "headSha" TEXT;
CREATE TABLE "Activity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "target" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Activity_createdAt_id_idx" ON "Activity"("createdAt" DESC, "id");
CREATE INDEX "Activity_userId_createdAt_idx" ON "Activity"("userId", "createdAt" DESC);
CREATE INDEX "Activity_action_outcome_createdAt_idx" ON "Activity"("action", "outcome", "createdAt" DESC);
-- Preserve the activity already represented by historical scan and remediation records.
INSERT INTO "Activity" ("id", "userId", "action", "outcome", "target", "createdAt")
SELECT 'scan-start:' || "id", "userId", 'scan_started', 'success', "id", "startedAt" FROM "Scan";
INSERT INTO "Activity" ("id", "userId", "action", "outcome", "target", "createdAt")
SELECT 'scan-end:' || "id", "userId", 'scan_finished',
  CASE WHEN "status" = 'COMPLETED' THEN 'success' WHEN "status" = 'ABORTED' THEN 'aborted' ELSE 'failure' END,
  "id", "finishedAt" FROM "Scan" WHERE "finishedAt" IS NOT NULL;
INSERT INTO "Activity" ("id", "userId", "action", "outcome", "target", "createdAt")
SELECT 'cleanup:' || "id", "userId", CASE WHEN "mode" = 'pr' THEN 'fix_pr_opened' ELSE 'fix_committed' END,
  'success', "fullName", "createdAt" FROM "Remediation";
UPDATE "User" SET "lastSeenAt" = activity."latest" FROM
  (SELECT "userId", MAX("createdAt") AS "latest" FROM "Activity" GROUP BY "userId") activity
WHERE "User"."id" = activity."userId";
