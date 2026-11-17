import { CONFIG_FILE_PATH } from "@open-macaron/contracts";
import { parseYamlStrict, type PullContext, statusOf } from "@open-macaron/owners";
import { z } from "zod";

/**
 * Settings an org's owners may not change on their own (SCALING.md §2): whose comments the bot
 * counts, and what it may spend or run on. In org.yaml at the top level, under `defaults` and under
 * each `repos.<r>`; adding or removing a repository without them is the owners' call.
 */
const RESERVED: readonly string[] = ["bots", "budget", "concurrency", "budgets", "caps", "reviewCost", "runsOn", "platforms"];

/**
 * Top-level keys reserved as a whole: which account the file trusts, and the fallback, which
 * trusts every repository the org doesn't list.
 */
const RESERVED_TOP: readonly string[] = ["id", "fallback"];

const Mapping = z.record(z.string(), z.unknown());

/** A file's content on a ref: its text, undefined when absent, null when not readable as a file. */
type Content = string | undefined | null;

/** The reserved settings of a configuration file's content, canonical; undefined when it can't be read as a mapping. */
function reservedOf(source: Content): string | undefined {
  if (source === null) return undefined;
  if (source === undefined) return canonical({ top: {}, defaults: {}, repos: {} });
  let parsed: unknown;
  try {
    parsed = parseYamlStrict(source);
  } catch {
    return undefined;
  }
  const root = Mapping.safeParse(parsed ?? {});
  if (!root.success) return undefined;
  const defaults = Mapping.safeParse(root.data["defaults"] ?? {});
  const repos = Mapping.safeParse(root.data["repos"] ?? {});
  if (!defaults.success || !repos.success) return undefined;
  const pick = (mapping: Readonly<Record<string, unknown>>, keys: readonly string[]) => Object.fromEntries(keys.filter((key) => key in mapping).map((key) => [key, mapping[key]]));
  const entries: [string, Record<string, unknown>][] = [];
  for (const [name, entry] of Object.entries(repos.data)) {
    const settings = Mapping.safeParse(entry ?? {});
    if (!settings.success) return undefined;
    const reserved = pick(settings.data, RESERVED);
    // A repository without reserved settings is the same as no repository: listing it is the owners' call.
    if (Object.keys(reserved).length > 0) entries.push([name.toLowerCase(), reserved]);
  }
  return canonical({ top: pick(root.data, [...RESERVED, ...RESERVED_TOP]), defaults: pick(defaults.data, RESERVED), repos: Object.fromEntries(entries) });
}

/** JSON with sorted keys: YAML key order isn't a change. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const mapping = Mapping.safeParse(value);
  if (mapping.success && value !== null && typeof value === "object") {
    return `{${Object.keys(mapping.data)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(mapping.data[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether changing a configuration file from `before` to `after` (undefined: absent, null: not a file) touches a
 * reserved setting. Unreadable content counts as touching one: the platform team decides.
 */
export function changesReserved(before: Content, after: Content): boolean {
  const was = reservedOf(before);
  const is = reservedOf(after);
  return was === undefined || is === undefined || was !== is;
}

/**
 * `MergePolicy.platformPaths` for open-macaron/config: the PR's org files whose
 * reserved settings differ between the default branch and the PR's head. The head's content only
 * ever makes a PR stricter to merge, so reading it here is safe.
 */
export async function reservedPaths({ octokit, repository, files, headSha, defaultBranch }: PullContext): Promise<string[]> {
  const read = async (path: string, ref: string): Promise<Content> => {
    try {
      const response = await octokit.rest.repos.getContent({ ...repository, path, ref, mediaType: { format: "raw" } });
      const text = z.string().safeParse(response.data);
      // Not a file's text (a directory, a submodule): unreadable, so reserved.
      return text.success ? text.data : null;
    } catch (error: unknown) {
      if (statusOf(error) === 404) return undefined;
      throw error;
    }
  };
  const reserved: string[] = [];
  for (const file of files) {
    if (!CONFIG_FILE_PATH.test(file.path) || file.path === "global.yaml") continue;
    const before = await read(file.previousPath ?? file.path, defaultBranch);
    const after = await read(file.path, headSha);
    if (changesReserved(before, after)) reserved.push(file.path);
  }
  return reserved;
}
