import { db } from "./supabase";
import { getSetting } from "./settings";

export class BudgetExceeded extends Error {
  constructor(public needCents: number, public spentCents: number, public capCents: number) {
    super(`Monthly budget exceeded: need ${needCents}c, spent ${spentCents}c of ${capCents}c cap`);
  }
}

export async function monthSpendCents(): Promise<number> {
  const start = new Date();
  start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const { data } = await db().from("spend").select("amount_cents").gte("created_at", start.toISOString());
  return (data ?? []).reduce((a, r) => a + (r.amount_cents as number), 0);
}

export async function monthlyCapCents(): Promise<number> {
  return getSetting<number>("monthly_cap_cents", 2000);
}

/** Throws BudgetExceeded if spending `cents` more this month would go over the cap. */
export async function ensureBudget(cents: number): Promise<void> {
  const [spent, cap] = await Promise.all([monthSpendCents(), monthlyCapCents()]);
  if (spent + cents > cap) throw new BudgetExceeded(cents, spent, cap);
}

export async function recordSpend(category: string, cents: number, description: string, ref?: string): Promise<void> {
  if (cents <= 0) return;
  await db().from("spend").insert({ category, amount_cents: cents, description, ref: ref ?? null });
}
