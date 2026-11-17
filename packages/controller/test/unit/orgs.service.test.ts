import { fileURLToPath } from "node:url";
import { type ConfigSnapshot, loadConfigTree, type RepoConfig, RepoSlug } from "@open-macaron/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { BotIdentity } from "../../src/github/bot-identity.ts";
import { createGitHub } from "../../src/github/github.ts";
import { OrgsService } from "../../src/publish/orgs.service.ts";
import { testEnv } from "../support/env.ts";
import { FakeClock } from "../support/fakes.ts";
import { fixedConfig, forkRegistry, MemoryForkStore } from "../support/forks.ts";

const UPSTREAM = "axel7083/foobar-tmp-demo";
const env = testEnv();
const gh = createGitHub("test", "token", env.GITHUB_API_VERSION, { throttled: false });

class FixedIdentity extends BotIdentity {
  override get identity() {
    return { login: "macaron-bot", id: 7, email: "7+macaron-bot@users.noreply.github.com" };
  }
}

let snapshot: ConfigSnapshot;
let config: RepoConfig;

beforeAll(async () => {
  snapshot = await loadConfigTree(fileURLToPath(new URL("../../../contracts/test/fixtures/config", import.meta.url)));
  const found = snapshot.repos.get(UPSTREAM);
  if (found === undefined) throw new Error(`${UPSTREAM} missing from the fixtures`);
  config = found;
});

function service(tree: ConfigSnapshot, store: MemoryForkStore): OrgsService {
  const repoConfig = fixedConfig(env, tree);
  const registry = forkRegistry({ gh, bot: new FixedIdentity(gh, gh, gh, env), env, clock: new FakeClock(), store, config: repoConfig });
  return new OrgsService(repoConfig, registry);
}

/** The fixtures' orgs, with `repos` as the only listed repositories. */
function withRepos(...repos: readonly RepoConfig[]): ConfigSnapshot {
  return { ...snapshot, repos: new Map(repos.map((repo) => [repo.repo.toLowerCase(), repo])) };
}

describe("OrgsService", () => {
  it("lists every listed repository, by org", async () => {
    const { rows, nextCursor } = await service(snapshot, new MemoryForkStore()).page(100, undefined);

    expect(rows.filter((row) => row.repo !== null)).toHaveLength(snapshot.repos.size);
    expect(new Set(rows.map((row) => row.org))).toEqual(new Set([...snapshot.orgs.values()].map((org) => org.org)));
    const seen = rows.map((row) => row.org).filter((org, index, all) => org !== all[index - 1]);
    expect(seen).toHaveLength(snapshot.orgs.size);
    expect(rows.every((row) => !row.fallback)).toBe(true);
    expect(nextCursor).toBeNull();
  });

  it("lists a repository the org's fallback onboarded once its fork is ready, and no other", async () => {
    const store = new MemoryForkStore().ready("podman-desktop/extension-kind", "abc123-extension-kind").ready("redhat-developer/unlisted", "def456-unlisted");

    const { rows } = await service(snapshot, store).page(100, undefined);

    expect(rows.filter((row) => row.fallback)).toEqual([
      { org: "podman-desktop", repo: "podman-desktop/extension-kind", fork: "macaron-bot/abc123-extension-kind", fallback: true },
    ]);
    // redhat-developer has no fallback: its fork, left from before, isn't listed.
    expect(rows.some((row) => row.repo === "redhat-developer/unlisted")).toBe(false);
  });

  it("walks every row once, whatever the page size", async () => {
    const list = service(snapshot, new MemoryForkStore());
    const everything = (await list.page(100, undefined)).rows;
    const walked = [];
    let after: string | undefined;
    for (;;) {
      const { rows, nextCursor } = await list.page(2, after);
      expect(rows.length).toBeLessThanOrEqual(2);
      walked.push(...rows);
      if (nextCursor === null) break;
      after = nextCursor;
    }
    expect(walked).toEqual(everything);
  });

  it("gives a repository its fork once ready, and none before", async () => {
    const other = { ...config, repo: RepoSlug.parse("org-x/not-ready") };
    const store = new MemoryForkStore().ready(UPSTREAM, "abc123-foobar-tmp-demo");
    await store.record({ upstreamId: 99, upstreamKey: "org-x/not-ready", forkId: 199, forkName: "def456-not-ready" });

    const { rows } = await service(withRepos(config, other), store).page(100, undefined);

    const listed = rows.filter((row) => row.repo !== null);
    expect(listed).toEqual([
      { org: config.org, repo: UPSTREAM, fork: "macaron-bot/abc123-foobar-tmp-demo", fallback: false },
      { org: config.org, repo: "org-x/not-ready", fork: null, fallback: false },
    ]);
  });

  it("gives an org without repositories a row of its own", async () => {
    const { rows } = await service(withRepos(), new MemoryForkStore()).page(100, undefined);

    expect(rows).toHaveLength(snapshot.orgs.size);
    expect(rows.every((row) => row.repo === null && row.fork === null)).toBe(true);
  });

  it("doesn't list a ready fork whose repository left the configuration", async () => {
    const store = new MemoryForkStore().ready("org-x/gone", "abc123-gone");

    const { rows } = await service(withRepos(config), store).page(100, undefined);

    expect(rows.filter((row) => row.repo !== null)).toEqual([{ org: config.org, repo: UPSTREAM, fork: null, fallback: false }]);
  });

  it("matches a fork whatever the case of the configured name, and keeps that case", async () => {
    const mixed = { ...config, repo: RepoSlug.parse("Axel7083/Foobar-Tmp-Demo") };
    const store = new MemoryForkStore().ready(UPSTREAM, "abc123-foobar-tmp-demo");

    const { rows } = await service(withRepos(mixed), store).page(100, undefined);

    expect(rows.filter((row) => row.repo !== null)).toEqual([{ org: config.org, repo: "Axel7083/Foobar-Tmp-Demo", fork: "macaron-bot/abc123-foobar-tmp-demo", fallback: false }]);
  });
});
