# Deployment

## Verbatim Prompt Sources

```text
keep that project code in radio crossrepo as per repo rules and artifacts/binaries in db radio folder
```

```text
preferably without backend or db at all (but where paywalling stores its data then??) to use cf workers/pages nothiong more
```

```text
i think lincences \n sepratated list can be stored in cloudflare thus keeping it frontend only
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
- Cloudflare Pages Functions under `functions`
- component tests under `tests`
- artifact generator under `scripts`

Environment-specific credentials, account identifiers, private host targeting, and deployment values belong outside this component repository.

This component repository does not contain:

- Cloudflare API tokens
- Cloudflare account ids
- Wrangler direct-upload configuration
- GitHub Actions or other repo CI/CD workflows
- payment-provider secrets

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

The empty `Build command` field means no project build step is required. The `web` output directory is the static app directory that Cloudflare Pages uploads. The root `functions` directory is deployed by Cloudflare Pages as Pages Functions.

Paywall environment:

```text
RADIO_LICENSE_KEYS=
RADIO_SPECIAL_USE_KEYS=
RADIO_CHECKOUT_URL=
RADIO_LICENSE_REQUIRE_EMAIL=
RADIO_LEMONSQUEEZY_PRODUCT_ID=
RADIO_LEMONSQUEEZY_VARIANT_ID=
```

Use `RADIO_LICENSE_KEYS` as a newline-separated Cloudflare-side manual license list, use `RADIO_SPECIAL_USE_KEYS` as a newline-separated special-use license list, and use Lemon Squeezy product/variant constraints for hosted-checkout paid keys. `RADIO_CHECKOUT_URL` is the hosted checkout URL shown by the app. Do not commit live license keys or payment-provider account values into this repository.

Cloudflare documentation checked:

- https://developers.cloudflare.com/pages/configuration/git-integration/
- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
- https://developers.cloudflare.com/pages/functions/
- https://developers.cloudflare.com/pages/functions/get-started/
- https://developers.cloudflare.com/pages/functions/bindings/

Lemon Squeezy documentation checked:

- https://docs.lemonsqueezy.com/api/license-api
- https://docs.lemonsqueezy.com/api/license-api/activate-license-key
- https://docs.lemonsqueezy.com/api/license-api/validate-license-key
- https://docs.lemonsqueezy.com/guides/tutorials/license-keys

## Rejected Deployment Paths

Do not use these for this lean deployment:

- Wrangler direct upload
- Cloudflare API deployment
- GitHub Actions deployment
- GitLab CI deployment
- local HTTP server as delivery
- repository-stored license keys
- repository-stored provider secrets

## Component Verification

```text
tests/run
```

This runs the Node component tests and the static Cloudflare Pages readiness check. It is a manual component verification command, not CI/CD.
