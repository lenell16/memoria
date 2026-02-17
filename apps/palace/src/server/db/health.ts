import { createServerFn } from "@tanstack/react-start";
import { createSupabaseAdmin } from "../supabase/admin";

export const checkDbHealth = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.auth.admin.listUsers({ perPage: 1 });
    if (error) {
      return {
        ok: false,
        timestamp: new Date().toISOString(),
        error: error.message,
        profilesViaAdmin: null,
      };
    }
    const { data: profiles } = await supabase.from("profiles").select("*");
    return {
      ok: true,
      timestamp: new Date().toISOString(),
      error: null,
      profilesViaAdmin: profiles ?? [],
    };
  } catch (e) {
    return {
      ok: false,
      timestamp: new Date().toISOString(),
      error: e instanceof Error ? e.message : "Unknown error",
      profilesViaAdmin: null,
    };
  }
});
