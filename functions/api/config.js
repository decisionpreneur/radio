import { handlePublicConfig } from "../../src/public-config-worker.mjs";

export async function onRequestGet(context) {
  return handlePublicConfig(context);
}

export function onRequestPost() {
  return new Response(null, { status: 405 });
}
