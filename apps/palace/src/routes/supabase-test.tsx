import { createFileRoute } from "@tanstack/react-router";
import { getProfilesViaSupabase } from "@/server/db/profiles-supabase-fn";

export const Route = createFileRoute("/supabase-test")({
  loader: async () => {
    return getProfilesViaSupabase();
  },
  component: SupabaseTestPage,
});

function SupabaseTestPage() {
  const data = Route.useLoaderData();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        Supabase Typed Client Test
      </h1>
      <section className="mt-10 rounded-xl border p-6">
        <p className="text-sm text-muted-foreground">
          User-context client (createClient from lib/supabase/server) — respects RLS
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Timestamp: {data.timestamp}
        </p>
        {data.error && (
          <p className="mt-2 text-sm text-destructive">{data.error}</p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          Profiles count: {data.profiles.length}
        </p>
        {data.profiles.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {data.profiles.map((p) => (
              <li key={p.id}>
                {p.display_name}
                {p.avatar_url ? ` (${p.avatar_url})` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No profiles yet. Typed Supabase client path is working.
          </p>
        )}
      </section>
    </main>
  );
}
