import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { LinkedSecretsField } from "./form-fields/linked-secrets-field";
import { NumberField } from "./form-fields/number-field";
import { PortsField } from "./form-fields/ports-field";
import { SelectField } from "./form-fields/select-field";
import { SubmitButton } from "./form-fields/submit-button";
import { SwitchField } from "./form-fields/switch-field";
import { TextField } from "./form-fields/text-field";
import { VariablesField } from "./form-fields/variables-field";
import type { ResourceFormState } from "./schemas";

const { fieldContext, formContext, useFieldContext, useFormContext: _useFormContext } =
  createFormHookContexts();

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

const { useAppForm, withForm } = formHook;

// Typed context hook — step files call this to get a fully-typed form.
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
