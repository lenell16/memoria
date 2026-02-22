import { createClient } from "@supabase/supabase-js";
import type { Database } from "../db/supabase.types";
import { env } from "../env";

/**
 * Supabase client that always runs as the anonymous (anon) role.
 * No cookie/session handling - never attaches a user JWT.
 * Use for server code that must explicitly run as unauthenticated.
 */
export function createSupabaseAnon() {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}
