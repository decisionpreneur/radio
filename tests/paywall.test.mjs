import test from "node:test";
import assert from "node:assert/strict";
import { handleLicenseRequest } from "../src/license-worker.mjs";
import {
  entitlementUnlocks,
  makeEntitlement,
  normalizeEmail,
  normalizeLicenseKey
} from "../web/lib/paywall.mjs";

test("Cloudflare newline license list unlocks matching keys without provider fetch", async () => {
  let called = false;
  const response = await handleLicenseRequest(context({
    body: { licenseKey: " alpha-key ", email: "buyer@example.com" },
    env: { RADIO_LICENSE_KEYS: "alpha-key\nbeta-key" }
  }), "validate", {
    fetcher: async () => {
      called = true;
      return new Response("{}", { status: 500 });
    }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.unlocked, true);
  assert.equal(body.provider, "cloudflare-list");
  assert.equal(called, false);
});

test("Cloudflare newline license list rejects missing keys", async () => {
  const response = await handleLicenseRequest(context({
    body: { licenseKey: "gamma-key", email: "buyer@example.com" },
    env: { RADIO_LICENSE_KEYS: "alpha-key\nbeta-key" }
  }), "validate");
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.unlocked, false);
  assert.equal(body.error, "license_key_not_listed");
});

test("Lemon Squeezy activation checks active status, email, product, and variant", async () => {
  const response = await handleLicenseRequest(context({
    body: { licenseKey: "paid-key", email: "Buyer@Example.com", instanceName: "radio-test" },
    env: {
      RADIO_LEMONSQUEEZY_PRODUCT_ID: "4",
      RADIO_LEMONSQUEEZY_VARIANT_ID: "5"
    }
  }), "activate", {
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.lemonsqueezy.com/v1/licenses/activate");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Accept, "application/json");
      assert.match(String(init.body), /license_key=paid-key/);
      assert.match(String(init.body), /instance_name=radio-test/);
      return Response.json({
        activated: true,
        error: null,
        license_key: { status: "active", expires_at: null },
        instance: { id: "instance-1" },
        meta: {
          product_id: 4,
          variant_id: 5,
          customer_email: "buyer@example.com"
        }
      });
    }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.unlocked, true);
  assert.equal(body.provider, "lemonsqueezy");
  assert.equal(body.instanceId, "instance-1");
});

test("Lemon Squeezy validation rejects checkout email mismatch", async () => {
  const response = await handleLicenseRequest(context({
    body: { licenseKey: "paid-key", email: "wrong@example.com", instanceId: "instance-1" },
    env: {}
  }), "validate", {
    fetcher: async () => Response.json({
      valid: true,
      error: null,
      license_key: { status: "active", expires_at: null },
      instance: { id: "instance-1" },
      meta: { customer_email: "buyer@example.com" }
    })
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.unlocked, false);
  assert.equal(body.error, "checkout_email_mismatch");
});

test("paywall entitlement helpers normalize and expire local entitlement", () => {
  const verdict = {
    unlocked: true,
    provider: "lemonsqueezy",
    licenseStatus: "active",
    instanceId: "instance-1",
    expiresAt: "2999-01-01T00:00:00.000Z"
  };
  const entitlement = makeEntitlement({
    licenseKey: "  paid key  ",
    email: "Buyer@Example.com",
    verdict
  });
  assert.equal(normalizeLicenseKey(" a b c "), "abc");
  assert.equal(normalizeEmail("Buyer@Example.com"), "buyer@example.com");
  assert.equal(entitlement.licenseKey, "paidkey");
  assert.equal(entitlement.email, "buyer@example.com");
  assert.equal(entitlementUnlocks(entitlement, Date.parse("2026-01-01T00:00:00.000Z")), true);
  assert.equal(entitlementUnlocks({ ...entitlement, expiresAt: "2020-01-01T00:00:00.000Z" }), false);
});

function context({ body, env, method = "POST" }) {
  return {
    request: new Request("https://radio.example/api/license", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    env
  };
}
