const FALLBACK_CHECKOUT_URL = "https://polyradio.lemonsqueezy.com/checkout/buy/2cb51cbc-4bec-4eee-bdf8-e720c5a92ff0?embed=1";
const FALLBACK_DONATION_URL = "https://polyradio.lemonsqueezy.com/checkout/buy/aca74223-784a-49d9-add5-d6e7f98358f9?embed=1";

export function publicConfig(env = {}) {
  return {
    checkoutUrl: normalizePublicUrl(env.RADIO_CHECKOUT_URL) || FALLBACK_CHECKOUT_URL,
    donationUrl: normalizePublicUrl(env.RADIO_DONATION_URL) || FALLBACK_DONATION_URL
  };
}

export async function handlePublicConfig(context) {
  return Response.json(publicConfig(context.env), {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function normalizePublicUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    if (
      url.hostname.endsWith(".lemonsqueezy.com") &&
      url.pathname.startsWith("/checkout/buy/") &&
      !url.searchParams.has("embed")
    ) {
      url.searchParams.set("embed", "1");
    }
    return url.href;
  } catch {
    return "";
  }
}
