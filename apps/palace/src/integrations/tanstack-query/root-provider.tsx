import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function getContext() {
  const queryClient = new QueryClient();
  return {
    queryClient,
  };
}

/**
 * Manual QueryClientProvider wrapper — currently unused.
 *
 * The SSR integration (`setupRouterSsrQueryIntegration` in router.tsx) auto-wraps
 * the app with QueryClientProvider by default (`wrapQueryClient: true`). This
 * Provider exists as an escape hatch for scenarios where you need to:
 *   - Pass `wrapQueryClient: false` and control provider placement manually
 *   - Compose provider ordering with auth/theme/etc. providers
 *   - Run in client-only SPA mode without the SSR integration
 *
 * Leave this in place unless the above scenarios are ruled out permanently.
 */
export function Provider({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
