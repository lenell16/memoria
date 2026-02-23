import { wrapLanguageModel, gateway, GatewayModelId } from 'ai';
import { devToolsMiddleware } from '@ai-sdk/devtools';

export function getModel(modelId: GatewayModelId) {
  return wrapLanguageModel({
    model: gateway(modelId),
    middleware: [devToolsMiddleware()],
  });
}

