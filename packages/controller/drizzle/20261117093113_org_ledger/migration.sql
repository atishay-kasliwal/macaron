ALTER TABLE "ledger" RENAME COLUMN "project" TO "org";--> statement-breakpoint
-- Rows from before orgs held their project's name: they now count against the org of their
-- repository's owner, as the org files name it, so spending this month carries over.
-- "unknown" (a run whose repository had left the configuration) counted against no budget, and still doesn't.
UPDATE "ledger" SET "org" = split_part("repo", '/', 1) WHERE "org" <> 'unknown';--> statement-breakpoint
ALTER INDEX "ledger_project_at" RENAME TO "ledger_org_at";--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "fallback" boolean DEFAULT false NOT NULL;