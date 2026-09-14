# Pipeline

```
phone ──► POST /api/reports ──► reports (received)
                                   │  processReport()
                                   ▼
                     Twilio Lookup ─┐   Claude extraction ─┐   RDAP ─┐
                                    └──────► senders/entities ◄───────┘
                                   │
                    ┌──────────────┼──────────────────┐
                    ▼              ▼                  ▼
            complaint_jobs     claims (assess)     Telegram note
            (ftc/fcc/dnc)          │
                    │              │ tcpa_c5 || tcpa_b3, entity has address
      GitHub Action ▼              ▼
      Playwright files it     demand_hold (24h, cancel/send buttons)
                                   │ hold expires
                                   ▼
                             demand_sent (Lob certified [+ email])
                                   │ daily: Lob tracking, reminders at 14/7/1 days
                                   ▼
                          awaiting_response ── /responded ──► responded ──► /settled
                                   │ deadline passed
                                   ▼
                          small_claims_ready (packet PDF) ── /filed ──► filed
```

## Daily cron (`/api/cron/daily`, 07:00 Arizona)

1. Re-process reports stuck in `received`/`error`, and `needs_identification` reports once a week (new messages from the same number may add evidence).
2. `advanceClaim()` on every open claim (see state machine above).
3. Complaint jobs that failed 3 times become `manual` and you get a Telegram message with the link to file by hand.
4. Enforcement monitor: FTC and FCC news feeds plus class-action tracker searches, matched against every entity name/alias/domain. New hits are stored in `monitor_hits` and sent to Telegram.
5. Monday: weekly digest.

## GitHub Action (`file-complaints.yml`, 07:30 Arizona)

Runs `worker/` with Playwright against pending `complaint_jobs`. Each job gets a screenshot in Supabase Storage (`documents/complaints/<report>/<agency>-done.png`) and a confirmation number when the site shows one. Failures back off 6h/12h/18h and then escalate to manual.

## Money guard

Every paid action calls `ensureBudget(cents)` first: Twilio lookup (~2¢), Claude extraction (~1¢), Lob certified letter (`LOB_CERTIFIED_LETTER_CENTS`, default $9). The cap is `settings.monthly_cap_cents` (default $20; `/cap 30` changes it). A letter that would exceed the cap is held until the 1st of next month and you are told.

## Tables

`reports` (one per text/call), `senders` (numbers + carrier lookup), `entities` (the company), `claims` (one open claim per entity, or per number when unidentified), `claim_reports`, `complaint_jobs`, `spend`, `monitor_hits`, `settings`, `events` (audit log shown as timelines in the dashboard).
