import { createFileRoute } from "@tanstack/react-router";
import { runAnonClientTest } from "@/server/db/anon-test-fn";

export const Route = createFileRoute("/anon-test")({
  loader: async () => runAnonClientTest(),
  component: AnonTestPage,
});

function AnonTestPage() {
  const data = Route.useLoaderData();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        Anon Client Test
      </h1>
      <section className="mt-10 rounded-xl border p-6">
        <p
          className={`text-sm font-medium ${data.policyValid ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}
        >
          {data.message}
        </p>
        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
          <li>Admin inserted row: {data.adminInserted ? "Yes" : "No"}</li>
          <li>Admin sees rows: {data.adminRowCount}</li>
          <li>Dedicated anon client sees rows: {data.anonRowCount}</li>
          <li>Policy valid: {data.policyValid ? "Yes" : "No"}</li>
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          The dedicated anon client uses the anon key only—no cookies or user
          session. It always runs as the <code className="rounded bg-muted px-1">anon</code> role, so
          RLS policies for <code className="rounded bg-muted px-1">authenticated</code> block access.
        </p>
      </section>
    </main>
  );
}
