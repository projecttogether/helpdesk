import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { AlertTriangle, ChevronDown, ExternalLink, Info, Lock, Send, Unplug } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import type { CheckResult } from "@helpdesk/shared/api/common";
import {
  OPTIONAL_SLACK_SCOPES,
  REQUIRED_SLACK_SCOPES,
  slackSettingsInputSchema,
  type SlackSettings,
  type SlackSettingsInput,
} from "@helpdesk/shared/api/integrations";
import { CheckResultAlert } from "@/components/check-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SecretField, initialSecret, secretPayload, type SecretValue } from "@/components/ui/secret-field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { errorMessage } from "@/lib/api";
import { applyServerErrors, firstMessage, useSchemaResolver } from "@/lib/validation";
import { useSaveSlack, useSlackChannels, useSlackSettings, useTestSlack, type SlackChannel } from "./api";
import { messages } from "./messages";

const NEW_APP_URL = "https://api.slack.com/apps?new_app=1";
const NO_CHANNEL = "__none__";
const SCOPES = [...REQUIRED_SLACK_SCOPES, ...OPTIONAL_SLACK_SCOPES];

export type SlackValues = { botToken: SecretValue; channelId: string };

export function slackValues(settings: SlackSettings): SlackValues {
  return { botToken: initialSecret(settings.configured), channelId: settings.channelId ?? "" };
}

/** The API input: an empty token keeps the stored one; an empty channel posts no new tickets. */
export function slackInput(values: SlackValues): SlackSettingsInput {
  return { botToken: secretPayload(values.botToken) ?? "", channelId: values.channelId.trim() || null };
}

const slackFormSchema = z
  .object({
    botToken: z
      .object({ mode: z.enum(["keep", "replace", "remove"]), value: z.string() })
      .refine(
        (secret) =>
          secret.mode !== "replace" || !secret.value.trim() || secret.value.trim().startsWith("xoxb-"),
        "A bot token starts with xoxb-",
      ),
    channelId: z.string(),
  })
  .transform(slackInput)
  .pipe(slackSettingsInputSchema);

type SlackOutput = z.output<typeof slackFormSchema>;

function Scopes({ scopes }: { scopes: readonly string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {scopes.map((scope) => (
        <code key={scope} className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
          {scope}
        </code>
      ))}
    </span>
  );
}

function MissingScopes({ missing }: { missing: string[] }) {
  const t = useT(messages);
  const required = missing.filter((scope) => (REQUIRED_SLACK_SCOPES as readonly string[]).includes(scope));
  const optional = missing.filter((scope) => (OPTIONAL_SLACK_SCOPES as readonly string[]).includes(scope));
  return (
    <>
      {required.length ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t("missingRequired")}</AlertTitle>
          <AlertDescription>
            <p>{t("missingRequiredText", { scopes: required.join(", ") })}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      {optional.length ? (
        <Alert>
          <Info />
          <AlertTitle>{t("missingOptional")}</AlertTitle>
          <AlertDescription>
            <p>{t("missingOptionalText", { scopes: optional.join(", ") })}</p>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

function Connection({ settings }: { settings: SlackSettings }) {
  const t = useT(messages);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{t("workspace")}</dt>
      <dd className="min-w-0 break-words">{settings.teamName ?? "—"}</dd>
      <dt className="text-muted-foreground">{t("bot")}</dt>
      <dd className="min-w-0 break-words">{settings.botName ? `@${settings.botName}` : "—"}</dd>
      <dt className="text-muted-foreground">{t("channel")}</dt>
      <dd className="min-w-0 break-words">
        {settings.channelName ? (
          `#${settings.channelName}`
        ) : settings.channelId ? (
          <code className="font-mono text-xs">{settings.channelId}</code>
        ) : (
          <span className="text-muted-foreground">{t("noChannel")}</span>
        )}
      </dd>
    </dl>
  );
}

function SetupGuide({ defaultOpen }: { defaultOpen: boolean }) {
  const t = useT(messages);
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="grid gap-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-fit px-2">
          <ChevronDown
            className={open ? "rotate-180 transition-transform" : "transition-transform"}
            aria-hidden
          />
          {t("guideTitle")}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="grid list-decimal gap-2 pl-6 text-sm">
          <li>
            {t("guide1")}{" "}
            <a
              href={NEW_APP_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              {t("guideOpen")}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </li>
          <li>
            {t("guide2")} <Scopes scopes={SCOPES} />
          </li>
          <li>{t("guide3")}</li>
          <li>{t("guide4")}</li>
          <li>{t("guide5")}</li>
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function channelLabel(channel: SlackChannel, t: (key: "channelPrivate" | "channelNotMember") => string) {
  const notes = [
    channel.isPrivate ? t("channelPrivate") : null,
    channel.isMember ? null : t("channelNotMember"),
  ];
  const extra = notes.filter(Boolean).join(", ");
  return extra ? `#${channel.name} (${extra})` : `#${channel.name}`;
}

/** A channel picker from the bot's channel list, or an ID input when the list isn't available. */
function ChannelField(props: {
  id: string;
  settings: SlackSettings;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const t = useT(messages);
  const [manual, setManual] = useState(false);
  const channels = useSlackChannels(props.settings.configured);
  const hintId = `${props.id}-hint`;

  const listed = channels.data?.items ?? [];
  const items =
    props.value && !listed.some((channel) => channel.id === props.value)
      ? [
          {
            id: props.value,
            name:
              props.value === props.settings.channelId
                ? (props.settings.channelName ?? props.value)
                : props.value,
            isPrivate: false,
            isMember: true,
          },
          ...listed,
        ]
      : listed;

  if (props.settings.configured && channels.isLoading) {
    return (
      <Field>
        <FieldLabel htmlFor={props.id}>{t("channel")}</FieldLabel>
        <div id={props.id} tabIndex={-1} className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner />
          {t("channelsLoading")}
        </div>
      </Field>
    );
  }

  const useList = props.settings.configured && channels.isSuccess && !manual;
  return (
    <Field data-invalid={props.error ? true : undefined}>
      <FieldLabel htmlFor={props.id}>{useList ? t("channel") : t("channelId")}</FieldLabel>
      {useList ? (
        <Select
          value={props.value || NO_CHANNEL}
          onValueChange={(value) => props.onChange(value === NO_CHANNEL ? "" : value)}
        >
          <SelectTrigger
            id={props.id}
            className="w-full sm:max-w-sm"
            aria-describedby={hintId}
            aria-invalid={props.error ? true : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CHANNEL}>{t("channelNone")}</SelectItem>
            {items.map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                {channel.isPrivate ? <Lock aria-hidden /> : null}
                {channelLabel(channel, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={props.id}
          className="font-mono sm:max-w-sm"
          autoComplete="off"
          spellCheck={false}
          placeholder="C0123456789"
          value={props.value}
          aria-describedby={hintId}
          aria-invalid={props.error ? true : undefined}
          onChange={(event) => props.onChange(event.target.value.toUpperCase())}
        />
      )}
      <FieldDescription id={hintId}>
        {useList ? t("channelHint") : t("channelIdHint")}
        {props.settings.configured && channels.isError ? ` ${errorMessage(channels.error)}` : null}
      </FieldDescription>
      {props.settings.configured && channels.isSuccess ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto w-fit p-0"
          onClick={() => setManual(!manual)}
        >
          {manual ? t("chooseFromList") : t("enterId")}
        </Button>
      ) : null}
      {props.error ? <FieldError>{props.error}</FieldError> : null}
    </Field>
  );
}

/** Slack settings of a loaded configuration. */
export function SlackForm({ settings }: { settings: SlackSettings }) {
  const t = useT(messages);
  const tc = useT(common);
  const id = useId();
  const save = useSaveSlack();
  const test = useTestSlack();
  const [result, setResult] = useState<CheckResult | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const resolver = useSchemaResolver<SlackValues, SlackOutput>(slackFormSchema);
  const form = useForm<SlackValues, unknown, SlackOutput>({ resolver, defaultValues: slackValues(settings) });
  const { isSubmitting, isDirty } = form.formState;

  const submit = form.handleSubmit(async (input) => {
    if (!settings.configured && !input.botToken) {
      form.setError("botToken", { type: "required", message: t("tokenRequired") });
      return;
    }
    try {
      const saved = await save.mutateAsync(input);
      form.reset(slackValues(saved));
      setResult(null);
      toast.success(t("slackSaved"));
    } catch (error) {
      applyServerErrors(form, error);
      toast.error(errorMessage(error));
    }
  });

  const runTest = async () => {
    setResult(null);
    try {
      setResult(await test.mutateAsync());
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const disconnect = async () => {
    try {
      const saved = await save.mutateAsync({ botToken: null, channelId: settings.channelId });
      form.reset(slackValues(saved));
      setResult(null);
      toast.success(t("disconnected"));
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  };

  return (
    <div className="grid gap-6">
      {settings.configured ? <Connection settings={settings} /> : null}
      {settings.missingScopes.length ? <MissingScopes missing={settings.missingScopes} /> : null}
      <SetupGuide defaultOpen={!settings.configured} />
      <form className="grid gap-6" noValidate onSubmit={(event) => void submit(event)}>
        <Controller
          control={form.control}
          name="botToken"
          render={({ field, fieldState }) => (
            <SecretField
              id={`${id}-token`}
              label={t("botToken")}
              stored={settings.configured}
              hint={settings.botTokenHint}
              value={field.value}
              onChange={field.onChange}
              placeholder="xoxb-…"
              description={t("botTokenHint")}
              error={firstMessage(fieldState.error)}
            />
          )}
        />
        <Controller
          control={form.control}
          name="channelId"
          render={({ field, fieldState }) => (
            <ChannelField
              id={`${id}-channel`}
              settings={settings}
              value={field.value}
              onChange={field.onChange}
              error={firstMessage(fieldState.error)}
            />
          )}
        />
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
              onClick={() => form.reset(slackValues(settings))}
            >
              {tc("discard")}
            </Button>
          ) : null}
        </div>
      </form>

      {settings.configured ? (
        <>
          <Separator />
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending || !settings.channelId}
                onClick={() => void runTest()}
              >
                {test.isPending ? <Spinner /> : <Send />}
                {t("postTest")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setConfirmDisconnect(true)}>
                <Unplug />
                {t("disconnect")}
              </Button>
            </div>
            {isDirty ? <p className="text-muted-foreground text-sm">{t("testSaveFirst")}</p> : null}
            {result ? <CheckResultAlert result={result} /> : null}
          </div>
          <ConfirmDialog
            open={confirmDisconnect}
            onOpenChange={setConfirmDisconnect}
            title={t("disconnectTitle")}
            description={t("disconnectText")}
            confirmLabel={t("disconnect")}
            destructive
            onConfirm={disconnect}
          />
        </>
      ) : null}
    </div>
  );
}

export function SlackCard() {
  const t = useT(messages);
  const settings = useSlackSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("slackTitle")}</h2>
        </CardTitle>
        <CardDescription>{t("slackDescription")}</CardDescription>
        {settings.data ? (
          <CardAction>
            <Badge variant={settings.data.configured ? "secondary" : "outline"}>
              {settings.data.configured ? t("connected") : t("notConnected")}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {settings.isLoading ? (
          <LoadingState />
        ) : settings.isError || !settings.data ? (
          <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
        ) : (
          <SlackForm settings={settings.data} />
        )}
      </CardContent>
    </Card>
  );
}
