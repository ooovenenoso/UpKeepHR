-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "hhrr_employees" (
    "id" TEXT NOT NULL,
    "cpid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastNames" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "site" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "hireDate" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "legacyData" TEXT,
    "supervisorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_documents" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "autoAssign" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hhrr_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_document_rules" (
    "id" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "expiryMode" TEXT NOT NULL,
    "validityMonths" INTEGER,
    "initialDays" INTEGER NOT NULL DEFAULT 30,
    "calendarMode" TEXT NOT NULL DEFAULT 'CLAMP',
    "reviewMonths" INTEGER,
    "reviewCount" INTEGER,
    "reviewTargetId" TEXT,
    "reminders" TEXT NOT NULL DEFAULT '[10,5,0]',
    "overdueDays" INTEGER NOT NULL DEFAULT 7,
    "sites" TEXT NOT NULL DEFAULT '[]',
    "positions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_document_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_assignments" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignedDate" TEXT NOT NULL,

    CONSTRAINT "hhrr_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_cycles" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "issueDate" TEXT,
    "expiresDate" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL DEFAULT 'APPROVAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_obligations" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "cycleId" TEXT,
    "kind" TEXT NOT NULL,
    "reviewIndex" INTEGER,
    "dueDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "fulfilledDate" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_submissions" (
    "assignedReviewerId" TEXT,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "issueDate" TEXT,
    "expiresDate" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedDate" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "reason" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'UPLOAD',

    CONSTRAINT "hhrr_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_attachments" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,

    CONSTRAINT "hhrr_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_legacy_challenges" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "identifier" TEXT NOT NULL,
    "ipKey" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_legacy_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_legacy_sessions" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_legacy_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_notifications" (
    "accountId" TEXT,
    "readAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "employeeId" TEXT,
    "recipients" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerId" TEXT,
    "firstAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hhrr_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_notification_events" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "notificationId" TEXT,

    CONSTRAINT "hhrr_notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_webhook_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_audits" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_import_batches" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_import_rows" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "payload" TEXT NOT NULL,
    "issues" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "employeeId" TEXT,

    CONSTRAINT "hhrr_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "hhrr_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "hhrr_leases" (
    "key" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hhrr_leases_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "hhrr_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "employeeId" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "hhrr_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "hhrr_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_auth_accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hhrr_auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hhrr_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_two_factors" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "userId" TEXT NOT NULL,

    CONSTRAINT "hhrr_two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "hhrr_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_activations" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_upload_sessions" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "obligationId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "manifest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_export_jobs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "filters" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hhrr_daily_snapshots" (
    "date" TEXT NOT NULL,
    "metrics" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hhrr_daily_snapshots_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_employees_cpid_key" ON "hhrr_employees"("cpid");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_documents_code_key" ON "hhrr_documents"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_document_rules_documentTypeId_version_key" ON "hhrr_document_rules"("documentTypeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_assignments_employeeId_documentTypeId_key" ON "hhrr_assignments"("employeeId", "documentTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_obligations_key_key" ON "hhrr_obligations"("key");

-- CreateIndex
CREATE INDEX "hhrr_obligations_status_dueDate_idx" ON "hhrr_obligations"("status", "dueDate");

-- CreateIndex
CREATE INDEX "hhrr_submissions_status_idx" ON "hhrr_submissions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_attachments_storageKey_key" ON "hhrr_attachments"("storageKey");

-- CreateIndex
CREATE INDEX "hhrr_legacy_challenges_identifier_createdAt_idx" ON "hhrr_legacy_challenges"("identifier", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_notifications_key_key" ON "hhrr_notifications"("key");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_notifications_providerId_key" ON "hhrr_notifications"("providerId");

-- CreateIndex
CREATE INDEX "hhrr_notifications_status_nextAttemptAt_idx" ON "hhrr_notifications"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_notification_events_obligationId_stage_key" ON "hhrr_notification_events"("obligationId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_import_batches_hash_key" ON "hhrr_import_batches"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_import_rows_batchId_rowNumber_key" ON "hhrr_import_rows"("batchId", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_users_email_key" ON "hhrr_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_users_employeeId_key" ON "hhrr_users"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_sessions_token_key" ON "hhrr_sessions"("token");

-- CreateIndex
CREATE INDEX "hhrr_sessions_userId_idx" ON "hhrr_sessions"("userId");

-- CreateIndex
CREATE INDEX "hhrr_auth_accounts_userId_idx" ON "hhrr_auth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_auth_accounts_providerId_accountId_key" ON "hhrr_auth_accounts"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "hhrr_verifications_identifier_idx" ON "hhrr_verifications"("identifier");

-- CreateIndex
CREATE INDEX "hhrr_two_factors_userId_idx" ON "hhrr_two_factors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_rate_limits_key_key" ON "hhrr_rate_limits"("key");

-- CreateIndex
CREATE UNIQUE INDEX "hhrr_activations_tokenHash_key" ON "hhrr_activations"("tokenHash");

-- CreateIndex
CREATE INDEX "hhrr_upload_sessions_status_expiresAt_idx" ON "hhrr_upload_sessions"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "hhrr_employees" ADD CONSTRAINT "hhrr_employees_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "hhrr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_document_rules" ADD CONSTRAINT "hhrr_document_rules_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "hhrr_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_assignments" ADD CONSTRAINT "hhrr_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hhrr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_assignments" ADD CONSTRAINT "hhrr_assignments_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "hhrr_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_assignments" ADD CONSTRAINT "hhrr_assignments_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "hhrr_document_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_cycles" ADD CONSTRAINT "hhrr_cycles_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hhrr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_cycles" ADD CONSTRAINT "hhrr_cycles_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "hhrr_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_cycles" ADD CONSTRAINT "hhrr_cycles_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "hhrr_document_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_obligations" ADD CONSTRAINT "hhrr_obligations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hhrr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_obligations" ADD CONSTRAINT "hhrr_obligations_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "hhrr_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_obligations" ADD CONSTRAINT "hhrr_obligations_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "hhrr_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_obligations" ADD CONSTRAINT "hhrr_obligations_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "hhrr_document_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_obligations" ADD CONSTRAINT "hhrr_obligations_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "hhrr_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_submissions" ADD CONSTRAINT "hhrr_submissions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hhrr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_submissions" ADD CONSTRAINT "hhrr_submissions_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "hhrr_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_attachments" ADD CONSTRAINT "hhrr_attachments_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "hhrr_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_legacy_sessions" ADD CONSTRAINT "hhrr_legacy_sessions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hhrr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_notification_events" ADD CONSTRAINT "hhrr_notification_events_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "hhrr_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_notification_events" ADD CONSTRAINT "hhrr_notification_events_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "hhrr_notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_import_rows" ADD CONSTRAINT "hhrr_import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "hhrr_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_users" ADD CONSTRAINT "hhrr_users_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hhrr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_sessions" ADD CONSTRAINT "hhrr_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hhrr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_auth_accounts" ADD CONSTRAINT "hhrr_auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hhrr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hhrr_two_factors" ADD CONSTRAINT "hhrr_two_factors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hhrr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
