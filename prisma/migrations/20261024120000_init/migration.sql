-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'ABORTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubId" TEXT,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "elapsedMs" INTEGER,
    "repoTotal" INTEGER NOT NULL DEFAULT 0,
    "repoScanned" INTEGER NOT NULL DEFAULT 0,
    "infectedCount" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "rateRemaining" INTEGER,
    "rateLimit" INTEGER,
    "lockdownActive" BOOLEAN NOT NULL DEFAULT false,
    "lockdownSummary" TEXT,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRepo" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "githubRepoId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "private" BOOLEAN NOT NULL,
    "archived" BOOLEAN NOT NULL,
    "fork" BOOLEAN NOT NULL,
    "isOrg" BOOLEAN NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "pushedAt" TIMESTAMP(3),
    "lastCommitter" TEXT,
    "htmlUrl" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "skippedReason" TEXT,
    "warnings" JSONB,

    CONSTRAINT "ScanRepo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "scanRepoId" TEXT NOT NULL,
    "findingKey" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "rule" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "revealed" TEXT NOT NULL,
    "hiddenPadding" BOOLEAN NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanFile" (
    "id" TEXT NOT NULL,
    "scanRepoId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,

    CONSTRAINT "ScanFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remediation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "commitUrl" TEXT NOT NULL,
    "prUrl" TEXT,
    "branch" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "fallbackToPr" BOOLEAN NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Remediation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

-- CreateIndex
CREATE INDEX "Scan_userId_startedAt_idx" ON "Scan"("userId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ScanRepo_scanId_idx" ON "ScanRepo"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanRepo_scanId_fullName_key" ON "ScanRepo"("scanId", "fullName");

-- CreateIndex
CREATE INDEX "Finding_scanRepoId_idx" ON "Finding"("scanRepoId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanFile_scanRepoId_path_key" ON "ScanFile"("scanRepoId", "path");

-- CreateIndex
CREATE INDEX "Remediation_userId_createdAt_idx" ON "Remediation"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRepo" ADD CONSTRAINT "ScanRepo_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_scanRepoId_fkey" FOREIGN KEY ("scanRepoId") REFERENCES "ScanRepo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanFile" ADD CONSTRAINT "ScanFile_scanRepoId_fkey" FOREIGN KEY ("scanRepoId") REFERENCES "ScanRepo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remediation" ADD CONSTRAINT "Remediation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
