import { createClient } from "@supabase/supabase-js";
import type { Database } from "../db/supabase.types";
import { env } from "../env";

export function createSupabaseAdmin() {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
