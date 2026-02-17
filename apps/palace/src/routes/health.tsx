import { createFileRoute } from "@tanstack/react-router";
import { checkDbHealth } from "@/server/db/health";

export const Route = createFileRoute("/health")({
  loader: async () => {
    return checkDbHealth();
  },
  component: HealthPage,
});

function HealthPage() {
  const health = Route.useLoaderData();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        Database Health
      </h1>
      <section className="mt-10 rounded-xl border p-6">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-3 w-3 rounded-full ${
              health.ok ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-lg font-medium">
            {health.ok ? "Connected" : "Disconnected"}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Timestamp: {health.timestamp}
        </p>
        {health.error && (
          <p className="mt-2 text-sm text-destructive">{health.error}</p>
        )}
      </section>
    </main>
  );
}
