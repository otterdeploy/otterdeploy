import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { LinkedSecretsField } from "./form-fields/linked-secrets-field";
import { NumberField } from "./form-fields/number-field";
import { PortsField } from "./form-fields/ports-field";
import { SelectField } from "./form-fields/select-field";
import { SubmitButton } from "./form-fields/submit-button";
import { SwitchField } from "./form-fields/switch-field";
import { TextField } from "./form-fields/text-field";
import { VariablesField } from "./form-fields/variables-field";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export const { useAppForm, withForm } = createFormHook({
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
