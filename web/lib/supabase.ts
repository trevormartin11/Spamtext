import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/** Service-role client. Server-side only. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export const BUCKET = "documents";

export async function uploadDocument(path: string, bytes: Uint8Array | Buffer, contentType: string): Promise<string> {
  const { error } = await db().storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return path;
}

export async function signedUrl(path: string, seconds = 60 * 60 * 24 * 7): Promise<string> {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(`signed url failed: ${error?.message}`);
  return data.signedUrl;
}
