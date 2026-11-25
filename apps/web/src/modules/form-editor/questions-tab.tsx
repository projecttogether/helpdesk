import { CircleAlert, Info, Plus } from "lucide-react";
import type { Form } from "@helpdesk/shared/api/form";
import { FORM_LANGUAGES, type FormLanguage } from "@helpdesk/shared/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { useFormatter } from "@/lib/format";
import {
  addPage,
  messagesAt,
  problemTarget,
  updateForm,
  type Problem,
  type ProblemIndex,
} from "./editor-state";
import { messages } from "./messages";
import { PageCard } from "./page-card";
import { FieldProblems, refocus, useProblemText, type EditorContext } from "./parts";
import { questionSelector } from "./question-card";

/** The editor of the form's questions: the form's title and intro, then its pages. */
export function QuestionsTab(props: {
  ctx: EditorContext;
  /** The published version the draft started from. */
  form: Form;
  problems: readonly Problem[];
  index: ProblemIndex;
  openQuestions: ReadonlySet<string>;
  onOpenQuestion: (id: string, open: boolean) => void;
}) {
  const t = useT(messages);
  const format = useFormatter();
  const { ctx, form, index } = props;
  const definition = ctx.definition;
  const titleProblems = messagesAt(index.form, "title");
  const descriptionProblems = messagesAt(index.form, "description");

  const add = () => {
    const result = addPage(definition, t("newPage"));
    ctx.onChange(result.definition);
    refocus(`#page-title-${result.pageId}`, undefined, { select: true });
  };

  return (
    <div className="space-y-6">
      <Alert role="note">
        <Info aria-hidden />
        <AlertTitle>
          {t(form.updatedBy ? "version" : "versionNoAuthor", {
            version: form.version,
            when: format.relative(form.updatedAt),
            who: form.updatedBy ?? "",
          })}
        </AlertTitle>
        <AlertDescription>{t("versionsNote")}</AlertDescription>
      </Alert>

      {props.problems.length > 0 ? (
        <ProblemSummary
          ctx={ctx}
          problems={props.problems}
          onOpenQuestion={(id) => props.onOpenQuestion(id, true)}
        />
      ) : null}

      <Card
        data-form-settings
        className="scroll-mt-24 gap-0 py-0"
        role="region"
        aria-labelledby="form-settings-heading"
      >
        <div className="border-b px-4 py-3">
          <h2 id="form-settings-heading" className="text-sm font-semibold">
            {t("formSection")}
          </h2>
        </div>
        <div className="grid gap-4 p-4">
          <Field data-invalid={titleProblems.length > 0 || undefined}>
            <FieldLabel htmlFor="form-title">{t("formTitle")}</FieldLabel>
            <Input
              id="form-title"
              value={definition.title}
              maxLength={200}
              aria-invalid={titleProblems.length > 0}
              onChange={(event) => ctx.onChange(updateForm(definition, { title: event.target.value }))}
            />
            <FieldProblems messages={titleProblems} />
          </Field>
          <Field data-invalid={descriptionProblems.length > 0 || undefined}>
            <FieldLabel htmlFor="form-intro">{t("formIntro")}</FieldLabel>
            <Textarea
              id="form-intro"
              rows={3}
              value={definition.description}
              maxLength={2000}
              aria-invalid={descriptionProblems.length > 0}
              aria-describedby="form-intro-hint"
              onChange={(event) => ctx.onChange(updateForm(definition, { description: event.target.value }))}
            />
            <FieldDescription id="form-intro-hint">{t("formIntroHint")}</FieldDescription>
            <FieldProblems messages={descriptionProblems} />
          </Field>
          <Field>
            <FieldLabel htmlFor="form-language">{t("formLanguage")}</FieldLabel>
            <Select
              value={definition.language}
              onValueChange={(language) =>
                ctx.onChange(updateForm(definition, { language: language as FormLanguage }))
              }
            >
              <SelectTrigger id="form-language" aria-describedby="form-language-hint" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORM_LANGUAGES.map((language) => (
                  <SelectItem key={language} value={language}>
                    {t(`language_${language}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription id="form-language-hint">{t("formLanguageHint")}</FieldDescription>
          </Field>
        </div>
      </Card>

      <ol className="space-y-6">
        {definition.pages.map((page, pageIndex) => (
          <li key={page.id}>
            <PageCard
              ctx={ctx}
              page={page}
              pageIndex={pageIndex}
              problems={index}
              openQuestions={props.openQuestions}
              onOpenQuestion={props.onOpenQuestion}
            />
          </li>
        ))}
      </ol>
      <FieldProblems
        messages={index.form
          .filter((problem) => problem.rest[0] !== "title" && problem.rest[0] !== "description")
          .map((problem) => problem.message)}
      />
      <Button
        type="button"
        variant="outline"
        data-action="add-page"
        disabled={definition.pages.length >= 30}
        onClick={add}
      >
        <Plus aria-hidden />
        {t("addPage")}
      </Button>
    </div>
  );
}

/** All problems in one list; each one jumps to its place. */
function ProblemSummary(props: {
  ctx: EditorContext;
  problems: readonly Problem[];
  onOpenQuestion: (id: string) => void;
}) {
  const t = useT(messages);
  const text = useProblemText();
  const { definition } = props.ctx;

  const describe = (problem: Problem) => {
    const target = problemTarget(problem.path);
    if (target.scope === "form") return { where: t("problemForm"), jump: () => refocus("#form-title") };
    const page = definition.pages[target.pageIndex];
    if (target.scope === "page" || !page) {
      return {
        where: t("problemPage", { page: target.pageIndex + 1 }),
        jump: () =>
          page &&
          refocus(
            `[data-page="${page.id}"] [aria-invalid="true"]`,
            `[data-page="${page.id}"] [data-action="add-question"]`,
          ),
      };
    }
    const question = page.questions[target.questionIndex];
    return {
      where: t("problemQuestion", {
        page: target.pageIndex + 1,
        label: question?.label.trim() || t("untitled"),
      }),
      jump: () => {
        if (!question) return;
        props.onOpenQuestion(question.id);
        refocus(
          `${questionSelector(question.id)} [aria-invalid="true"]`,
          questionSelector(question.id, "toggle"),
        );
      },
    };
  };

  return (
    // Not a live region: it changes while typing; the save bar announces the count.
    <Alert variant="destructive" role="region" aria-label={t("problemsTitle")}>
      <CircleAlert aria-hidden />
      <AlertTitle>{t("problemsTitle")}</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 space-y-1">
          {props.problems.map((problem) => {
            const { where, jump } = describe(problem);
            return (
              <li key={`${problem.path.join(".")}|${problem.message}`}>
                <button
                  type="button"
                  className="focus-visible:ring-ring/50 rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
                  onClick={jump}
                >
                  <span className="font-medium">{where}:</span> {text(problem.message)}
                </button>
              </li>
            );
          })}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
