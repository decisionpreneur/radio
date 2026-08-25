import { handleDonationCheckout } from "../../../src/donation-worker.mjs";

export function onRequestPost(context) {
  return handleDonationCheckout(context);
}

export function onRequest(context) {
  return onRequestPost(context);
}
