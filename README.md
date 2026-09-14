# Spamtext

Report a spam text or robocall from your Android phone with one tap, and let the rest run itself:
carrier report (7726), FTC, FCC and Do Not Call complaints, sender identification, a TCPA demand letter
sent by certified mail, a 30-day clock, and an Arizona small-claims packet if they don't pay.
Status updates arrive in Telegram; everything is visible in a small web dashboard.

```
android/   Kotlin app: share-sheet target, notification "Report spam" button, backfill, robocalls, 7726 forwarding
web/       Next.js on Vercel: API for the phone, daily cron, Telegram bot, dashboard, PDF generation
worker/    Playwright job (GitHub Actions) that files FTC / FCC / DNC complaints in a browser
supabase/  Database schema
docs/      SETUP.md (step by step), LEGAL.md (why this can pay), PIPELINE.md (how it flows)
```

## How you use it day to day

1. A text from a number not in your contacts arrives. A notification appears with a **Report spam** button. Tap it. Done.
   Or open the text in Google Messages, long-press, Share, pick **Report spam**.
   For a robocall: open the app, Calls tab, tap Report, say whether it was a recorded voice.
2. Telegram tells you what the sender was identified as, what got filed, and whether a claim is viable yet
   (a Do Not Call claim needs two messages from the same seller within 12 months; a recorded-voice call needs only one).
3. When a claim is viable and the company has a mailing address, a demand letter for $1,500 per violation is drafted.
   You get a preview with **Send now** / **Cancel** buttons. If you do nothing, it mails itself after 24 hours.
4. If they don't respond in 30 days, a small-claims packet for your Justice Court precinct arrives in Telegram.
   File it, reply `/filed`, and when you settle reply `/settled <claim> <amount>`.

Spending is capped at $20/month by default (`/cap 30` to change). Paid pieces: Twilio number lookups (~2¢),
Claude extraction (~1¢), certified mail via Lob (~$9 per letter).

## Setup

See [docs/SETUP.md](docs/SETUP.md). Roughly 45 minutes: Supabase project, Vercel deploy, Telegram bot, GitHub
secrets, install the APK, enter the server URL and API key, and set your Do Not Call registration date with `/dnc`.

## Honest limits

- Government complaint forms have no API; the worker drives them in a browser. Sites change. When a filing fails
  three times you get the link to do it by hand, with the text pre-written in the dashboard.
- Identifying the real company behind a number is the hard part. When the pipeline can't, it tells you, and one
  Telegram command (`/entity`) links the number to a company and address you found.
- Nothing here files a lawsuit for you; it prepares the paperwork.
- Not legal advice. Read [docs/LEGAL.md](docs/LEGAL.md).
