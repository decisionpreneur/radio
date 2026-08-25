export function publicConfig(env = {}) {
  return {
    checkoutUrl: normalizePublicUrl(env.RADIO_CHECKOUT_URL),
    donationUrl: normalizePublicUrl(env.RADIO_DONATION_URL),
    donationCheckout: hasDonationCheckout(env)
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

function hasDonationCheckout(env) {
  return Boolean(
    normalizeText(env.RADIO_DONATION_LEMONSQUEEZY_API_KEY || env.RADIO_LEMONSQUEEZY_API_KEY) &&
    normalizeText(env.RADIO_DONATION_STORE_ID || env.RADIO_LEMONSQUEEZY_STORE_ID) &&
    normalizeText(env.RADIO_DONATION_VARIANT_ID)
  );
}

function normalizeText(value) {
  return String(value ?? "").trim();
}
