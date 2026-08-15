# Donation And Paywall Direction

## Lean Donation Version

The current app uses a static donation link slot in `web/index.html`.

No backend means no durable server-side entitlement state.

## Where Paywall Data Can Live

With no backend and no database, secure durable paywall state cannot live inside the static app. Anything stored only in frontend JavaScript or browser local storage can be copied or modified by the user.

A backendless-looking Cloudflare-only path is possible with a Worker:

- Payment provider remains the payment source of truth.
- Cloudflare Worker holds the signing secret.
- The user receives a signed entitlement token after payment.
- The browser stores that signed token locally.
- The Worker verifies the token before serving premium assets or enabling premium endpoints.

This path stores entitlement data in the signed token, not in an app database.

## When KV Or D1 Becomes Necessary

Use Cloudflare KV or D1 only if a later version needs:

- revocation
- cross-device account state
- quotas
- team seats
- server-visible customer history
- recoverable purchases without a user-held token

KV is read-heavy and eventually consistent. D1 is the database path when relational entitlement state is required.
