import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@/lib/supabase/server";

export const getProfilesViaSupabase = createServerFn({ method: "GET" }).handler(
  async () => {
    const supabase = createClient();
    const { data, error } = await supabase.from("profiles").select("*");
    return {
      profiles: data ?? [],
      timestamp: new Date().toISOString(),
      error: error?.message ?? null,
    };
  },
);
