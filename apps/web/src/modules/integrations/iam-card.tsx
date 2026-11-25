import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlugZap } from "lucide-react";
import { toast } from "sonner";
import type { CheckResult } from "@helpdesk/shared/api/common";
import { IAM_FIELDS, type IamMapping, type IamSettings } from "@helpdesk/shared/api/identity";
import { CheckResultAlert } from "@/components/check-result";
import { SecretField, initialSecret, secretPayload, type SecretValue } from "@/components/ui/secret-field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { ApiError, errorMessage } from "@/lib/api";
import { formQuery } from "@/modules/form-editor/api";
import { useIamSettings, useSaveIam, useTestIam } from "./api";
import { messages } from "./messages";

/** The questions of the current form that can fill a field: everything but files, checkboxes and the system questions. */
function useQuestions() {
  const form = useQuery(formQuery);
  return (form.data?.definition.pages ?? []).flatMap((page) =>
    page.questions
      .filter((question) => !question.system && question.type !== "file" && question.type !== "checkbox")
      .map((question) => ({ id: question.id, label: question.label })),
  );
}

function IamForm({ settings }: { settings: IamSettings }) {
  const t = useT(messages);
  const tc = useT(common);
  const id = useId();
  const save = useSaveIam();
  const test = useTestIam();
  const questions = useQuestions();
  const [url, setUrl] = useState(settings.url);
  const [apiKey, setApiKey] = useState<SecretValue>(initialSecret(settings.apiKeyHint !== null));
  const [mapping, setMapping] = useState<IamMapping>(settings.mapping);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CheckResult | null>(null);
  const dirty =
    url !== settings.url ||
    apiKey.mode !== "keep" ||
    JSON.stringify(mapping) !== JSON.stringify(settings.mapping);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    try {
      const saved = await save.mutateAsync({ url, apiKey: secretPayload(apiKey) ?? "", mapping });
      setUrl(saved.url);
      setApiKey(initialSecret(saved.apiKeyHint !== null));
      setMapping(saved.mapping);
      toast.success(t("iamSaved"));
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      toast.error(errorMessage(error));
    }
  };

  const runTest = async () => {
    setResult(null);
    try {
      setResult(await test.mutateAsync());
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  // A question that is gone from the form still shows, so the choice can be changed.
  const options = (field: keyof IamMapping) => {
    const chosen = mapping[field];
    return chosen && !questions.some((question) => question.id === chosen)
      ? [...questions, { id: chosen, label: chosen }]
      : questions;
  };

  return (
    <div className="grid gap-6">
      <form className="grid gap-6" noValidate onSubmit={(event) => void submit(event)}>
        <div className="grid gap-6 md:grid-cols-2">
          <Field data-invalid={errors.url ? true : undefined}>
            <FieldLabel htmlFor={`${id}-url`}>{t("iamUrl")}</FieldLabel>
            <Input
              id={`${id}-url`}
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              aria-invalid={errors.url ? true : undefined}
              aria-describedby={`${id}-url-hint`}
              onChange={(event) => setUrl(event.target.value)}
            />
            <FieldDescription id={`${id}-url-hint`}>{t("iamUrlHint")}</FieldDescription>
            {errors.url ? <FieldError>{errors.url}</FieldError> : null}
          </Field>
          <SecretField
            id={`${id}-key`}
            label={t("iamKey")}
            stored={settings.apiKeyHint !== null}
            hint={settings.apiKeyHint}
            value={apiKey}
            onChange={setApiKey}
            removable
            description={t("iamKeyHint")}
            error={errors.apiKey}
          />
        </div>
        <FieldSet>
          <FieldLegend variant="label">{t("iamMapping")}</FieldLegend>
          <FieldDescription>{t("iamMappingHint")}</FieldDescription>
          <div className="grid gap-4 sm:grid-cols-2">
            {IAM_FIELDS.map((field) => (
              <Field key={field}>
                <FieldLabel htmlFor={`${id}-map-${field}`}>{t(`field_${field}`)}</FieldLabel>
                <NativeSelect
                  id={`${id}-map-${field}`}
                  className="w-full"
                  value={mapping[field] ?? ""}
                  onChange={(event) =>
                    setMapping((current) => ({ ...current, [field]: event.target.value || null }))
                  }
                >
                  <NativeSelectOption value="">{t("iamNoQuestion")}</NativeSelectOption>
                  {options(field).map((question) => (
                    <NativeSelectOption key={question.id} value={question.id}>
                      {question.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ))}
          </div>
        </FieldSet>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || !dirty}>
            {save.isPending ? <Spinner /> : null}
            {tc("save")}
          </Button>
        </div>
      </form>
      {settings.url && settings.apiKeyHint ? (
        <>
          <Separator />
          <div className="grid gap-3">
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending}
                onClick={() => void runTest()}
              >
                {test.isPending ? <Spinner /> : <PlugZap />}
                {t("iamTest")}
              </Button>
            </div>
            {dirty ? <p className="text-muted-foreground text-sm">{t("iamTestSaveFirst")}</p> : null}
            {result ? <CheckResultAlert result={result} /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Superadmins connect IAM for identity requests. */
export function IamCard() {
  const t = useT(messages);
  const settings = useIamSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("iamTitle")}</h2>
        </CardTitle>
        <CardDescription>{t("iamDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isLoading ? (
          <LoadingState />
        ) : settings.isError || !settings.data ? (
          <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
        ) : (
          <IamForm settings={settings.data} />
        )}
      </CardContent>
    </Card>
  );
}
