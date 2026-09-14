import { env } from "./env";

/** Constant-time-ish comparison for API keys. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function checkAppKey(req: Request): boolean {
  const key = req.headers.get("x-api-key") ?? "";
  return !!key && safeEqual(key, env.appApiKey);
}

export function checkCron(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  if (env.cronSecret && safeEqual(auth, `Bearer ${env.cronSecret}`)) return true;
  // Allow the app key too, so the phone / a curl can trigger a run.
  return checkAppKey(req);
}

export function checkTelegram(req: Request): boolean {
  const tok = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return !!env.telegramWebhookSecret && safeEqual(tok, env.telegramWebhookSecret);
}
