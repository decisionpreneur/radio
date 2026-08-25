export const ENTITLEMENT_STORAGE_KEY = "radio.entitlement.v1";
export const INSTANCE_STORAGE_KEY = "radio.instance.v1";
const LICENSE_ERROR_MESSAGES = {
  checkout_email_mismatch: "payment email mismatch",
  checkout_email_required: "payment email required",
  invalid_json: "license request invalid",
  invalid_license_response: "license response invalid",
  instance_name_required: "license instance required",
  license_check_failed: "license check failed",
  license_key_not_listed: "license key not listed",
  license_key_required: "license key required",
  license_not_active: "license not active",
  license_not_valid: "license not valid",
  license_provider_error: "license provider error",
  license_provider_unreachable: "license provider unreachable",
  license_rejected: "license rejected",
  license_request_failed: "license request failed",
  license_required: "license required",
  method_not_allowed: "license method not allowed",
  product_mismatch: "product mismatch",
  variant_mismatch: "variant mismatch"
};

export function readEntitlement(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(ENTITLEMENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function writeEntitlement(entitlement, storage = globalThis.localStorage) {
  storage.setItem(ENTITLEMENT_STORAGE_KEY, JSON.stringify(entitlement));
}

export function clearEntitlement(storage = globalThis.localStorage) {
  storage.removeItem(ENTITLEMENT_STORAGE_KEY);
}

export function entitlementUnlocks(entitlement, now = Date.now()) {
  if (!entitlement?.unlocked || !entitlement.licenseKey) return false;
  if (!entitlement.expiresAt) return true;
  const expiresAt = Date.parse(entitlement.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function getOrCreateInstanceName(storage = globalThis.localStorage, cryptoApi = globalThis.crypto) {
  const existing = storage.getItem(INSTANCE_STORAGE_KEY);
  if (existing) return existing;
  const id = cryptoApi?.randomUUID ? cryptoApi.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const instanceName = `radio-${id}`;
  storage.setItem(INSTANCE_STORAGE_KEY, instanceName);
  return instanceName;
}

export async function activateLicense(input, fetcher = globalThis.fetch) {
  const body = {
    licenseKey: normalizeLicenseKey(input.licenseKey),
    email: normalizeEmail(input.email),
    instanceName: input.instanceName
  };
  return requestLicense("/api/license/activate", body, fetcher);
}

export async function validateLicense(entitlement, fetcher = globalThis.fetch) {
  const body = {
    licenseKey: normalizeLicenseKey(entitlement?.licenseKey),
    email: normalizeEmail(entitlement?.email),
    instanceId: entitlement?.instanceId ?? ""
  };
  return requestLicense("/api/license/validate", body, fetcher);
}

export async function fetchPublicConfig(fetcher = globalThis.fetch) {
  try {
    const response = await fetcher("/api/config", {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });
    if (!response.ok) return {};
    const payload = await response.json();
    return {
      checkoutUrl: normalizeHttpsUrl(payload?.checkoutUrl),
      donationUrl: normalizeHttpsUrl(payload?.donationUrl),
      donationCheckout: payload?.donationCheckout === true
    };
  } catch {
    return {};
  }
}

export function makeEntitlement({ licenseKey, email, verdict }) {
  return {
    unlocked: verdict.unlocked === true,
    provider: verdict.provider ?? null,
    licenseKey: normalizeLicenseKey(licenseKey),
    email: normalizeEmail(email),
    licenseStatus: verdict.licenseStatus ?? null,
    instanceId: verdict.instanceId ?? null,
    expiresAt: verdict.expiresAt ?? null,
    productId: verdict.productId ?? null,
    variantId: verdict.variantId ?? null,
    customerEmail: verdict.customerEmail ?? null,
    checkedAt: new Date().toISOString()
  };
}

export function normalizeLicenseKey(value) {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function licenseErrorMessage(error) {
  const code = String(error ?? "license_rejected").trim();
  if (!code) return LICENSE_ERROR_MESSAGES.license_rejected;
  return LICENSE_ERROR_MESSAGES[code] ?? code.replaceAll("_", " ");
}

function normalizeHttpsUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

async function requestLicense(url, body, fetcher) {
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({
    ok: false,
    unlocked: false,
    error: "invalid_license_response"
  }));
  if (!response.ok) {
    return {
      ok: false,
      unlocked: false,
      error: payload.error ?? "license_request_failed"
    };
  }
  return payload;
}
