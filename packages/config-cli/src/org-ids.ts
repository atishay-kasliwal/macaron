import { OrgFile } from "@open-macaron/contracts";
import { parseYamlStrict, type Problem, statusOf } from "@open-macaron/owners";
import type { Octokit } from "@octokit/rest";

/**
 * check.yml: each org file's `id` must be the account its `org` login names. The controller trusts
 * the id; a login that drifted from it is caught here, before it confuses a reader.
 */
export async function checkOrgIds(octokit: Octokit, files: ReadonlyMap<string, string>): Promise<Problem[]> {
  const problems: Problem[] = [];
  for (const [path, source] of files) {
    if (!path.startsWith("orgs/")) continue;
    // Invalid files are reported by the validation itself.
    const org = OrgFile.safeParse(readable(source));
    if (!org.success) continue;
    const { id, org: login } = org.data;
    try {
      const { data } = await octokit.rest.users.getById({ account_id: id });
      if (data.login.toLowerCase() !== login.toLowerCase()) {
        problems.push({ path, message: `account ${String(id)} is now ${data.login}, not ${login}: update org and the folder (the id is what counts)` });
      }
    } catch (error: unknown) {
      if (statusOf(error) !== 404) throw error;
      problems.push({ path, message: `account ${String(id)} (${login}) doesn't exist` });
    }
  }
  return problems;
}

function readable(source: string): unknown {
  try {
    return parseYamlStrict(source);
  } catch {
    return undefined;
  }
}
