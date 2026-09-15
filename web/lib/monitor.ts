import { XMLParser } from "fast-xml-parser";
import { db } from "./supabase";
import { tgSend, esc } from "./telegram";
import type { Entity } from "./types";

/** Public feeds/search pages checked daily for enforcement actions or settlements naming an entity. */
const FEEDS: { source: string; url: string }[] = [
  { source: "ftc_press", url: "https://www.ftc.gov/feeds/press-release-consumer-protection.xml" },
  { source: "ftc_press", url: "https://www.ftc.gov/feeds/press-release.xml" },
  { source: "fcc_news", url: "https://www.fcc.gov/news-events/headlines.rss" },
  { source: "fcc_news", url: "https://www.fcc.gov/enforcement/rss" },
];

interface Item { title: string; link: string; description?: string }

async function fetchFeed(url: string): Promise<Item[]> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "spamtext-monitor/1.0" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml) as {
      rss?: { channel?: { item?: Item | Item[] } }; feed?: { entry?: { title: string; link: { "@_href": string } | { "@_href": string }[]; summary?: string }[] };
    };
    const items = parsed.rss?.channel?.item;
    if (items) return (Array.isArray(items) ? items : [items]).map((i) => ({ title: String(i.title), link: String(i.link), description: i.description ? String(i.description) : undefined }));
    const entries = parsed.feed?.entry ?? [];
    return entries.map((e) => ({ title: String(e.title), link: Array.isArray(e.link) ? e.link[0]["@_href"] : e.link["@_href"], description: e.summary }));
  } catch {
    return [];
  }
}

/** Search class-action trackers for the entity name. HTML scraping, best effort. */
async function searchClassActions(name: string): Promise<Item[]> {
  const out: Item[] = [];
  const q = encodeURIComponent(name);
  const targets = [
    { url: `https://topclassactions.com/?s=${q}`, host: "topclassactions.com" },
    { url: `https://www.classaction.org/search?q=${q}`, host: "classaction.org" },
  ];
  for (const t of targets) {
    try {
      const r = await fetch(t.url, { headers: { "user-agent": "Mozilla/5.0 spamtext-monitor" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const html = await r.text();
      const re = /<a[^>]+href="(https?:\/\/[^"]*(?:lawsuit|settlement|class-action)[^"]*)"[^>]*>([^<]{10,160})<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) && out.length < 20) {
        const title = m[2].replace(/\s+/g, " ").trim();
        if (title.toLowerCase().includes(name.toLowerCase().split(" ")[0])) out.push({ title, link: m[1] });
      }
    } catch { /* ignore */ }
  }
  return out;
}

function nameMatches(text: string, entity: Entity): boolean {
  const hay = text.toLowerCase();
  const names = [entity.name, ...entity.aliases, entity.domain ?? ""].map((n) => n.toLowerCase().trim()).filter((n) => n.length >= 4);
  return names.some((n) => hay.includes(n));
}

export async function runMonitor(): Promise<number> {
  const supa = db();
  const { data: entities } = await supa.from("entities").select("*");
  const list = (entities ?? []) as Entity[];
  if (list.length === 0) return 0;

  const feedItems: { source: string; item: Item }[] = [];
  for (const f of FEEDS) for (const item of await fetchFeed(f.url)) feedItems.push({ source: f.source, item });

  let newHits = 0;
  for (const e of list) {
    const candidates: { source: string; item: Item }[] = feedItems.filter((x) => nameMatches(x.item.title + " " + (x.item.description ?? ""), e));
    for (const item of await searchClassActions(e.name)) candidates.push({ source: "class_action", item });
    for (const c of candidates) {
      const { data, error } = await supa.from("monitor_hits")
        .insert({ entity_id: e.id, source: c.source, title: c.item.title.slice(0, 300), url: c.item.link, summary: c.item.description?.replace(/<[^>]+>/g, "").slice(0, 500) ?? null })
        .select("id").maybeSingle();
      if (error || !data) continue; // duplicate
      newHits++;
      await tgSend(`🔎 <b>Enforcement/settlement mention</b> for <b>${esc(e.name)}</b>\n${esc(c.item.title)}\n${c.item.link}\n\nIf this is a settlement, check whether you can file a claim as a class member.`);
      await supa.from("monitor_hits").update({ notified: true }).eq("id", data.id);
    }
  }
  return newHits;
}
