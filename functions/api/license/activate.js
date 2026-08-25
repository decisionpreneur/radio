import { answerLicenseGate, rejectNonPost } from "../../../src/license-worker.mjs";

export function onRequestPost(context) {
  return answerLicenseGate(context, "activate");
}

export function onRequest(context) {
  return context.request.method === "POST" ? onRequestPost(context) : rejectNonPost();
}
