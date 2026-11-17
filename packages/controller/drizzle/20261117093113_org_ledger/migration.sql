ALTER TABLE "ledger" RENAME COLUMN "project" TO "org";--> statement-breakpoint
ALTER INDEX "ledger_project_at" RENAME TO "ledger_org_at";--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "fallback" boolean DEFAULT false NOT NULL;