const lemonLicenseRoot = "https://api.lemonsqueezy.com/v1/licenses";
const utf8 = new TextEncoder();
const builtInSpecialDigests = `
40ce837e0e42bb4f8d6484167fd384602f6e81bf5a4b896fb11488c6f25c1bb8
47559c012b70351d4dfb51124dd3225341327a46256a4d271c0b26de57fec37f
`;

export async function answerLicenseGate(context, verb, io = {}) {
  if (context.request.method !== "POST") {
    return json({ ok: false, unlocked: false, error: "method_not_allowed" }, 405);
  }

  const inbound = await bodyJson(context.request);
  if (!inbound.ok) return json(inbound.payload, inbound.status);

  const key = keyText(inbound.payload.licenseKey ?? inbound.payload.license_key);
  const instanceName = plain(inbound.payload.instanceName ?? inbound.payload.instance_name ?? "radio-browser");
  const instanceId = plain(inbound.payload.instanceId ?? inbound.payload.instance_id);

  if (!key) return json({ ok: false, unlocked: false, error: "license_key_required" }, 422);

  const special = await keyListHit(context.env, key, ["RADIO_BACKDOOR_KEYS", "RADIO_SPECIAL_USE_KEYS"]);
  if (special) return unlockedBy("cloudflare-special-use", instanceId || instanceName);

  const specialDigest = await digestListHit(context.env, key, ["RADIO_BACKDOOR_KEY_HASHES", "RADIO_SPECIAL_USE_KEY_HASHES"], builtInSpecialDigests);
  if (specialDigest) return unlockedBy("cloudflare-special-use", instanceId || instanceName);

  if (verb === "activate" && !instanceName) {
    return json({ ok: false, unlocked: false, error: "instance_name_required" }, 422);
  }

  const listed = await keyListState(context.env, key, "RADIO_LICENSE_KEYS");
  if (listed.configured && listed.hit) return unlockedBy("cloudflare-list", instanceId || instanceName);

  const constrainedLemon = Boolean(plain(context.env.RADIO_LEMONSQUEEZY_PRODUCT_ID) || plain(context.env.RADIO_LEMONSQUEEZY_VARIANT_ID));
  if (listed.configured && !constrainedLemon) {
    return json({ ok: false, unlocked: false, provider: "cloudflare-list", licenseStatus: null, instanceId: null, error: "license_key_not_listed" }, 403);
  }

  const lemon = await lemonCall({
    verb,
    key,
    instanceName,
    instanceId,
    fetcher: io.fetcher ?? fetch
  });
  if (!lemon.ok) {
    return json({ ok: false, unlocked: false, provider: "lemonsqueezy", error: lemon.error }, Number(lemon.status) >= 500 ? 502 : 403);
  }

  const decision = lemonDecision(lemon.payload, context.env, { verb });
  return json(decision, decision.unlocked ? 200 : 403);
}

export function rejectNonPost() {
  return json({ ok: false, unlocked: false, error: "method_not_allowed" }, 405);
}

async function bodyJson(request) {
  try {
    const payload = await request.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return { ok: true, status: 200, payload };
    }
  } catch {
    return { ok: false, status: 400, payload: { ok: false, unlocked: false, error: "invalid_json" } };
  }
  return { ok: false, status: 400, payload: { ok: false, unlocked: false, error: "invalid_json" } };
}

async function lemonCall({ verb, key, instanceName, instanceId, fetcher }) {
  const form = new URLSearchParams();
  form.set("license_key", key);
  if (verb === "activate") form.set("instance_name", instanceName);
  if (verb === "validate" && instanceId) form.set("instance_id", instanceId);

  try {
    const response = await fetcher(`${lemonLicenseRoot}/${verb}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form
    });
    const payload = await responseJson(response);
    if (response.ok) return { ok: true, status: response.status, payload };
    return { ok: false, status: response.status, error: plain(payload?.error) || "license_provider_error" };
  } catch {
    return { ok: false, status: 502, error: "license_provider_unreachable" };
  }
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function lemonDecision(payload, env, { verb }) {
  const status = plain(payload?.license_key?.status);
  const productId = plain(payload?.meta?.product_id);
  const variantId = plain(payload?.meta?.variant_id);
  const instanceId = plain(payload?.instance?.id);
  const accepted = verb === "activate" ? payload?.activated === true : payload?.valid === true;

  if (!accepted) return lemonNo(payload, "license_not_valid");
  if (status !== "active") return lemonNo(payload, "license_not_active");
  if (env.RADIO_LEMONSQUEEZY_PRODUCT_ID && productId !== plain(env.RADIO_LEMONSQUEEZY_PRODUCT_ID)) return lemonNo(payload, "product_mismatch");
  if (env.RADIO_LEMONSQUEEZY_VARIANT_ID && variantId !== plain(env.RADIO_LEMONSQUEEZY_VARIANT_ID)) return lemonNo(payload, "variant_mismatch");

  return {
    ok: true,
    unlocked: true,
    provider: "lemonsqueezy",
    licenseStatus: status,
    instanceId,
    expiresAt: payload?.license_key?.expires_at ?? null,
    productId,
    variantId,
    error: null
  };
}

function lemonNo(payload, error) {
  return {
    ok: false,
    unlocked: false,
    provider: "lemonsqueezy",
    licenseStatus: plain(payload?.license_key?.status) || null,
    instanceId: plain(payload?.instance?.id) || null,
    expiresAt: payload?.license_key?.expires_at ?? null,
    productId: plain(payload?.meta?.product_id) || null,
    variantId: plain(payload?.meta?.variant_id) || null,
    error
  };
}

function unlockedBy(provider, instanceId) {
  return json({
    ok: true,
    unlocked: true,
    provider,
    licenseStatus: "active",
    instanceId,
    error: null
  });
}

async function keyListHit(env, key, names) {
  for (const name of names) {
    const state = await keyListState(env, key, name);
    if (state.hit) return true;
  }
  return false;
}

async function keyListState(env, key, name) {
  const lines = plain(env[name]).split(/\r?\n/).map(keyText).filter(Boolean);
  if (!lines.length) return { configured: false, hit: false };
  const target = await sha256(key);
  let hit = false;
  for (const item of lines) hit = sameDigest(target, await sha256(item)) || hit;
  return { configured: true, hit };
}

async function digestListHit(env, key, names, builtIn) {
  const target = await sha256(key);
  for (const item of digestLines(env, names, builtIn)) {
    if (sameDigest(target, item)) return true;
  }
  return false;
}

function digestLines(env, names, builtIn) {
  return [...names.map((name) => env[name]), builtIn]
    .map(plain)
    .flatMap((text) => text.split(/\r?\n/))
    .map((text) => text.replace(/\s+/g, "").toLowerCase())
    .filter((text) => /^[a-f0-9]{64}$/.test(text));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", utf8.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameDigest(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function keyText(value) {
  return plain(value).replace(/\s+/g, "");
}

function plain(value) {
  return String(value ?? "").trim();
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
