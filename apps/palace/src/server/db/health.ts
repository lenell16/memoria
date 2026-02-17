import { createServerFn } from "@tanstack/react-start";
import { createSupabaseAdmin } from "../supabase";

export const checkDbHealth = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.auth.admin.listUsers({ perPage: 1 });
    return {
      ok: !error,
      timestamp: new Date().toISOString(),
      error: error?.message ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      timestamp: new Date().toISOString(),
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
});
