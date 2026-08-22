export function publicConfig(env = {}) {
  return {
    checkoutUrl: normalizePublicUrl(env.RADIO_CHECKOUT_URL)
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
