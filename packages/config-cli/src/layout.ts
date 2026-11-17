import type { OwnersLayout } from "@open-macaron/owners";

/**
 * open-macaron/config's layout: each `orgs/<org>/` is owned by the owners in its `OWNERS.yaml`.
 * Everything else (`global.yaml`, the repository's own files, `.github/`) is the platform team's.
 */
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export function folderOf(path: string): { readonly path: string } | undefined {
  const [top, org, ...rest] = path.split("/");
  if (top !== "orgs" || org === undefined || rest.length === 0 || !LOGIN.test(org)) return undefined;
  return { path: `orgs/${org}` };
}

export const configLayout: OwnersLayout = { folderOf };

/** Files allowed outside the configuration itself, maintained by the platform team. */
export function isRepositoryFile(path: string): boolean {
  return path === "README.md" || path === "LICENSE" || path === ".gitignore" || path === ".editorconfig" || path.startsWith(".github/");
}
