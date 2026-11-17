# macaron-bot — how the system scales

This doc covers how we go from 1 to ~30 repos and beyond, across projects that look nothing alike. A Podman Desktop extension and Podman Desktop itself are a good example of the range. It answers four questions: who defines a repo's environment, where configuration lives, who owns what, and which limits we hit first.

## 1. Environments: shared, own, or upstream-provided

**Constraint.** The setup has to run **in the same job** as the agent, because a job is one machine. A per-repo *workflow* can't do that: a separate workflow or job runs on another VM, and a reusable workflow call can't add steps around the agent. A per-repo *composite action* can. GitHub resolves a local action (`uses: ./path`) when the step runs, from whatever is in the workspace at that moment. So one fixed `run.yml` can load a different environment for each repo.

```
 open-macaron/runner  run.yml  (the only workflow; reviewed by maintainers; can't be altered per repo)
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ runs-on: ${{ inputs.runs-on }}       permissions: { id-token: write, contents: read } only       │
 │  1 checkout upstream @ base SHA (+ fork branch)                                                  │
 │  2 resolve environment ──┬─ shared   → copy runner/environments/<name>/        → ./.macaron/env  │
 │                          ├─ own      → copy runner/environments/repos/<o>/<r>/ → ./.macaron/env  │
 │                          └─ upstream → copy <upstream>@base:<path from config> → ./.macaron/env  │
 │  3 uses: ./.macaron/env   with: { work, params }             ← per-repo code runs here           │
 │  4 bootstrap (OIDC → key + context)       ← after setup: the key is never handed to env code     │
 │  5 harness → 6 validate result → 7 upload artifact                                               │
 └──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Source | Lives in | Owned by | Best for |
|---|---|---|---|
| **shared** | `runner/environments/<name>/action.yml` + `params` from config | Platform maintainers | Fleets of similar repos: Podman Desktop extensions, generic Node/Python/Go via `mise` |
| **own** | `runner/environments/repos/<o>/<r>/action.yml` | Platform maintainers review it (no per-folder owners yet; none exists today) | Complex repos whose upstream hasn't adopted macaron |
| **upstream** | `<upstream>/<path>/action.yml` at the **base SHA**, `path` under `.github/macaron/` (from config) | The upstream maintainers | Repos that want their environment versioned with their code |

**Why `upstream` is the best long-term option.** The environment changes in the same commits as the code: a pnpm or Electron bump updates both together, and old release branches keep a matching environment. It is always read from the upstream base SHA, never from the bot's branch, so the agent can't change the environment of its own next run.

**What this keeps safe:**
- If environment code redeems the ticket itself, the real bootstrap gets a 409 and the controller revokes the key at once. The worst case is a failed run, never a leaked credential.
- `permissions`, the bootstrap, the harness and the upload stay in `run.yml`. No environment source can change them.
- Environment code runs **before** bootstrap, in a job with no secrets.
- The org's Actions policy (allow-list, full-SHA pinning) also applies to every `uses:` inside an environment, including an upstream-provided one.
- The OIDC check stays simple: `workflow_ref` must be `open-macaron/runner/.github/workflows/run.yml@refs/heads/main`.

**What a composite can't do, and the workaround:**
- `services:` → start containers with `podman run` in a step.
- `container:` → the `devcontainer` shared environment runs the agent through the devcontainer CLI.
- `runs-on` → a dispatch input, set from config.

### Example: Podman Desktop and its extensions

The Podman Desktop extensions share `runner/environments/podman-desktop-extensions/`. It takes the upstream checkout (`work`) and one optional parameter, `podmanDesktopVersion`, which defaults to the `@podman-desktop/api` version the extension's lockfile resolves, so each extension builds against the Podman Desktop version it targets. The `podman-desktop` org file sets it once (`defaults.environment`), and every extension inherits it.

Podman Desktop itself uses the shared `podman-desktop` environment (built from the checkout, `params: { machine: "true" }` for a Podman machine). `source: upstream` is open to it once its maintainers want the environment versioned with their own CI.

## 2. Configuration: a hierarchy, not one `trust.yaml`

One flat file doesn't scale in either direction. Every team would edit the same file, and every extension would repeat the same 15 lines. The configuration is a tree in its own repository, [`open-macaron/config`](https://github.com/open-macaron/config), merged **global → org → repo**, with the most specific value winning. An org file is one GitHub owner, an organisation or a user:

```
open-macaron/config
├── global.yaml                    defaults: harness, model, mode budgets, caps, concurrency
└── orgs/
    ├── podman-desktop/
    │   ├── OWNERS.yaml            who approves changes in this folder
    │   └── org.yaml               account id, review bots, monthly budget, concurrency,
    │                              defaults (environment: podman-desktop-extensions),
    │                              repos: { podman-desktop: …, extension-minikube: … }, fallback
    ├── redhat-developer/…
    └── <other-org>/…
```

```yaml
# orgs/podman-desktop/org.yaml (abridged)
org: podman-desktop
id: 129859460                                   # the account id: the controller follows a rename by it
owners: "@open-macaron/maintainers"             # the owning team; approvals come from OWNERS.yaml
bots: []                                        # review bots whose comments on the bot's PRs count
budget: { monthUsd: 60.00 }                     # every repository of the org, listed or not
concurrency: 2
defaults:
  runsOn: ubuntu-26.04
  knowledge: podman-desktop-extensions          # open-macaron/knowledge's projects/<knowledge>; the org's login if unset
  environment: { source: shared, name: podman-desktop-extensions, params: {} }
  budgets: { implement: 5.00, review: 0.50 }
repos:
  podman-desktop:
    knowledge: podman-desktop
    environment: { source: shared, name: podman-desktop, params: { machine: "true" } }
    commands: { build: pnpm build, test: pnpm test:unit, lint: pnpm lint:check }
  extension-minikube:                           # inherits the defaults' environment
    commands: { build: pnpm build, test: pnpm test, lint: pnpm lint:check }
fallback:                                       # every repository of the org it doesn't list; false (the default): none
  budget: { monthUsd: 10.00 }                   # pooled by those repositories, on top of the org's
  environment: { source: shared, name: generic, params: {} }
  caps: { perRepoMonthUsd: 5.00 }
```

A listed repository merges global → `defaults` → `repos.<name>`; a repository of the org it doesn't list merges global → `defaults` → `fallback`, or isn't trusted when `fallback` is `false`. The fallback lets an organisation open the bot to all its repositories without listing each one: they run in the generic environment, on a pooled monthly budget of their own on top of the org's, each still under `caps.perRepoMonthUsd`. Such a repository is forked on its first request, not when the configuration goes live (§5).

`org` is the login when the file was written; `id` is what the controller trusts. On every configuration it applies, it looks up each id's current login (`GET /user/{id}`, `OwnerLogins`) and matches repositories under that login only, so a renamed organisation keeps its configuration and its old name, which anyone could register, gets nothing. A failed lookup keeps the file's login. `ForkRegistry` also refuses an upstream whose owner isn't the org's id.

The controller works with the merged `RepoConfig` (`packages/contracts/src/config.ts`): the repository's `RepoSettings` (harness, model and per-mode models, fast model, `runsOn`, platforms, draft PRs, `compact` comments, timeout, environment, commands, contribution rules, budgets, review cost, caps) plus `repo`, `org`, `orgId`, `knowledge` (resolved: the org's login when unset), `fallback` and `bots`. Who may trigger the bot isn't in the configuration: it's an account of the web app, with the capabilities an administrator granted (DESIGN.md §7). An org file with a `users` list (the former way) is refused, and so is a leftover `projects/` file.

**The org is the unit we "don't work for free" for.** It has a budget and a concurrency share. Costs roll up repo → org → global in the ledger and the reports (the ledger's `org` column; rows from before orgs hold their project's name, so org budgets started from zero the month of the switch).

**Who owns what:**
- Each org folder's `OWNERS.yaml` gives its team its own folder: their approval merges it (`merge.yml` with `config-cli`, like knowledge). Adding or removing a repository entry is theirs, as long as it sets no reserved setting.
- The platform team owns `global.yaml`, new org files, and merges by hand any change to who an org file is or what it may spend or run on: `id`, `fallback`, `bots`, `budget`, `concurrency`, and `budgets`, `caps`, `reviewCost`, `runsOn`, `platforms` at the top level, under `defaults` or under a repository entry. `config-cli` detects them and leaves such PRs to it.

## 3. Knowledge follows the same hierarchy

```
knowledge/
├── global/                       rules for every repo; how macaron works; harness tips
├── projects/podman-desktop/      shared by every repo that names it (`knowledge`): rules, extension API, review culture
└── repos/<o>/<r>/                repo specifics: rules, build quirks, flaky tests, reviewer preferences
```

Each folder has its own `OWNERS.yaml`: a project's maintainers approve changes to their rules and lessons without write access to the repository (DESIGN.md §6.4).

Before all of these, the agent reads the upstream's own `AGENTS.md` / `CLAUDE.md`, which harnesses load natively. Our knowledge only holds what upstream doesn't say. Lessons that recur across extensions get promoted from `repos/` to `projects/` by the weekly `garden` run, so an extension learns from its siblings.

## 4. Keeping environments healthy: `env-check` (planned, #46)

An environment rots silently: a toolchain bump, or a host ref that moved. The bot would only find out mid-run, paying for tokens. A planned `runner/.github/workflows/env-check.yml` would run steps 1–3 of `run.yml`, followed by the repo's build and test commands, **with no agent and no key**:
- **on every PR to `runner`**, for the environments it touches, so a shared environment change is tested against all of its repos;
- **nightly**, for every active repo;
- **on a config PR** in `open-macaron/config`, by dispatch, for the repos it touches.

**Speed first.** The agent job does independent setup work in parallel: `macaron-agent prepare` clones the upstream at the base commit, fetches the fork branch and installs the pinned harness CLI concurrently. Only the environment step, which needs the checkout, waits. Triage runs skip the environment entirely. Dependency caching is a later optimisation: we will add it once we've decided how to keep a run from poisoning the cache that the next run restores.

Once it exists, a red env-check would pause the repo: the controller would answer "environment broken, maintainers notified" instead of spending a budget on it.

## 5. Onboarding becomes self-service

```
 org team: PR to open-macaron/config  orgs/<org>/org.yaml, repos.<r>   (+ environment if own/upstream)
   CI (check): the controller's validation ✓  OWNERS.yaml ✓  reserved settings flagged
   review: the folder's OWNERS.yaml owners; the platform team merges by hand reserved settings and new org files
 merge → Pages publishes → controller reloads (deployment_status) → live
 controller forks, Actions off, comments on the PR: REPOSITORIES.md §5
```

With a `fallback`, an org's other repositories need no PR at all: the first request on one waits until the controller has forked it (REPOSITORIES.md §5).

The platform team only reviews money and trust. Everything else is owned by the org.

## 6. Which limits we hit first

| Limit | Order of magnitude | Mitigation |
|---|---|---|
| **Reviewer attention** | The real bottleneck: humans review ~a few bot PRs per day per repo | WIP limit per repo (max open bot PRs, default 3). New `implement` requests queue with a visible position in the status comment |
| Actions concurrency | Per org plan (e.g. 20 jobs; macOS lower). Windows jobs also start and set up more slowly (a Podman machine takes minutes) | Controller queue with global and per-org shares, fair scheduling across orgs, interactive (`triage`) before batch (`implement`) |
| LLM spend (Bifrost) | Bounded by keys and budgets | Per-org monthly budgets, and a pooled one for an org's fallback repositories; the Router keeps chit-chat at ~$0.001 |
| GitHub API rate limits | 5,000 req/h per token | Conditional requests (304s are free), ETag caches, batched GraphQL for thread snapshots. About 50 calls per loop means roughly 100 loops/h per token before it matters |
| Controller | One replica on OpenShift | Stateless besides Postgres; a second instance is possible because pg-boss and the migration lock coordinate through Postgres. Unlikely to be needed before ~1,000 loops/day |
| One bot identity | All orgs share `macaron-bot` | Later, an org can bring its own identity (`<org>-bot`) with its own tokens; `RepoConfig` gains an `identity` field and the GitHub clients become per-identity |

## 7. What changes in the other docs

- `runner` holds one `run.yml` and `environments/` (`env-check.yml` is planned, §4). The `run-<profile>.yml` files are gone.
- `config/trust.yaml` becomes a tree in its own repository, open-macaron/config, one file per org (§2).
- `knowledge` gains a `projects/` level (§3).
