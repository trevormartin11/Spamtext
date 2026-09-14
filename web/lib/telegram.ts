import { env } from "./env";

const API = () => `https://api.telegram.org/bot${env.telegramToken}`;

export interface InlineButton { text: string; callback_data?: string; url?: string }

export async function tgSend(text: string, opts: { buttons?: InlineButton[][]; chatId?: string; silent?: boolean } = {}): Promise<void> {
  if (!env.telegramToken) { console.log("[telegram disabled]", text); return; }
  const chat_id = opts.chatId ?? env.telegramChatId;
  if (!chat_id) { console.log("[telegram no chat id]", text); return; }
  const body: Record<string, unknown> = {
    chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: opts.silent ?? false,
  };
  if (opts.buttons) body.reply_markup = { inline_keyboard: opts.buttons };
  const r = await fetch(`${API()}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) console.error("telegram send failed", r.status, await r.text());
}

export async function tgAnswerCallback(callbackQueryId: string, text?: string): Promise<void> {
  if (!env.telegramToken) return;
  await fetch(`${API()}/answerCallbackQuery`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

export async function tgSetWebhook(url: string): Promise<unknown> {
  const r = await fetch(`${API()}/setWebhook`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: env.telegramWebhookSecret, allowed_updates: ["message", "callback_query"] }),
  });
  return r.json();
}

export async function tgSetCommands(): Promise<unknown> {
  const commands = [
    { command: "status", description: "Open reports and claims" },
    { command: "spend", description: "This month's spend vs cap" },
    { command: "report", description: "/report <id> details" },
    { command: "cancel", description: "/cancel <claim id> stop a pending demand letter" },
    { command: "send", description: "/send <claim id> send the demand letter now" },
    { command: "dnc", description: "/dnc YYYY-MM-DD set your Do Not Call registration date" },
    { command: "entity", description: "/entity <report id> | Company Name | address" },
    { command: "responded", description: "/responded <claim id> mark that the company replied" },
    { command: "settled", description: "/settled <claim id> <amount> mark a claim settled" },
    { command: "help", description: "Command list" },
  ];
  const r = await fetch(`${API()}/setMyCommands`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commands }),
  });
  return r.json();
}

export function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
