const LEMON_LICENSE_API = "https://api.lemonsqueezy.com/v1/licenses";
const TEXT_ENCODER = new TextEncoder();
const BUILT_IN_SPECIAL_USE_KEY_HASHES = `
d9d4be5ba722209bbf00fd4afc6b40d765059654a74e36af7af6a8e7af26984e
`;

export async function handleLicenseRequest(context, action, options = {}) {
  if (context.request.method !== "POST") {
    return json({ ok: false, unlocked: false, error: "method_not_allowed" }, 405);
  }

  const input = await readInput(context.request);
  if (!input.ok) return json(input.body, input.status);

  const licenseKey = normalizeKey(input.body.licenseKey ?? input.body.license_key);
  const email = normalizeEmail(input.body.email);
  const instanceName = normalizeText(input.body.instanceName ?? input.body.instance_name ?? "radio-browser");
  const instanceId = normalizeText(input.body.instanceId ?? input.body.instance_id);

  if (!licenseKey) {
    return json({ ok: false, unlocked: false, error: "license_key_required" }, 422);
  }

  const backdoorVerdict = await verifyCloudflareKeyLists(context.env, licenseKey, [
    "RADIO_BACKDOOR_KEYS",
    "RADIO_SPECIAL_USE_KEYS"
  ]);
  if (backdoorVerdict.configured && backdoorVerdict.unlocked) {
    return json({
      ok: true,
      unlocked: true,
      provider: "cloudflare-backdoor",
      licenseStatus: "active",
      instanceId: instanceId || instanceName,
      error: null
    });
  }

  const backdoorHashVerdict = await verifyKeyHashLists(context.env, licenseKey, [
    "RADIO_BACKDOOR_KEY_HASHES",
    "RADIO_SPECIAL_USE_KEY_HASHES"
  ], BUILT_IN_SPECIAL_USE_KEY_HASHES);
  if (backdoorHashVerdict.configured && backdoorHashVerdict.unlocked) {
    return json({
      ok: true,
      unlocked: true,
      provider: "cloudflare-backdoor",
      licenseStatus: "active",
      instanceId: instanceId || instanceName,
      error: null
    });
  }

  if (requiresEmail(context.env) && !email) {
    return json({ ok: false, unlocked: false, error: "checkout_email_required" }, 422);
  }
  if (action === "activate" && !instanceName) {
    return json({ ok: false, unlocked: false, error: "instance_name_required" }, 422);
  }

  const listVerdict = await verifyCloudflareKeyList(context.env, licenseKey, "RADIO_LICENSE_KEYS");
  if (listVerdict.configured && listVerdict.unlocked) {
    return json({
      ok: true,
      unlocked: true,
      provider: "cloudflare-list",
      licenseStatus: "active",
      instanceId: instanceId || instanceName,
      error: null
    });
  }
  const lemonConfigured = hasLemonConstraint(context.env);
  if (listVerdict.configured && !lemonConfigured) {
    return json({
      ok: false,
      unlocked: false,
      provider: "cloudflare-list",
      licenseStatus: null,
      instanceId: null,
      error: "license_key_not_listed"
    }, 403);
  }

  const providerResponse = await requestLemonLicense({
    action,
    licenseKey,
    instanceName,
    instanceId,
    fetcher: options.fetcher ?? fetch
  });

  if (!providerResponse.ok) {
    return json({
      ok: false,
      unlocked: false,
      provider: "lemonsqueezy",
      error: providerResponse.error
    }, providerResponse.status);
  }

  const verdict = evaluateLemonPayload(providerResponse.body, context.env, { action, email });
  return json(verdict, verdict.unlocked ? 200 : 403);
}

export function methodNotAllowed() {
  return json({ ok: false, unlocked: false, error: "method_not_allowed" }, 405);
}

async function readInput(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      status: 400,
      body: { ok: false, unlocked: false, error: "invalid_json" }
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      body: { ok: false, unlocked: false, error: "invalid_json" }
    };
  }
  return { ok: true, status: 200, body };
}

async function requestLemonLicense({ action, licenseKey, instanceName, instanceId, fetcher }) {
  const form = new URLSearchParams();
  form.set("license_key", licenseKey);
  if (action === "activate") form.set("instance_name", instanceName);
  if (action === "validate" && instanceId) form.set("instance_id", instanceId);

  let response;
  try {
    response = await fetcher(`${LEMON_LICENSE_API}/${action}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form
    });
  } catch {
    return { ok: false, status: 502, error: "license_provider_unreachable" };
  }

  const body = await readProviderJson(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: normalizeText(body?.error) || "license_provider_error"
    };
  }
  return { ok: true, status: response.status, body };
}

async function readProviderJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function evaluateLemonPayload(payload, env, { action, email }) {
  const status = normalizeText(payload?.license_key?.status);
  const productId = normalizeText(payload?.meta?.product_id);
  const variantId = normalizeText(payload?.meta?.variant_id);
  const customerEmail = normalizeEmail(payload?.meta?.customer_email);
  const instanceId = normalizeText(payload?.instance?.id);
  const providerUnlocked = action === "activate" ? payload?.activated === true : payload?.valid === true;

  if (!providerUnlocked) {
    return lemonVerdict(false, payload, "license_not_valid");
  }
  if (status !== "active") {
    return lemonVerdict(false, payload, "license_not_active");
  }
  if (env.RADIO_LEMONSQUEEZY_PRODUCT_ID && productId !== normalizeText(env.RADIO_LEMONSQUEEZY_PRODUCT_ID)) {
    return lemonVerdict(false, payload, "product_mismatch");
  }
  if (env.RADIO_LEMONSQUEEZY_VARIANT_ID && variantId !== normalizeText(env.RADIO_LEMONSQUEEZY_VARIANT_ID)) {
    return lemonVerdict(false, payload, "variant_mismatch");
  }
  if (email && customerEmail && email !== customerEmail) {
    return lemonVerdict(false, payload, "checkout_email_mismatch");
  }

  return {
    ok: true,
    unlocked: true,
    provider: "lemonsqueezy",
    licenseStatus: status,
    instanceId,
    expiresAt: payload?.license_key?.expires_at ?? null,
    productId,
    variantId,
    customerEmail,
    error: null
  };
}

function lemonVerdict(unlocked, payload, error) {
  return {
    ok: unlocked,
    unlocked,
    provider: "lemonsqueezy",
    licenseStatus: normalizeText(payload?.license_key?.status) || null,
    instanceId: normalizeText(payload?.instance?.id) || null,
    expiresAt: payload?.license_key?.expires_at ?? null,
    productId: normalizeText(payload?.meta?.product_id) || null,
    variantId: normalizeText(payload?.meta?.variant_id) || null,
    customerEmail: normalizeEmail(payload?.meta?.customer_email) || null,
    error
  };
}

async function verifyCloudflareKeyList(env, licenseKey, envName) {
  const raw = normalizeText(env[envName]);
  if (!raw) return { configured: false, unlocked: false };
  const keys = raw.split(/\r?\n/).map(normalizeKey).filter(Boolean);
  const targetHash = await sha256Hex(licenseKey);
  let matched = false;
  for (const key of keys) {
    const keyHash = await sha256Hex(key);
    matched = timingSafeEqualHex(targetHash, keyHash) || matched;
  }
  return { configured: true, unlocked: matched };
}

async function verifyCloudflareKeyLists(env, licenseKey, envNames) {
  let configured = false;
  let unlocked = false;
  for (const envName of envNames) {
    const verdict = await verifyCloudflareKeyList(env, licenseKey, envName);
    configured = configured || verdict.configured;
    unlocked = unlocked || verdict.unlocked;
  }
  return { configured, unlocked };
}

async function verifyKeyHashLists(env, licenseKey, envNames, builtInHashes = "") {
  const targetHash = await sha256Hex(licenseKey);
  let configured = false;
  let unlocked = false;
  for (const hash of keyHashes(env, envNames, builtInHashes)) {
    configured = true;
    unlocked = timingSafeEqualHex(targetHash, hash) || unlocked;
  }
  return { configured, unlocked };
}

function keyHashes(env, envNames, builtInHashes) {
  return [...envNames.map((envName) => env[envName]), builtInHashes]
    .map(normalizeText)
    .flatMap((raw) => raw.split(/\r?\n/))
    .map(normalizeHex)
    .filter((hash) => /^[a-f0-9]{64}$/.test(hash));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function requiresEmail(env) {
  return normalizeText(env.RADIO_LICENSE_REQUIRE_EMAIL) !== "0";
}

function hasLemonConstraint(env) {
  return Boolean(
    normalizeText(env.RADIO_LEMONSQUEEZY_PRODUCT_ID) ||
    normalizeText(env.RADIO_LEMONSQUEEZY_VARIANT_ID)
  );
}

function normalizeKey(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeHex(value) {
  return normalizeText(value).replace(/\s+/g, "").toLowerCase();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
