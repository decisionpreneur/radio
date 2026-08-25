import { answerRadioLinks } from "../../src/public-config-worker.mjs";

export async function onRequestGet(context) {
  return answerRadioLinks(context);
}

export function onRequestPost() {
  return new Response(null, { status: 405 });
}
