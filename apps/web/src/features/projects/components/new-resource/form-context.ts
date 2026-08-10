import { createFormHook } from "@tanstack/react-form";

import type { ResourceFormState } from "./schemas";

import { LinkedSecretsField } from "./form-fields/linked-secrets-field";
import { NumberField } from "./form-fields/number-field";
import { PortsField } from "./form-fields/ports-field";
import { SelectField } from "./form-fields/select-field";
import { SubmitButton } from "./form-fields/submit-button";
import { SwitchField } from "./form-fields/switch-field";
import { TextField } from "./form-fields/text-field";
import { VariablesField } from "./form-fields/variables-field";
import { fieldContext, formContext } from "./form-hook-contexts";

const formHook = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    NumberField,
    SwitchField,
    SelectField,
    PortsField,
    VariablesField,
    LinkedSecretsField,
  },
  formComponents: {
    SubmitButton,
  },
});

export const { useAppForm } = formHook;

/**
 * `setFieldValue` options for a value the wizard fills in on the operator's
 * behalf: a derived default, not an answer they gave.
 *
 * `dontUpdateMeta` leaves the field pristine, which is the whole point: it
 * makes `getFieldMeta(f).isDirty` mean "a human edited this" and nothing
 * else, so every auto-default can ask that one question instead of keeping
 * its own ref of the last value it wrote and guessing. `dontRunListeners`
 * keeps a default from re-entering the listener that produced it.
 *
 * Rule of thumb: if the operator clicked or typed it, write it plainly; if
 * the wizard inferred it, write it with this.
 */
export const AUTO_WRITE = { dontUpdateMeta: true, dontRunListeners: true } as const;

// Typed context hook. Step files call this to get a fully-typed form.
// useTypedAppFormContext takes the same props as useAppForm to infer TFormData,
// but at runtime it just reads from the context (the _props are only for inference).
export function useFormContext() {
  return formHook.useTypedAppFormContext<
    ResourceFormState,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined
  >({ defaultValues: {} as ResourceFormState });
}
