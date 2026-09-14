/**
 * Browser worker: files pending government complaints (FTC ReportFraud, FCC consumer complaints,
 * FTC Do Not Call complaints) with Playwright. Runs on a schedule in GitHub Actions or locally.
 */
import { chromium } from "playwright";
import { supa, DRY_RUN, HEADLESS, opt, uploadShot, type Job } from "./common.js";
import { fileFtc } from "./filers/ftc.js";
import { fileFcc } from "./filers/fcc.js";
import { fileDnc } from "./filers/dnc.js";

const FILERS = { ftc: fileFtc, fcc: fileFcc, dnc: fileDnc } as const;
const MAX_PER_RUN = Number(opt("MAX_PER_RUN", "15"));

async function main() {
  const only = opt("ONLY_AGENCY");
  let q = supa().from("complaint_jobs")
    .select("id,report_id,agency,attempts,reports(id,kind,sender_phone,body,received_at,prerecorded,category,senders(caller_name,carrier,entities(name,website)))")
    .eq("status", "pending").lte("run_after", new Date().toISOString()).order("created_at").limit(MAX_PER_RUN);
  if (only) q = q.eq("agency", only);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as unknown as Job[];
  console.log(`${jobs.length} pending complaint job(s)${DRY_RUN ? " [DRY RUN]" : ""}`);
  if (jobs.length === 0) return;

  const browser = await chromium.launch({ headless: HEADLESS, executablePath: opt("CHROMIUM_PATH") || undefined, args: opt("CHROMIUM_ARGS").split(" ").filter(Boolean) });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    viewport: { width: 1280, height: 900 }, locale: "en-US", timezoneId: "America/Phoenix",
  });
  let ok = 0, failed = 0;
  for (const job of jobs) {
    await supa().from("complaint_jobs").update({ status: "running", attempts: job.attempts + 1 }).eq("id", job.id);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    try {
      const res = await FILERS[job.agency](page, job);
      if (res.skipped) {
        await supa().from("complaint_jobs").update({ status: "skipped", error: res.note ?? null }).eq("id", job.id);
        await supa().from("events").insert({ report_id: job.report_id, message: `${job.agency.toUpperCase()} complaint skipped: ${res.note ?? ""}` });
        console.log(`${job.agency} ${job.id} skipped: ${res.note}`);
        continue;
      }
      const png = await page.screenshot({ fullPage: true }).catch(() => Buffer.from(""));
      const shotPath = await uploadShot(`complaints/${job.report_id}/${job.agency}-${DRY_RUN ? "dry" : "done"}.png`, png);
      await supa().from("complaint_jobs").update({
        status: DRY_RUN ? "pending" : "submitted", confirmation: res.confirmation, screenshot_path: shotPath, error: res.note ?? null,
        ...(DRY_RUN ? { attempts: job.attempts } : {}),
      }).eq("id", job.id);
      await supa().from("events").insert({ report_id: job.report_id, message: `${job.agency.toUpperCase()} complaint ${DRY_RUN ? "dry-run ok" : "submitted"}${res.confirmation ? ` (#${res.confirmation})` : ""}` });
      ok++;
      console.log(`${job.agency} ${job.id} ok ${res.confirmation ?? ""}`);
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      const png = await page.screenshot({ fullPage: true }).catch(() => Buffer.from(""));
      const shotPath = await uploadShot(`complaints/${job.report_id}/${job.agency}-fail-${job.attempts + 1}.png`, png);
      const backoffHours = Math.min(48, 6 * (job.attempts + 1));
      await supa().from("complaint_jobs").update({
        status: "failed", error: msg, screenshot_path: shotPath, run_after: new Date(Date.now() + backoffHours * 3600_000).toISOString(),
      }).eq("id", job.id);
      // "failed" rows with attempts < 3 are re-queued by re-marking pending; the daily cron escalates >= 3 to manual.
      if (job.attempts + 1 < 3) await supa().from("complaint_jobs").update({ status: "pending" }).eq("id", job.id);
      await supa().from("events").insert({ report_id: job.report_id, level: "warn", message: `${job.agency.toUpperCase()} complaint attempt ${job.attempts + 1} failed: ${msg.slice(0, 200)}` });
      failed++;
      console.error(`${job.agency} ${job.id} FAILED: ${msg}`);
    } finally {
      await page.close();
    }
  }
  await browser.close();
  console.log(`done: ${ok} ok, ${failed} failed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
