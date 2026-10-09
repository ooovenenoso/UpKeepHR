CREATE UNIQUE INDEX IF NOT EXISTS "hhrr_one_pending_submission" ON "hhrr_submissions" ("obligationId") WHERE "status" = 'PENDING';
CREATE INDEX IF NOT EXISTS "hhrr_notifications_account_read" ON "hhrr_notifications" ("accountId", "readAt");
CREATE INDEX IF NOT EXISTS "hhrr_submissions_reviewer" ON "hhrr_submissions" ("assignedReviewerId", "status");
