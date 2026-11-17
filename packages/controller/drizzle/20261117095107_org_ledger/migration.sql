ALTER TABLE "ledger" RENAME COLUMN "project" TO "org";--> statement-breakpoint
-- Rows from before orgs held their project's name: they now name the org of their repository's
-- owner, as the org files do. "unknown" (a run whose repository had left the configuration) stays.
UPDATE "ledger" SET "org" = split_part("repo", '/', 1) WHERE "org" <> 'unknown';--> statement-breakpoint
ALTER INDEX "ledger_project_at" RENAME TO "ledger_org_at";