import { createFileRoute } from "@tanstack/react-router";
import { runRlsPolicyTest } from "@/server/db/rls-test-fn";

export const Route = createFileRoute("/rls-test")({
  loader: async () => runRlsPolicyTest(),
  component: RlsTestPage,
});

function RlsTestPage() {
  const data = Route.useLoaderData();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        RLS Policy Test
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
          <li>
            User-context client (anon, not logged in) sees rows:{" "}
            {data.userContextRowCount}
          </li>
          <li>Policy valid: {data.policyValid ? "Yes" : "No"}</li>
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          Embeddings table has RLS enabled with policies for the{" "}
          <code className="rounded bg-muted px-1">authenticated</code> role only.
          Unauthenticated requests return 0 rows.
        </p>
      </section>
    </main>
  );
}
