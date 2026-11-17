import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { MIGRATIONS_FOLDER } from "../../src/db/db.module.ts";
import { startPostgres } from "../support/postgres.ts";

const ORG_LEDGER = "20261117095107_org_ledger";

let container: StartedPostgreSqlContainer;
let before: string;

beforeAll(async () => {
  container = await startPostgres();
  // Every migration up to the one under test, as a database still on projects has them.
  before = await mkdtemp(join(tmpdir(), "macaron-migrations-"));
  for (const entry of await readdir(MIGRATIONS_FOLDER, { withFileTypes: true })) {
    if (entry.name < ORG_LEDGER) await cp(join(MIGRATIONS_FOLDER, entry.name), join(before, entry.name), { recursive: true });
  }
});
afterAll(async () => {
  await rm(before, { recursive: true, force: true });
  await container.stop();
});

const Row = z.object({ repo: z.string(), org: z.string() });

describe("the org_ledger migration", () => {
  it("moves each row from its project to its repository owner's org", async () => {
    const db = drizzle({ connection: { connectionString: container.getConnectionUri() } });
    try {
      await migrate(db, { migrationsFolder: before });
      await db.$client.query(
        `INSERT INTO ledger (kind, repo, project, usd_micros) VALUES
           ('router', 'podman-desktop/podman-desktop', 'podman-desktop', 1),
           ('router', 'axel7083/podman-desktop', 'podman-desktop', 2),
           ('router', 'podman-desktop/extension-minikube', 'podman-desktop-extensions', 3),
           ('router', 'axel7083/foobar-tmp-demo', 'sandbox', 4),
           ('router', 'org-x/gone', 'unknown', 5)`,
      );

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const { rows } = await db.$client.query("SELECT repo, org FROM ledger ORDER BY usd_micros");
      expect(z.array(Row).parse(rows)).toEqual([
        { repo: "podman-desktop/podman-desktop", org: "podman-desktop" },
        { repo: "axel7083/podman-desktop", org: "axel7083" },
        { repo: "podman-desktop/extension-minikube", org: "podman-desktop" },
        { repo: "axel7083/foobar-tmp-demo", org: "axel7083" },
        { repo: "org-x/gone", org: "unknown" },
      ]);
    } finally {
      await db.$client.end();
    }
  });
});
