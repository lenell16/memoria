import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: App });

function App() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">Palace</h1>
      <p className="mt-4 max-w-2xl text-base text-muted-foreground">
        Clean base app scaffold. Template demos were removed so we can add features intentionally.
      </p>
      <section className="mt-10 rounded-xl border p-6">
        <h2 className="text-lg font-medium">Current baseline</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>TanStack Router file-based routing with a single home route.</li>
          <li>TanStack Query SSR router integration is still wired in `router.tsx`.</li>
          <li>Devtools are available in the root document shell.</li>
          <li>Form hook pattern is preserved in `hooks/form.ts` and `hooks/form-context.ts`.</li>
        </ul>
      </section>
    </main>
  );
}
