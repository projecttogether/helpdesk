import { useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Paperclip, Send } from "lucide-react";
import type { Form } from "@helpdesk/shared/api/form";
import type { Attachment } from "@helpdesk/shared/api/tickets";
import {
  isAnswered,
  validateAnswers,
  visibleForm,
  type AnswerIssue,
  type Answers,
  type AnswerValue,
  type Question,
  type VisiblePage,
} from "@helpdesk/shared/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, api, errorMessage } from "@/lib/api";
import { LocaleContext, useT } from "@/i18n";
import { formMessages, issueMessages } from "./messages";
import { QuestionField, useChoices, type Choice } from "./question-field";

/** The page that holds a question, among the shown pages; -1 when none does. */
export function pageOfQuestion(visible: VisiblePage[], questionId: string): number {
  return visible.findIndex((entry) => entry.questions.some((question) => question.id === questionId));
}

/** What the review step shows for an answer. */
export function displayAnswer(
  question: Question,
  value: AnswerValue | undefined,
  choices: Choice[],
  files: Attachment[],
  yes: string,
): string[] {
  if (!isAnswered(question, value)) return [];
  if (question.type === "checkbox") return [yes];
  if (question.type === "file") return files.map((file) => file.filename);
  const ids = Array.isArray(value) ? value : [String(value)];
  if (question.type === "single_choice" || question.type === "multiple_choice") {
    return ids.map((id) => choices.find((choice) => choice.id === id)?.label ?? id);
  }
  return ids;
}

/** The answer problem a message of the server names, by its English text. */
const ISSUE_BY_TEXT = new Map(
  Object.entries(issueMessages.en).map(([code, text]) => [text, code as AnswerIssue]),
);

/**
 * The request form, one page at a time. Pages and questions appear by their
 * show-if rules (shared with the server); the last step reviews the answers.
 * Its own texts follow the form's language, not the app's.
 */
export function FormRunner(props: { form: Form; onSent: (number: number) => void }) {
  const language = props.form.definition.language;
  return (
    <LocaleContext.Provider value={language}>
      <div lang={language}>
        <Runner {...props} />
      </div>
    </LocaleContext.Provider>
  );
}

function Runner({ form, onSent }: { form: Form; onSent: (number: number) => void }) {
  const t = useT(formMessages);
  const issue = useT(issueMessages);
  const categoryChoices = useMemo(
    () => form.categories.map((category) => ({ id: category.id, label: category.name })),
    [form.categories],
  );
  const choicesOf = useChoices(categoryChoices);
  const [answers, setAnswers] = useState<Answers>({});
  const [files, setFiles] = useState<Record<string, Attachment[]>>({});
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<{ message: string; reload?: boolean } | null>(null);
  const submissionKey = useMemo(() => crypto.randomUUID(), []);
  const top = useRef<HTMLDivElement>(null);

  const definition = form.definition;
  const context = useMemo(
    () => ({ categoryIds: form.categories.map((category) => category.id) }),
    [form.categories],
  );
  const visible = useMemo(() => visibleForm(definition, answers), [definition, answers]);
  const steps = visible.length + 1;
  const current = Math.min(step, visible.length);
  const reviewing = current === visible.length;

  const issuesToErrors = (issues: Record<string, AnswerIssue>) =>
    Object.fromEntries(Object.entries(issues).map(([id, code]) => [id, issue(code)]));

  const goTo = (next: number) => {
    setStep(next);
    setProblem(null);
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const focusFirst = (ids: string[]) => {
    window.setTimeout(() => {
      for (const id of ids) {
        const element = document.querySelector<HTMLElement>(
          `#q-${CSS.escape(id)}, [id^="q-${CSS.escape(id)}-"]`,
        );
        if (element) {
          element.focus();
          return;
        }
      }
    }, 50);
  };

  const setAnswer = (id: string, value: AnswerValue) => {
    setAnswers((current) => ({ ...current, [id]: value }));
    setErrors((current) => {
      if (!(id in current)) return current;
      const { [id]: _removed, ...rest } = current;
      return rest;
    });
  };

  const next = () => {
    const page = visible[current];
    if (!page) return;
    const { issues } = validateAnswers(definition, answers, context, new Set([page.page.id]));
    if (Object.keys(issues).length > 0) {
      setErrors(issuesToErrors(issues));
      focusFirst(Object.keys(issues));
      return;
    }
    setErrors({});
    goTo(current + 1);
  };

  const send = async () => {
    const { values, issues } = validateAnswers(definition, answers, context);
    if (Object.keys(issues).length > 0) {
      setErrors(issuesToErrors(issues));
      const first = Math.min(
        ...Object.keys(issues)
          .map((id) => pageOfQuestion(visible, id))
          .filter((index) => index >= 0),
      );
      goTo(Number.isFinite(first) ? first : 0);
      return;
    }
    setSending(true);
    setProblem(null);
    try {
      const created = await api.post<{ number: number }>("/requests", {
        formVersionId: form.versionId,
        answers: values,
        submissionKey,
      });
      onSent(created.number);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.fields) {
        const fieldErrors = Object.fromEntries(
          Object.entries(error.fields)
            .filter(([key]) => key.startsWith("answers."))
            .map(([key, message]) => {
              const code = ISSUE_BY_TEXT.get(message);
              return [key.slice("answers.".length), code ? issue(code) : message];
            }),
        );
        setErrors(fieldErrors);
        const first = Object.keys(fieldErrors)
          .map((id) => pageOfQuestion(visible, id))
          .filter((index) => index >= 0);
        if (first.length > 0) goTo(Math.min(...first));
        setProblem({ message: t("fixErrors") });
      } else if (error instanceof ApiError && error.code === "form_changed") {
        setProblem({ message: t("formChanged"), reload: true });
      } else {
        setProblem({ message: errorMessage(error) });
      }
    } finally {
      setSending(false);
    }
  };

  const page = visible[current];
  return (
    <div ref={top} className="grid scroll-mt-20 gap-4">
      <div className="grid gap-2">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {t("step", { step: current + 1, steps })}
        </p>
        <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
          <div
            className="bg-primary h-full rounded-full transition-all"
            style={{ width: `${((current + 1) / steps) * 100}%` }}
          />
        </div>
      </div>

      {problem ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {problem.message}
            {problem.reload ? (
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                {t("reload")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        {reviewing ? (
          <>
            <CardHeader>
              <CardTitle>
                <h2>{t("review")}</h2>
              </CardTitle>
              <CardDescription>{t("reviewText")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              {visible.map((entry, index) => (
                <section key={entry.page.id} className="grid gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium">
                      {entry.page.title || t("step", { step: index + 1, steps })}
                    </h3>
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={() => goTo(index)}>
                      {t("edit")}
                    </Button>
                  </div>
                  <dl className="grid gap-3">
                    {entry.questions.map((question) => {
                      const shown = displayAnswer(
                        question,
                        answers[question.id],
                        choicesOf(question),
                        files[question.id] ?? [],
                        t("yes"),
                      );
                      return (
                        <div key={question.id} className="grid gap-0.5">
                          <dt className="text-muted-foreground text-sm">{question.label}</dt>
                          <dd className="text-sm break-words whitespace-pre-wrap">
                            {shown.length === 0 ? (
                              <span className="text-muted-foreground italic">{t("noAnswer")}</span>
                            ) : question.type === "file" ? (
                              <span className="inline-flex flex-wrap gap-2">
                                {shown.map((name) => (
                                  <span key={name} className="inline-flex items-center gap-1">
                                    <Paperclip className="size-3.5" aria-hidden />
                                    {name}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              shown.join(", ")
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>
              ))}
            </CardContent>
          </>
        ) : page ? (
          <>
            {page.page.title || page.page.description || current === 0 ? (
              <CardHeader>
                <CardTitle>
                  <h2>{page.page.title || definition.title}</h2>
                </CardTitle>
                {page.page.description || (current === 0 && definition.description) ? (
                  <CardDescription className="whitespace-pre-wrap">
                    {page.page.description || definition.description}
                  </CardDescription>
                ) : null}
              </CardHeader>
            ) : null}
            <CardContent>
              <FieldGroup>
                {page.questions.map((question) => (
                  <QuestionField
                    key={question.id}
                    question={question}
                    value={answers[question.id]}
                    onChange={(value) => setAnswer(question.id, value)}
                    choices={choicesOf(question)}
                    files={files[question.id] ?? []}
                    onFiles={(list) => setFiles((currentFiles) => ({ ...currentFiles, [question.id]: list }))}
                    onBusyChange={(busy) => setUploading((count) => Math.max(0, count + (busy ? 1 : -1)))}
                    error={errors[question.id]}
                  />
                ))}
              </FieldGroup>
            </CardContent>
          </>
        ) : null}
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={() => goTo(current - 1)} disabled={current === 0 || sending}>
          <ArrowLeft />
          {t("back")}
        </Button>
        {reviewing ? (
          <Button onClick={() => void send()} disabled={sending || uploading > 0}>
            {sending ? <Spinner /> : <Send />}
            {t("send")}
          </Button>
        ) : (
          <Button onClick={next} disabled={uploading > 0}>
            {t("next")}
            <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}
