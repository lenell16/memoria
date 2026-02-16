import { createFormHook } from "@tanstack/react-form";

import { fieldContext, formContext } from "./form-context";

/**
 * App-level TanStack Form hook scaffold.
 *
 * Custom field/form components can be registered later via `fieldComponents`
 * and `formComponents` when we add our own UI primitives.
 */
export const { useAppForm } = createFormHook({
  fieldComponents: {},
  formComponents: {},
  fieldContext,
  formContext,
});
