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
    return url.href;
  } catch {
    return "";
  }
}
