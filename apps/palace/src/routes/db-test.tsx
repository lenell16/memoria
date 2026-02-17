import { createFileRoute } from "@tanstack/react-router";
import { getProfiles } from "@/server/db/profiles-fn";

export const Route = createFileRoute("/db-test")({
  loader: async () => {
    return getProfiles();
  },
  component: DbTestPage,
});

function DbTestPage() {
  const data = Route.useLoaderData();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        Drizzle Query Test
      </h1>
      <section className="mt-10 rounded-xl border p-6">
        <p className="text-sm text-muted-foreground">
          Timestamp: {data.timestamp}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Profiles count: {data.profiles.length}
        </p>
        {data.profiles.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {data.profiles.map((p) => (
              <li key={p.id}>
                {p.displayName}
                {p.avatarUrl ? ` (${p.avatarUrl})` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No profiles yet. Table exists; typed query path is working.
          </p>
        )}
      </section>
    </main>
  );
}
