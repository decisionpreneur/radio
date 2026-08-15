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

```text
how is it designed that it needs tokens? pages can work without tokens i just add repo in cf ui and no cicd nor tokens needed
```

```text
no api no cicd that way
```

```text
e.g you can read encerta.in frontend works this way
```

## Component Repository Boundary

The `radio` repository contains generic component material:

- static browser app under `web`
- shared algorithm modules under `web/lib`
- component tests under `tests`
- artifact generator under `scripts`

Environment-specific credentials, account identifiers, private host targeting, and deployment values belong outside this component repository.

This component repository does not contain:

- Cloudflare API tokens
- Cloudflare account ids
- Wrangler direct-upload configuration
- GitHub Actions or other repo CI/CD workflows

## Required Remote Delivery

The deliverable target is Cloudflare Pages Git integration configured through the Cloudflare dashboard.

Local HTTP serving is not a delivery target.

## Encerta Frontend Reference

Inspected local reference: `C:\git\encerta.in\frontend`.

Observed repo shape:

- Git repo on `master`.
- GitHub remote: `https://github.com/Encertain/frontend.git`
- GitLab remote: `https://gitlab.com/encerta.in/frontend.git`
- Root contains `index.html`, `accounts`, `fonts`, `static`, and `welcome`.
- No `package.json`.
- No `wrangler.toml`.
- No `.github/workflows`.
- `HEAD`: `6fab46f Merge branch 'feature/jt_improves' into 'master'`.

Public Cloudflare-facing observation for `https://encerta.in/`: DNS authority is Cloudflare nameserver `bjorn.ns.cloudflare.com`; HTTP response includes `Server: cloudflare`.

The inspected evidence supports a static frontend repository shape with Cloudflare-side configuration, not a repo-side Wrangler/API/CI/CD deployment path.

## Cloudflare Pages Setup

Cloudflare dashboard path:

`Workers & Pages` -> `Create application` -> `Pages` -> `Connect to Git`

Repository:

`decisionpreneur/radio`

Production branch:

`master`

Build settings:

```text
Framework preset: None
Build command:
Build output directory: web
Root directory:
```

The empty `Build command` field means no project build step is required. The `web` output directory is the static app directory that Cloudflare Pages uploads.

Cloudflare documentation checked:

- https://developers.cloudflare.com/pages/configuration/git-integration/
- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/

## Rejected Deployment Paths

Do not use these for this lean deployment:

- Wrangler direct upload
- Cloudflare API deployment
- GitHub Actions deployment
- GitLab CI deployment
- local HTTP server as delivery

## Component Verification

```text
tests/run
```

This runs the Node component tests and the static Cloudflare Pages readiness check. It is a manual component verification command, not CI/CD.
