import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export function createSupabaseAdmin() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
