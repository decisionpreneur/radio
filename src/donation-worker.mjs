const LEMON_CHECKOUTS_API = "https://api.lemonsqueezy.com/v1/checkouts";
const DEFAULT_DONATION_CENTS = 500;

export async function handleDonationCheckout(context, options = {}) {
  if (context.request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const config = donationConfig(context.env);
  if (!config.ok) {
    return json({ ok: false, error: "donation_checkout_unconfigured" }, 503);
  }

  const input = await readInput(context.request);
  if (!input.ok) return json(input.body, input.status);

  const customPrice = donationCents(input.body);
  if (!customPrice) {
    return json({ ok: false, error: "donation_amount_invalid" }, 422);
  }

  const checkout = await requestCheckout({
    ...config,
    customPrice,
    fetcher: options.fetcher ?? fetch
  });

  if (!checkout.ok) {
    return json({ ok: false, error: checkout.error }, checkout.status);
  }

  return json({ ok: true, url: checkout.url });
}

async function readInput(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      status: 400,
      body: { ok: false, error: "invalid_json" }
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      body: { ok: false, error: "invalid_json" }
    };
  }
  return { ok: true, status: 200, body };
}

async function requestCheckout({ apiKey, storeId, variantId, customPrice, fetcher }) {
  let response;
  try {
    response = await fetcher(LEMON_CHECKOUTS_API, {
      method: "POST",
      headers: {
        Accept: "application/vnd.api+json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/vnd.api+json"
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            custom_price: customPrice
          },
          relationships: {
            store: {
              data: {
                type: "stores",
                id: storeId
              }
            },
            variant: {
              data: {
                type: "variants",
                id: variantId
              }
            }
          }
        }
      })
    });
  } catch {
    return { ok: false, status: 502, error: "donation_provider_unreachable" };
  }

  const body = await readProviderJson(response);
  if (!response.ok) {
    return {
      ok: false,
      status: providerFailureStatus(response.status),
      error: normalizeText(body?.errors?.[0]?.detail || body?.errors?.[0]?.title) || "donation_provider_error"
    };
  }

  const url = normalizeHttpsUrl(body?.data?.attributes?.url);
  if (!url) {
    return { ok: false, status: 502, error: "donation_checkout_response_invalid" };
  }
  return { ok: true, status: response.status, url };
}

async function readProviderJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function donationConfig(env = {}) {
  const apiKey = normalizeText(env.RADIO_DONATION_LEMONSQUEEZY_API_KEY || env.RADIO_LEMONSQUEEZY_API_KEY);
  const storeId = normalizeText(env.RADIO_DONATION_STORE_ID || env.RADIO_LEMONSQUEEZY_STORE_ID);
  const variantId = normalizeText(env.RADIO_DONATION_VARIANT_ID);
  return {
    ok: Boolean(apiKey && storeId && variantId),
    apiKey,
    storeId,
    variantId
  };
}

function donationCents(body) {
  const amount = body.amountUsd ?? body.amount ?? body.usd;
  if (amount === undefined || amount === null || amount === "") return DEFAULT_DONATION_CENTS;
  const cents = Math.round(Number(amount) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : 0;
}

function providerFailureStatus(status) {
  return status >= 500 ? 502 : 400;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeHttpsUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
