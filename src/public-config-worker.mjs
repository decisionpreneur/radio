const liveCommerce = Object.freeze({
  subscribe: "https://polyradio.lemonsqueezy.com/checkout/buy/2cb51cbc-4bec-4eee-bdf8-e720c5a92ff0?embed=1",
  give: "https://polyradio.lemonsqueezy.com/checkout/buy/aca74223-784a-49d9-add5-d6e7f98358f9?embed=1"
});

export function radioLinks(env = {}) {
  return {
    checkoutUrl: checkoutLink(env.RADIO_CHECKOUT_URL) || liveCommerce.subscribe,
    donationUrl: checkoutLink(env.RADIO_DONATION_URL) || liveCommerce.give
  };
}

export function answerRadioLinks({ env }) {
  return json(radioLinks(env));
}

function checkoutLink(candidate) {
  const text = String(candidate ?? "").trim();
  if (!text) return "";
  try {
    const link = new URL(text);
    if (link.protocol !== "https:") return "";
    if (link.hostname.endsWith(".lemonsqueezy.com") && link.pathname.startsWith("/checkout/buy/")) {
      link.searchParams.set("embed", link.searchParams.get("embed") || "1");
    }
    return link.href;
  } catch {
    return "";
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
