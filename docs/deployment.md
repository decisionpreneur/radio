# Deployment

## Verbatim Prompt Sources

```text
keep that project code in radio crossrepo as per repo rules and artifacts/binaries in db radio folder
```

```text
preferably without backend or db at all (but where paywalling stores its data then??) to use cf workers/pages nothiong more
```

```text
for cicd and deployment conventions see infra and hardlinksdb reference
```

```text
i never said anything allowed to be local
```

## Component Repository Boundary

The `radio` repository contains generic component material:

- static browser app under `web`
- shared algorithm modules under `web/lib`
- generic Cloudflare Pages configuration in `wrangler.toml`
- component tests under `tests`
- artifact generator under `scripts`

Environment-specific CI/CD orchestration, credentials, account identifiers, private host targeting, and deployment values belong outside this component repository.

## Required Remote Delivery

The deliverable target is Cloudflare Pages or Cloudflare Workers Pages.

Local HTTP serving is not a delivery target.

## Current Cloudflare Blocker

Direct Cloudflare Pages deployment requires one of these exact capabilities:

- available `wrangler` executable authenticated to the target Cloudflare account
- Cloudflare API token and account id available to the deployment command
- connected Cloudflare deployment connector

Current inspected state:

```text
wrangler: not on PATH
CLOUDFLARE_API_TOKEN: absent
CF_API_TOKEN: absent
CLOUDFLARE_ACCOUNT_ID: absent
CF_ACCOUNT_ID: absent
```

## Component Verification

```text
tests/run
```

This runs the Node component tests and the static Cloudflare Pages readiness check.
