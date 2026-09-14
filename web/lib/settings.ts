import { db } from "./supabase";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const { error } = await db().from("settings").upsert({ key, value });
  if (error) throw new Error(error.message);
}

/** Date the user's number was placed on the National Do Not Call Registry (ISO date) or null if unknown. */
export async function dncRegisteredAt(): Promise<Date | null> {
  const v = await getSetting<string | null>("dnc_registered_at", null);
  return v ? new Date(v) : null;
}
