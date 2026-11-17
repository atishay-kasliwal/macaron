import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILE_PATH, fallbackSettings, GlobalFile, OrgFile, type RepoConfig, resolveRepoConfig } from "./config.ts";
import { RepoSlug } from "./ids.ts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export interface ConfigSnapshot {
  readonly global: GlobalFile;
  /** Keyed by the owner's account id. */
  readonly orgs: ReadonlyMap<number, OrgFile>;
  /** The repositories the orgs list, under the logins their files name; keyed by lower-cased `owner/name`. */
  readonly repos: ReadonlyMap<string, RepoConfig>;
  /** Each org's file (`orgs/<org>/org.yaml`), keyed by its id. */
  readonly orgFiles: ReadonlyMap<number, string>;
}

export class ConfigTreeError extends Error {
  // A plain field, not a parameter property: contracts' sources also run under Node's type stripping (gen).
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "ConfigTreeError";
    this.problems = problems;
  }
}

export function repoKey(repo: RepoSlug | string): string {
  return repo.toLowerCase();
}

const ORG_FILE = /^orgs\/([^/]+)\/org\.yaml$/;

/**
 * Validates a configuration given as its files (repository-relative path → content): `global.yaml`
 * and `orgs/<org>/org.yaml`. The single validation path, for a local `config/` tree and a published
 * snapshot alike. Collects every problem, with its path, before failing.
 */
export function parseConfigTree(files: ReadonlyMap<string, string>): ConfigSnapshot {
  const problems: string[] = [];
  // Sorted: which of two files claiming the same org is reported doesn't depend on the source.
  const paths = [...files.keys()].sort();

  function parseAs<T>(path: string, schema: z.ZodType<T>): T | undefined {
    const content = files.get(path);
    if (content === undefined) {
      problems.push(`${path}: missing`);
      return undefined;
    }
    let raw: unknown;
    try {
      raw = parseYaml(content, { strict: true, uniqueKeys: true });
    } catch (error: unknown) {
      problems.push(`${path}: ${error instanceof Error ? error.message : "unreadable"}`);
      return undefined;
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) problems.push(`${path}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      return undefined;
    }
    return result.data;
  }

  for (const path of paths) {
    if (CONFIG_FILE_PATH.test(path)) continue;
    problems.push(
      path.startsWith("projects/")
        ? `${path}: projects are gone: configure the repository in orgs/<org>/org.yaml`
        : `${path}: not a configuration file (global.yaml, orgs/<org>/org.yaml)`,
    );
  }

  const global = parseAs("global.yaml", GlobalFile);
  const orgs = new Map<number, OrgFile>();
  const orgFiles = new Map<number, string>();
  const repos = new Map<string, RepoConfig>();
  const logins = new Set<string>();

  for (const path of paths) {
    const folder = ORG_FILE.exec(path)?.[1];
    if (folder === undefined || !CONFIG_FILE_PATH.test(path)) continue;
    const org = parseAs(path, OrgFile);
    if (org === undefined) continue;
    if (org.org !== folder) {
      problems.push(`${path}: org "${org.org}" must live in orgs/${org.org}/`);
      continue;
    }
    const claimed = orgFiles.get(org.id);
    if (claimed !== undefined) {
      problems.push(`${path}: account ${String(org.id)} is already configured by ${claimed}`);
      continue;
    }
    if (logins.has(org.org.toLowerCase())) {
      problems.push(`${path}: ${org.org} is already configured`);
      continue;
    }
    logins.add(org.org.toLowerCase());
    orgs.set(org.id, org);
    orgFiles.set(org.id, path);
    if (global === undefined) continue;

    const merged = (what: string, resolve: () => void): void => {
      try {
        resolve();
      } catch (error: unknown) {
        const detail =
          error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : String(error);
        problems.push(`${path}: ${what}: after merging defaults: ${detail}`);
      }
    };
    for (const name of Object.keys(org.repos)) {
      merged(`repos.${name}`, () => {
        const config = resolveRepoConfig(global, org, RepoSlug.parse(`${org.org}/${name}`));
        if (config !== undefined) repos.set(repoKey(config.repo), config);
      });
    }
    // The fallback is checked now, not when a repository first needs it.
    if (org.fallback !== false) merged("fallback", () => fallbackSettings(global, org));
  }

  if (global === undefined || problems.length > 0) throw new ConfigTreeError(problems);
  return { global, orgs, repos, orgFiles };
}

/** Reads a local `config/` tree (only the files the layout defines), then validates it with {@link parseConfigTree}. */
export async function loadConfigTree(dir: string): Promise<ConfigSnapshot> {
  return parseConfigTree(await readConfigFiles(dir));
}

/** The configuration files of a local tree, keyed by path relative to `dir`. */
export async function readConfigFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const add = async (path: string): Promise<void> => {
    const content = await readFile(join(dir, path), "utf8").catch(() => undefined);
    if (content !== undefined) files.set(path, content);
  };
  await add("global.yaml");
  for (const org of await readdir(join(dir, "orgs"), { withFileTypes: true }).catch(() => [])) {
    if (org.isDirectory()) await add(`orgs/${org.name}/org.yaml`);
  }
  // A leftover projects/ tree is reported, not silently ignored.
  for (const project of await readdir(join(dir, "projects"), { withFileTypes: true }).catch(() => [])) {
    if (project.isDirectory()) await add(`projects/${project.name}/project.yaml`);
  }
  return files;
}
