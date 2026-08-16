# Course Conversion

## Verbatim Prompt Sources

```text
old course must be converted to contemporary lean zero ru-ties worldnet no runet solutions
```

```text
read the materials transcribing if needed and tell me
```

```text
preferably without backend or db at all (but where paywalling stores its data then??) to use cf workers/pages nothiong more
```

```text
yeah just the leanest possible
```

```text
licence key is ok
```

```text
i think lincences \n sepratated list can be stored in cloudflare thus keeping it frontend only
```

## Source Material Used

The converted source material is the transcribed old radio course under:

```text
C:\Users\j\Dropbox\Musica\radio\course-transcripts-en
```

Old-course dependency evidence in the transcripts:

- `lesson-1-creation.txt`: creates a radio station on `101.ru`.
- `lesson-2-advertising.txt`: creates paid advertising tasks on `VMA Mail` / WMMail.
- `lesson-3-station-setup.txt`: continues task-based setup.
- `lesson-5-wallet-payments.txt`: uses manual electronic wallets, including Qiwi-like wallet flow in the transcription.
- `lesson-6-sms-payments.txt`: uses SMS payment processing and a hosted script page.

The extracted course document also contained a WMMail task script requiring a station visit, a social-network share, a before/after like count report, and a social profile link. The extracted HTML payment page used an SMSCoin donation script.

## Old-Course Heuristic Value

The old course is useful only as launch-order heuristics:

- create a reachable product endpoint before promotion
- make the station/product URL the central object
- keep monetization setup separate from content setup
- verify the buyer admission path after payment setup

The old course is not useful as provider or traffic implementation material. Its specific services, payment scripts, paid-task traffic, and social mechanics stay excluded by the conversion rule below.

The old raw materials remain historical source material only. They are not runtime assets, launch dependencies, UI sources, or payment sources for this repo.

## Conversion Rule

The converted course is no longer a tutorial for a third-party hosted station, Runet task traffic, Runet social sharing, manual wallets, or SMS payment scripts.

The converted course is now a tutorial for shipping the repo-owned browser radio product as a worldnet static application with Cloudflare Pages delivery and Cloudflare Pages Functions entitlement checks.

Zero ru-ties in this conversion means:

- no `.ru` hosting or product dependency
- no 101-style hosted station dependency
- no WMMail or paid task exchange dependency
- no VK or other Runet social-network dependency
- no Qiwi/YooMoney/manual-wallet payment path
- no SMSCoin/SMS aggregator payment path
- no Russian-language funnel dependency

## Contemporary Lean Worldnet Stack

Implemented product:

- `web/index.html`: browser radio surface.
- `web/app.mjs`: live Web Audio, Web MIDI, MIDI export, and paywall gating.
- `web/lib/engine.mjs`: polymetric polymodulation engine.
- `functions/api/license`: Cloudflare Pages Function license activation and validation.
- `functions/api/config`: public checkout-link configuration endpoint.

Delivery:

- Cloudflare Pages Git integration.
- Repository: `decisionpreneur/radio`.
- Production branch: `master`.
- Build command: blank.
- Build output directory: `web`.
- Pages Functions directory: `functions`.
- No Wrangler direct upload.
- No Cloudflare API deployment.
- No repo CI/CD workflow.
- No local HTTP server as delivery target.

Paywall:

- Primary lean provider shape: hosted checkout plus license key validation.
- Implemented external provider: Lemon Squeezy license API.
- Implemented fallback: Cloudflare Pages environment variable `RADIO_LICENSE_KEYS` as a newline-separated allowlist.
- Implemented special-use fallback: Cloudflare Pages environment variable `RADIO_SPECIAL_USE_KEYS` as a newline-separated allowlist.
- No app database.
- No committed license keys.
- No committed payment-provider secrets.

Current provider evidence checked on 2026-08-15:

- Cloudflare Pages Git integration deploys from a connected GitHub or GitLab repository on push: https://developers.cloudflare.com/pages/get-started/git-integration/
- Cloudflare Pages Functions run server-side code without a dedicated server: https://developers.cloudflare.com/pages/functions/
- Lemon Squeezy license keys are generated per purchase and can be used as proof of paid access: https://docs.lemonsqueezy.com/help/licensing/generating-license-keys
- Lemon Squeezy supported bank-payout countries include Uruguay: https://docs.lemonsqueezy.com/help/getting-started/supported-countries
- Lemon Squeezy unsupported customer countries include Russian Federation: https://docs.lemonsqueezy.com/help/getting-started/supported-countries
- Lemon Squeezy fees are sale-based and payout-fee based, not a fixed monthly subscription in this lean setup: https://docs.lemonsqueezy.com/help/getting-started/fees

Field reports checked on 2026-08-15:

- Reddit SaaS threads contain mixed Lemon Squeezy reports: working MoR use for solo founders, and also approval/review/payout-hold friction.
- Conversion consequence: keep `RADIO_LICENSE_KEYS` as the operational fallback so paid users can be admitted manually if the checkout provider blocks, delays, or reviews the account.

## Course Replacement

Old lesson 1: create a station on `101.ru`.

Converted lesson 1: ship the owned radio application.

- Use the repo-owned browser radio under `web`.
- Use Cloudflare Pages Git integration for the public URL.
- Keep the app static and portable.
- Keep the algorithm in local repo code, not in a radio-host account.
- Use the Cloudflare Pages production URL or attached custom domain as the station URL.

Old lesson 2: buy traffic through WMMail task creation.

Converted lesson 2: publish the product link without paid task exchanges.

- Use the Cloudflare Pages URL as the canonical share target.
- Use owned content and direct audience channels chosen outside this repo.
- Do not use visit-for-pay, like-for-pay, or report-a-profile task mechanics.
- Do not make any Runet social network part of the launch path.
- Paid ads are not part of the lean version unless a later prompt names the exact non-Runet channel.

Old lesson 3: configure the station and related task flow.

Converted lesson 3: configure product controls and entitlement.

- Set app defaults in repo code only when they are generic.
- Leave user tuneables blank when randomization should decide them.
- Configure Cloudflare Pages environment variables for checkout and licenses.
- Keep `RADIO_LICENSE_KEYS` available for manual paid-user admission.

Old lesson 4: monetize through on-station ads, jingles, and ordering.

Converted lesson 4: monetize through product access first.

- Gate live playback, MIDI output, and MIDI export behind paid entitlement.
- Keep donation as a configurable static outbound link.
- Treat sponsored packs, branded presets, creator packs, or ad inventory as backlog, not lean launch.

Old lesson 5: accept payment through manual electronic wallets.

Converted lesson 5: use hosted checkout and license keys.

- Do not request wallet screenshots, manual payment proof, or direct wallet transfers.
- Let the hosted checkout provider hold order, tax, payment, and license state.
- Let Cloudflare Pages Functions validate license status.
- Use `RADIO_LICENSE_KEYS` only as a fallback allowlist or manual comp path.

Old lesson 6: add SMSCoin/SMS payment script to a site.

Converted lesson 6: remove SMS payment scripts.

- No SMS aggregator scripts.
- No old template payment HTML.
- No payment script copied into `web`.
- Checkout link comes from `RADIO_CHECKOUT_URL`.
- License validation stays in `functions/api/license`.

## Lean Launch Course

1. Build and verify the repo app:

```text
bash C:\git\radio\tests\run
```

2. Generate a DAW/manual-check MIDI artifact when needed:

```text
node C:\git\radio\scripts\generate-demo.mjs
```

3. Connect Cloudflare Pages in the dashboard:

```text
Workers & Pages -> Create application -> Pages -> Connect to Git
```

4. Use these Cloudflare Pages settings:

```text
Repository: decisionpreneur/radio
Production branch: master
Framework preset: None
Build command:
Build output directory: web
Root directory:
```

5. Configure paywall environment:

```text
RADIO_CHECKOUT_URL=
RADIO_LICENSE_KEYS=
RADIO_SPECIAL_USE_KEYS=
RADIO_LICENSE_REQUIRE_EMAIL=
RADIO_LEMONSQUEEZY_PRODUCT_ID=
RADIO_LEMONSQUEEZY_VARIANT_ID=
```

6. Configure hosted checkout:

- Create the product in Lemon Squeezy or the later chosen hosted checkout provider.
- Enable generated license keys.
- Copy the hosted checkout URL into `RADIO_CHECKOUT_URL`.
- If using Lemon Squeezy product or variant constraints, set `RADIO_LEMONSQUEEZY_PRODUCT_ID` and `RADIO_LEMONSQUEEZY_VARIANT_ID`.

7. Verify public paid access:

- Unlicensed browser: live playback, MIDI output, and export stay locked.
- Checkout link is visible only when `RADIO_CHECKOUT_URL` is configured.
- Paid user submits payment email plus license key.
- `/api/license/activate` returns an active entitlement.
- The app plays after entitlement validation.
- `/api/license/validate` preserves access for the same stored entitlement.

8. Operate the fallback:

- Add a paid or comped license key to `RADIO_LICENSE_KEYS` when provider-side activation is delayed.
- Add a special-use key to `RADIO_SPECIAL_USE_KEYS` when special access must avoid payment-email requirement.
- Remove the key from `RADIO_LICENSE_KEYS` when access must end.
- Keep the newline list in Cloudflare environment only.

## Backlog

These are not lean-version dependencies:

- provider webhooks
- customer portal deep integration
- affiliate program
- analytics provider
- email-service provider
- paid advertising channel
- stronger device-bound licensing
- subscription lifecycle beyond license validation
- sponsored or branded radio packs

Each provider added from backlog must pass the same zero ru-ties and no-Runet gate before use.
