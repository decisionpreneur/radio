import { handleLicenseRequest, methodNotAllowed } from "../../../src/license-worker.mjs";

export function onRequestPost(context) {
  return handleLicenseRequest(context, "validate");
}

export function onRequest(context) {
  return context.request.method === "POST" ? onRequestPost(context) : methodNotAllowed();
}
