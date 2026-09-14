/** One-time: registers the Telegram webhook and command list. Run: npm run telegram:setup */
import { tgSetWebhook, tgSetCommands, tgSend } from "../lib/telegram";
import { env } from "../lib/env";

async function main() {
  const url = `${env.publicBaseUrl}/api/telegram`;
  console.log("setWebhook", url, await tgSetWebhook(url));
  console.log("setMyCommands", await tgSetCommands());
  await tgSend("✅ Spamtext connected. Send /help for commands.");
}
main().catch((e) => { console.error(e); process.exit(1); });
