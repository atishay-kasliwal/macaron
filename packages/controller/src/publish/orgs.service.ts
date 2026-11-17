import { Injectable } from "@nestjs/common";
import { type OrgRow, type OrgsPage, repoKey, RepoSlug } from "@open-macaron/contracts";
import { RepoConfigService } from "../config/repo-config.service.ts";
import { ForkRegistry } from "./fork-registry.ts";

interface Keyed {
  readonly key: string;
  readonly org: string;
  readonly repo: RepoSlug | null;
  readonly fallback: boolean;
}

/**
 * The configured orgs and how far each repository's onboarding went: the repositories an org lists,
 * and those its fallback onboarded on a first request. The configuration is the source: a repository
 * that left it keeps its fork (nothing deletes one), and must not be listed.
 */
@Injectable()
export class OrgsService {
  constructor(
    private readonly config: RepoConfigService,
    private readonly forks: ForkRegistry,
  ) {}

  /**
   * A page of rows: one per repository, one for an org without any. The cursor is a row's key, not
   * an offset: a configuration reloaded between two pages neither repeats nor skips a row.
   */
  async page(limit: number, after: string | undefined): Promise<OrgsPage> {
    const { orgs, repos } = this.config.snapshot;
    const ready = await this.forks.readyForks();
    const keyed: Keyed[] = [...repos.values()].map(({ org, repo }) => ({ key: `${org.toLowerCase()}/${repoKey(repo)}`, org, repo, fallback: false }));
    for (const key of ready.keys()) {
      const config = this.config.repo(key);
      if (config?.fallback === true) keyed.push({ key: `${config.org.toLowerCase()}/${key}`, org: config.org, repo: config.repo, fallback: true });
    }
    const populated = new Set(keyed.map((row) => row.org));
    for (const { org } of orgs.values()) if (!populated.has(org)) keyed.push({ key: `${org.toLowerCase()}/`, org, repo: null, fallback: false });
    // By code unit, as the cursor is compared. Logins hold no `/`, so an org's rows stay together.
    const sorted = keyed.filter((row) => after === undefined || row.key > after).sort((a, b) => (a.key < b.key ? -1 : 1));
    const page = sorted.slice(0, limit);
    const rows = page.map(({ org, repo, fallback }): OrgRow => {
      const fork = repo === null ? undefined : ready.get(repoKey(repo));
      return { org, repo, fork: fork === undefined ? null : RepoSlug.parse(`${fork.owner}/${fork.repo}`), fallback };
    });
    return { rows, nextCursor: sorted.length > limit ? (page.at(-1)?.key ?? null) : null };
  }
}
