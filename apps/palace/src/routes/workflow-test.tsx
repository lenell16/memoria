import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { testWorkflow } from "@/workflows/test-workflow";
import { start } from "workflow/api";

const runTestWorkflow = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    const result = { topic: "workflow-tester" };

    const typedInput = input as { topic?: unknown } | null | undefined;

    if (typedInput && typeof typedInput.topic === "string" && typedInput.topic.trim()) {
      return { topic: typedInput.topic };
    }

    return result;
  })
  .handler(async (ctx) => {
    const run = await start(testWorkflow, [ctx.data.topic]);
    const returnValue = await run.returnValue;
    const status = await run.status;
    console.log(run);
    return {
      runId: run.runId,
      status,
      returnValue,
    };
  });

export const Route = createFileRoute("/workflow-test")({
  component: WorkflowTestRoute,
  loader: ({ location }) => runTestWorkflow({ data: location.search }),
});

function WorkflowTestRoute() {
  const workflowData = Route.useLoaderData();

  return (
    <div className="m-8 space-y-4">
      <h1 className="text-2xl font-medium">Workflow Server Function Test</h1>
      <pre className="max-w-xl rounded-lg border p-4 text-sm whitespace-pre-wrap">
        {JSON.stringify(workflowData, null, 2)}
      </pre>
    </div>
  );
}
