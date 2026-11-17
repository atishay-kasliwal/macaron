---
"@open-macaron/contracts": minor
"@open-macaron/controller": minor
"@open-macaron/config-cli": minor
"@open-macaron/web": minor
---

The configuration is per GitHub organisation: `orgs/<org>/org.yaml` replaces `projects/`. An org file names its owner by account id, lists its repositories under `repos`, and may give every repository it doesn't list a `fallback` (any repository setting). The controller follows a renamed org by its id, forks a fallback repository on its first request, and refuses archived ones. There is no org budget (the former project budget is gone): every run is paid by whoever asked for it, under their own monthly cap, with the per-repository and per-thread caps as before; the ledger records each row's org, existing rows included. config-cli reserves `id` and `fallback` for the platform team and checks each org's id. The web app's Projects page becomes Organisations (`GET /v1/orgs`).
