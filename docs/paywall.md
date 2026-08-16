# Paywall

## Verbatim Prompt Sources

```text
preferably without backend or db at all (but where paywalling stores its data then??) to use cf workers/pages nothiong more
```

```text
tech-wise it should aim at lean donation-based with further paywalling
```

```text
ok what is the most lean paywall enablement? can paywalling be delegated to stripe paypal etc without ruining lean-frontend-only?
```

```text
ok propose the leanest solution preferably if some saas handles paywolling for us
```

```text
for percentage commision not fixed payment
```

```text
uruguay jursidiction supported preferable but not a must
```

```text
licence key is ok
```

```text
i think lincences \n sepratated list can be stored in cloudflare thus keeping it frontend only
```

```text
yeah just the leanest possible
```

```text
implement radio with paywall
```

## Implemented Shape

The app gates live playback, MIDI output, and MIDI export behind a license key.

The static page still renders the controls and preview. The paid path starts when a license key and payment email are submitted to:

```text
/api/license/activate
```

The browser revalidates a stored entitlement through:

```text
/api/license/validate
```

## Where Paywall Data Lives

No app database is used.

Two sources are supported:

- Lemon Squeezy stores orders, license keys, license status, customer email, product id, variant id, and license instances.
- Cloudflare Pages environment variable `RADIO_LICENSE_KEYS` can hold a newline-separated license-key list.

The browser stores only its local entitlement copy:

- license key
- payment email
- provider
- license status
- instance id
- expiry
- product id
- variant id
- customer email
- last check time

## Cloudflare Pages Functions

Files:

- `functions/api/license/activate.js`
- `functions/api/license/validate.js`
- `src/license-worker.mjs`

The Functions use `context.env` for Cloudflare-side values.

Environment variables:

```text
RADIO_LICENSE_KEYS
RADIO_SPECIAL_USE_KEYS
RADIO_CHECKOUT_URL
RADIO_LICENSE_REQUIRE_EMAIL
RADIO_LEMONSQUEEZY_PRODUCT_ID
RADIO_LEMONSQUEEZY_VARIANT_ID
```

`RADIO_LICENSE_REQUIRE_EMAIL=0` disables the payment-email requirement. Any other value, including an unset value, keeps payment email required.

`RADIO_LICENSE_KEYS` unlocks matching manual keys. When a Lemon Squeezy product id or variant id is configured, non-matching submitted keys still pass to Lemon Squeezy validation.

`RADIO_SPECIAL_USE_KEYS` unlocks matching special-use keys before the payment-email requirement.

## Lemon Squeezy

Activation request:

```text
POST https://api.lemonsqueezy.com/v1/licenses/activate
```

Validation request:

```text
POST https://api.lemonsqueezy.com/v1/licenses/validate
```

The Function accepts a license only when:

- provider response says activated or valid
- license status is `active`
- payment email matches when Lemon Squeezy returns customer email
- product id matches `RADIO_LEMONSQUEEZY_PRODUCT_ID` when configured
- variant id matches `RADIO_LEMONSQUEEZY_VARIANT_ID` when configured

## Cloudflare License List

`RADIO_LICENSE_KEYS` format:

```text
first-license-key
second-license-key
third-license-key
```

`RADIO_SPECIAL_USE_KEYS` uses the same newline-separated format.

The Function hashes the submitted key and each configured key with SHA-256 before comparison.

## Checkout And Donation

The app has two configurable outbound link slots:

```text
RADIO_CHECKOUT_URL
data-donation-url
```

If either value is empty, that link is hidden by the app.
