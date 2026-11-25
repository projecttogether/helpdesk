import { useId, useState } from "react";
import { Controller, useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import type { CheckResult } from "@helpdesk/shared/api/common";
import {
  emailProviderSchema,
  emailSettingsInputSchema,
  SMTP_SECURITY,
  type EmailProvider,
  type EmailSettings,
  type EmailSettingsInput,
} from "@helpdesk/shared/api/integrations";
import { CheckResultAlert } from "@/components/check-result";
import { SecretField, initialSecret, secretPayload, type SecretValue } from "@/components/ui/secret-field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/hooks/use-me";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { ApiError, errorMessage } from "@/lib/api";
import { applyServerErrors, firstMessage, useSchemaResolver } from "@/lib/validation";
import { useEmailSettings, useSaveEmail, useTestEmail } from "./api";
import { messages } from "./messages";

type SmtpSecurity = (typeof SMTP_SECURITY)[number];

/** The form's values: text fields stay strings, secrets are write-only. */
export type EmailValues = {
  provider: EmailProvider;
  fromAddress: string;
  fromName: string;
  smtp: { host: string; port: string; security: SmtpSecurity; username: string; password: SecretValue };
  mailersend: { token: SecretValue };
};

export function emailValues(settings: EmailSettings): EmailValues {
  return {
    provider: settings.provider,
    fromAddress: settings.fromAddress,
    fromName: settings.fromName,
    smtp: {
      host: settings.smtp.host,
      port: String(settings.smtp.port),
      security: settings.smtp.security,
      username: settings.smtp.username,
      password: initialSecret(settings.smtp.passwordHint !== null),
    },
    mailersend: { token: initialSecret(settings.mailersend.tokenHint !== null) },
  };
}

/**
 * The API input. An empty secret keeps the stored one. SMTP fields are
 * kept while another provider is chosen; a port typed there only counts
 * when SMTP is on (empty: the default 587).
 */
export function emailInput(values: EmailValues): EmailSettingsInput {
  const port = values.smtp.port.trim();
  const portNumber = Number(port);
  const validPort = port !== "" && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  return {
    provider: values.provider,
    fromAddress: values.fromAddress,
    fromName: values.fromName,
    smtp: {
      host: values.smtp.host,
      port: values.provider === "smtp" ? port || undefined : validPort ? portNumber : undefined,
      security: values.smtp.security,
      username: values.smtp.username,
      password: secretPayload(values.smtp.password) ?? "",
    },
    mailersend: { token: secretPayload(values.mailersend.token) ?? "" },
  };
}

const secretValueSchema = z.object({ mode: z.enum(["keep", "replace", "remove"]), value: z.string() });

const emailFormSchema = z
  .object({
    provider: emailProviderSchema,
    fromAddress: z.string(),
    fromName: z.string(),
    smtp: z.object({
      host: z.string(),
      port: z.string(),
      security: z.enum(SMTP_SECURITY),
      username: z.string(),
      password: secretValueSchema,
    }),
    mailersend: z.object({ token: secretValueSchema }),
  })
  .transform(emailInput)
  .pipe(emailSettingsInputSchema);

type EmailOutput = z.output<typeof emailFormSchema>;

const PROVIDERS: EmailProvider[] = ["none", "smtp", "mailersend"];

function TextField(props: {
  form: UseFormReturn<EmailValues, unknown, EmailOutput>;
  name: "fromAddress" | "fromName" | "smtp.host" | "smtp.port" | "smtp.username";
  id: string;
  label: string;
  hint?: string;
  type?: string;
  inputMode?: "numeric";
  autoComplete?: string;
  className?: string;
}) {
  const state = props.form.getFieldState(props.name, props.form.formState);
  const error = firstMessage(state.error);
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  return (
    <Field data-invalid={error ? true : undefined} className={props.className}>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete ?? "off"}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={hintId}
        {...props.form.register(props.name)}
      />
      {props.hint ? <FieldDescription id={hintId}>{props.hint}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function TestEmail(props: { defaultTo: string; dirty: boolean }) {
  const t = useT(messages);
  const id = useId();
  const test = useTestEmail();
  const [to, setTo] = useState(props.defaultTo);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  const send = async () => {
    setError(null);
    setResult(null);
    try {
      setResult(await test.mutateAsync(to.trim()));
    } catch (failure) {
      const field = failure instanceof ApiError ? failure.fields?.to : undefined;
      if (field) setError(field);
      else toast.error(errorMessage(failure));
    }
  };

  return (
    <section className="grid gap-4" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-medium">
        {t("testTitle")}
      </h3>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Field data-invalid={error ? true : undefined} className="sm:max-w-sm">
          <FieldLabel htmlFor={`${id}-to`} className="sr-only">
            {t("testTo")}
          </FieldLabel>
          <Input
            id={`${id}-to`}
            type="email"
            autoComplete="email"
            value={to}
            placeholder={t("testTo")}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setTo(event.target.value)}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <Button type="submit" variant="outline" disabled={test.isPending || !to.trim()}>
          {test.isPending ? <Spinner /> : <Send />}
          {t("testSend")}
        </Button>
      </form>
      {props.dirty ? <p className="text-muted-foreground text-sm">{t("testSaveFirst")}</p> : null}
      {result ? <CheckResultAlert result={result} /> : null}
    </section>
  );
}

/** Email settings of a loaded configuration; `defaultTo` is where test emails go first. */
export function EmailForm(props: { settings: EmailSettings; defaultTo: string }) {
  const t = useT(messages);
  const tc = useT(common);
  const id = useId();
  const save = useSaveEmail();
  const resolver = useSchemaResolver<EmailValues, EmailOutput>(emailFormSchema);
  const form = useForm<EmailValues, unknown, EmailOutput>({
    resolver,
    defaultValues: emailValues(props.settings),
  });
  const provider = useWatch({ control: form.control, name: "provider" });
  const { isSubmitting, isDirty } = form.formState;
  const providerLabel: Record<EmailProvider, { title: string; hint: string }> = {
    none: { title: t("providerNone"), hint: t("providerNoneHint") },
    smtp: { title: t("providerSmtp"), hint: t("providerSmtpHint") },
    mailersend: { title: t("providerMailersend"), hint: t("providerMailersendHint") },
  };
  const securityLabel: Record<SmtpSecurity, string> = {
    tls: t("securityTls"),
    starttls: t("securityStarttls"),
    none: t("securityNone"),
  };

  const submit = form.handleSubmit(async (input) => {
    try {
      const saved = await save.mutateAsync(input);
      form.reset(emailValues(saved));
      toast.success(t("emailSaved"));
    } catch (error) {
      applyServerErrors(form, error);
      toast.error(errorMessage(error));
    }
  });

  return (
    <div className="grid gap-6">
      <form className="grid gap-6" noValidate onSubmit={(event) => void submit(event)}>
        <Controller
          control={form.control}
          name="provider"
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label">{t("provider")}</FieldLegend>
              <RadioGroup
                aria-label={t("provider")}
                value={field.value}
                onValueChange={(value) => field.onChange(value as EmailProvider)}
                className="grid gap-3 sm:grid-cols-3"
              >
                {PROVIDERS.map((option) => (
                  <FieldLabel key={option} htmlFor={`${id}-provider-${option}`}>
                    <Field orientation="horizontal">
                      <RadioGroupItem value={option} id={`${id}-provider-${option}`} />
                      <FieldContent>
                        <FieldTitle>{providerLabel[option].title}</FieldTitle>
                        <FieldDescription>{providerLabel[option].hint}</FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
        />

        {provider !== "none" ? (
          <FieldGroup className="grid gap-6 md:grid-cols-2">
            <TextField
              form={form}
              name="fromAddress"
              id={`${id}-from-address`}
              label={t("fromAddress")}
              hint={t("fromAddressHint")}
              type="email"
            />
            <TextField
              form={form}
              name="fromName"
              id={`${id}-from-name`}
              label={t("fromName")}
              hint={t("fromNameHint")}
            />
          </FieldGroup>
        ) : null}

        {provider === "smtp" ? (
          <FieldGroup className="grid gap-6 md:grid-cols-2">
            <TextField form={form} name="smtp.host" id={`${id}-smtp-host`} label={t("smtpHost")} />
            <div className="grid grid-cols-[6rem_1fr] gap-4">
              <TextField
                form={form}
                name="smtp.port"
                id={`${id}-smtp-port`}
                label={t("smtpPort")}
                inputMode="numeric"
              />
              <Controller
                control={form.control}
                name="smtp.security"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor={`${id}-smtp-security`}>{t("smtpSecurity")}</FieldLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => field.onChange(value as SmtpSecurity)}
                    >
                      <SelectTrigger id={`${id}-smtp-security`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SMTP_SECURITY.map((option) => (
                          <SelectItem key={option} value={option}>
                            {securityLabel[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
            </div>
            <TextField
              form={form}
              name="smtp.username"
              id={`${id}-smtp-username`}
              label={t("smtpUsername")}
              hint={t("smtpUsernameHint")}
            />
            <Controller
              control={form.control}
              name="smtp.password"
              render={({ field, fieldState }) => (
                <SecretField
                  id={`${id}-smtp-password`}
                  label={t("smtpPassword")}
                  stored={props.settings.smtp.passwordHint !== null}
                  hint={props.settings.smtp.passwordHint}
                  value={field.value}
                  onChange={field.onChange}
                  error={firstMessage(fieldState.error)}
                />
              )}
            />
          </FieldGroup>
        ) : null}

        {provider === "mailersend" ? (
          <Controller
            control={form.control}
            name="mailersend.token"
            render={({ field, fieldState }) => (
              <SecretField
                id={`${id}-mailersend-token`}
                label={t("mailersendToken")}
                stored={props.settings.mailersend.tokenHint !== null}
                hint={props.settings.mailersend.tokenHint}
                value={field.value}
                onChange={field.onChange}
                description={t("mailersendTokenHint")}
                error={firstMessage(fieldState.error)}
              />
            )}
          />
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? <Spinner /> : null}
            {tc("save")}
          </Button>
          {isDirty ? (
            <Button
              type="button"
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => form.reset(emailValues(props.settings))}
            >
              {tc("discard")}
            </Button>
          ) : null}
        </div>
      </form>

      {props.settings.provider !== "none" ? (
        <>
          <Separator />
          <TestEmail defaultTo={props.defaultTo} dirty={isDirty} />
        </>
      ) : null}
    </div>
  );
}

export function EmailCard() {
  const t = useT(messages);
  const me = useMe();
  const settings = useEmailSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("emailTitle")}</h2>
        </CardTitle>
        <CardDescription>{t("emailDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isLoading ? (
          <LoadingState />
        ) : settings.isError || !settings.data ? (
          <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
        ) : (
          <EmailForm settings={settings.data} defaultTo={me.email} />
        )}
      </CardContent>
    </Card>
  );
}
