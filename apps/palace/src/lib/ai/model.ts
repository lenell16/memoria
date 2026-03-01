import { devToolsMiddleware } from "@ai-sdk/devtools";
import { wrapLanguageModel, gateway, GatewayModelId } from "ai";

export function getModel(modelId: GatewayModelId) {
  return wrapLanguageModel({
    model: gateway(modelId),
    middleware: [devToolsMiddleware()],
  });
}
