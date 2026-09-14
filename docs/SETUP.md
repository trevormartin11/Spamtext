# Setup

Everything below is one-time. Keep secrets in Vercel / GitHub / the phone, never in the repo.

## 0. Things to have ready

- Supabase account, Vercel account (both free tiers work), GitHub (this repo).
- Twilio account (yours is under trevormartin11@gmail.com): Console → Account Info → Account SID and Auth Token. Lookup v2 is pay-as-you-go, no number purchase needed.
- Anthropic API key (console.anthropic.com).
- Lob account (lob.com) for certified mail. Use the **live** API key; test keys don't mail anything.
- Telegram on your phone.
- Your Do Not Call registration date: https://www.donotcall.gov/verify.html emails it to you. If you're not registered, register at https://www.donotcall.gov/register.html today; claims start 31 days later.

## 1. Supabase

1. Create a project. Note **Project URL** and the **service_role** key (Project Settings → API).
2. SQL editor → paste `supabase/migrations/0001_init.sql` → Run. This creates all tables and a private `documents` storage bucket.

## 2. Vercel (the backend)

1. Import this repo in Vercel; set **Root Directory** to `web`.
2. Environment variables (copy from `web/.env.example`). Generate `APP_API_KEY`, `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET` and `DASHBOARD_PASSWORD` with `openssl rand -hex 24`. Fill in your name, address and phone; they go into complaints and letters.
3. Deploy. `https://<your-app>.vercel.app/api/health` should return `{"ok":true}`.
4. Set `PUBLIC_BASE_URL` to that URL and redeploy.
5. The daily cron (`vercel.json`, 14:00 UTC = 07:00 Arizona) is registered automatically. Vercel Hobby allows one daily cron, which is all this uses.

## 3. Telegram

1. Message @BotFather → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`.
2. Message your new bot once (anything), then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `message.chat.id` into `TELEGRAM_CHAT_ID`. Only that chat is allowed to talk to the bot.
3. Redeploy, then from your machine:
   ```bash
   cd web && cp .env.example .env   # fill in TELEGRAM_*, PUBLIC_BASE_URL
   npm install && npm run telegram:setup
   ```
   You should receive "Spamtext connected" in Telegram. Send `/dnc 2019-04-02` (your registration date) and `/help`.

## 4. GitHub Actions (the complaint filer)

Repository → Settings → Secrets and variables → Actions. Add: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `USER_FULL_NAME`, `USER_PHONE`, `USER_EMAIL`, `USER_ADDRESS_LINE1`, `USER_CITY`, `USER_STATE`, `USER_ZIP`.

Then Actions → "File government complaints" → Run workflow with **dry_run = true** once. It fills every pending form, screenshots it into Supabase Storage (`documents/complaints/...`), and never clicks submit. Look at the screenshots in the Supabase dashboard; if they look right, the scheduled run (07:30 Arizona) files for real. Set `only_agency` to test one site at a time.

## 5. Android app

Build the APK (any of these):
- GitHub Actions → CI → download the `spamtext-debug-apk` artifact, or
- `cd android && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`.

Install it (allow "install unknown apps" for your browser/file manager). Open it, grant the permissions, then Settings tab: server URL and `APP_API_KEY` → **Save & test**.

Google Play won't distribute apps with SMS permissions for this use, which is why it's sideloaded. The app never sends your messages anywhere except your own backend and, for texts you report, to AT&T's 7726.

### Backfill
Texts tab → **Select all unreported** → Report. Same on the Calls tab (one at a time, since you answer the recorded-voice question).

## 6. Optional

- `RESEND_API_KEY` + `RESEND_FROM`: also email the demand letter when the company's email is known.
- Dashboard: `https://<your-app>.vercel.app` (any username, password = `DASHBOARD_PASSWORD`).
- Local run of the daily job: `cd web && npm run pipeline:run`.

## Telegram commands

| Command | What it does |
|---|---|
| `/status` | recent reports and open claims |
| `/spend`, `/cap 30` | this month's spend; change the cap |
| `/report <id>` | details for a report (ids are the 8-char prefix shown in messages) |
| `/send <claim>` / `/cancel <claim>` | send a held demand letter now / cancel it |
| `/sent <claim>` | you mailed it yourself; start the 30-day clock |
| `/responded <claim>` | the company replied |
| `/filed <claim>` | you filed in small claims |
| `/settled <claim> 750` | record the settlement |
| `/dnc 2019-04-02` | Do Not Call registration date |
| `/entity <report> \| Acme Solar LLC \| 123 Main St, Phoenix, AZ 85001` | identify a sender by hand |
