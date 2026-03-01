import { getModel } from "@/lib/ai/model";
import { createFileRoute } from "@tanstack/react-router";
import { streamText, UIMessage, convertToModelMessages } from "ai";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages }: { messages: UIMessage[] } = await request.json();

        const result = streamText({
          model: getModel("anthropic/claude-sonnet-4.6"),
          messages: await convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
