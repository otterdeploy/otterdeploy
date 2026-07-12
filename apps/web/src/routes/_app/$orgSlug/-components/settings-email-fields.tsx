import { Input } from "@/shared/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/shared/components/ui/native-select";

import {
  EMAIL_FORM_SHAPE,
  type EmailSettings,
  withForm,
} from "./settings-email-form";

export const ProviderFields = withForm({
  defaultValues: EMAIL_FORM_SHAPE,
  props: { settings: {} as EmailSettings },
  render: ({ form, settings }) => (
    <>
      <form.Field name="provider">
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email-provider" className="text-[12px] font-medium">
              Provider
            </label>
            <NativeSelect
              id="email-provider"
              value={field.state.value}
              onChange={(e) =>
                field.handleChange(e.target.value as "" | "resend" | "smtp")
              }
            >
              <NativeSelectOption value="">
                Platform default (env)
              </NativeSelectOption>
              <NativeSelectOption value="resend">Resend</NativeSelectOption>
              <NativeSelectOption value="smtp">SMTP</NativeSelectOption>
            </NativeSelect>
          </div>
        )}
      </form.Field>

      <form.Subscribe selector={(s) => s.values.provider}>
        {(provider) => (
          <>
            {provider !== "" && (
              <form.Field name="from">
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="email-from" className="text-[12px] font-medium">
                      From address
                    </label>
                    <Input
                      id="email-from"
                      type="text"
                      placeholder="otterdeploy <no-reply@acme.com>"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      className="text-[13px]"
                    />
                  </div>
                )}
              </form.Field>
            )}

            {provider === "resend" && (
              <form.Field name="resendApiKey">
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="email-resend-api-key" className="text-[12px] font-medium">
                      Resend API key
                    </label>
                    <Input
                      id="email-resend-api-key"
                      type="password"
                      placeholder={
                        settings.resendConfigured
                          ? "•••••••• (configured)"
                          : "re_…"
                      }
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      autoComplete="new-password"
                      className="font-mono text-[13px]"
                    />
                  </div>
                )}
              </form.Field>
            )}

            {provider === "smtp" && (
              <SmtpFields form={form} settings={settings} />
            )}
          </>
        )}
      </form.Subscribe>
    </>
  ),
});

const SmtpFields = withForm({
  defaultValues: EMAIL_FORM_SHAPE,
  props: { settings: {} as EmailSettings },
  render: ({ form, settings }) => (
    <>
      <div className="flex gap-2">
        <form.Field name="smtpHost">
          {(field) => (
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="email-smtp-host" className="text-[12px] font-medium">
                SMTP host
              </label>
              <Input
                id="email-smtp-host"
                type="text"
                placeholder="smtp.example.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                className="font-mono text-[13px]"
              />
            </div>
          )}
        </form.Field>
        <form.Field name="smtpPort">
          {(field) => (
            <div className="flex w-24 flex-col gap-1.5">
              <label htmlFor="email-smtp-port" className="text-[12px] font-medium">
                Port
              </label>
              <Input
                id="email-smtp-port"
                type="number"
                placeholder="587"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                className="font-mono text-[13px]"
              />
            </div>
          )}
        </form.Field>
      </div>
      <form.Field name="smtpSecure">
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email-smtp-secure" className="text-[12px] font-medium">
              Security
            </label>
            <NativeSelect
              id="email-smtp-secure"
              value={field.state.value ? "tls" : "starttls"}
              onChange={(e) => field.handleChange(e.target.value === "tls")}
            >
              <NativeSelectOption value="starttls">
                STARTTLS (587)
              </NativeSelectOption>
              <NativeSelectOption value="tls">TLS (465)</NativeSelectOption>
            </NativeSelect>
          </div>
        )}
      </form.Field>
      <form.Field name="smtpUser">
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email-smtp-user" className="text-[12px] font-medium">
              Username
            </label>
            <Input
              id="email-smtp-user"
              type="text"
              placeholder="apikey / user@example.com"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              autoComplete="off"
              className="font-mono text-[13px]"
            />
          </div>
        )}
      </form.Field>
      <form.Field name="smtpPassword">
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email-smtp-password" className="text-[12px] font-medium">
              Password
            </label>
            <Input
              id="email-smtp-password"
              type="password"
              placeholder={
                settings.smtpPasswordConfigured
                  ? "•••••••• (configured)"
                  : "password"
              }
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              autoComplete="new-password"
              className="font-mono text-[13px]"
            />
          </div>
        )}
      </form.Field>
    </>
  ),
});
