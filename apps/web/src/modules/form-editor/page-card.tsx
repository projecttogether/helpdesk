import { useRef } from "react";
import { ArrowDown, ArrowUp, Info, Plus, Trash2 } from "lucide-react";
import { QUESTION_TYPES, type Page } from "@helpdesk/shared/form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { ConditionEditor } from "./condition-editor";
import {
  addQuestion,
  canDeletePage,
  canMovePage,
  createQuestion,
  deletePage,
  earlierQuestions,
  messagesAt,
  messagesExcept,
  movePage,
  pageReferences,
  questionKey,
  updatePage,
  type Direction,
  type ProblemIndex,
} from "./editor-state";
import { messages } from "./messages";
import { FieldProblems, ReferenceList, refocus, TYPE_ICONS, type EditorContext } from "./parts";
import { QuestionCard } from "./question-card";

const pageSelector = (id: string, action: string) => `[data-page="${id}"] [data-action="${action}"]`;

/** One page of the form: its title, description, condition and questions. */
export function PageCard(props: {
  ctx: EditorContext;
  page: Page;
  pageIndex: number;
  problems: ProblemIndex;
  openQuestions: ReadonlySet<string>;
  onOpenQuestion: (id: string, open: boolean) => void;
}) {
  const t = useT(messages);
  const tc = useT(common);
  const { ctx, page, pageIndex } = props;
  const definition = ctx.definition;
  const pageCount = definition.pages.length;
  const pageProblems = props.problems.pages.get(pageIndex);
  const titleId = `page-title-${page.id}`;
  const descriptionId = `page-description-${page.id}`;
  /** A question was added from the menu: focus its label instead of the menu trigger. */
  const added = useRef(false);

  const move = (direction: Direction) => {
    ctx.onChange(movePage(definition, pageIndex, direction));
    refocus(pageSelector(page.id, `move-${direction}`), pageSelector(page.id, "add-question"));
  };

  const remove = () => {
    const references = pageReferences(definition, pageIndex);
    const count = page.questions.length;
    ctx.askConfirm({
      title: t("deletePageTitle", { page: pageIndex + 1 }),
      description: count ? t("deletePageText", { count }) : t("deletePageEmpty"),
      details: <ReferenceList references={references} intro={t("referencesPagesIntro")} />,
      confirmLabel: tc("delete"),
      onConfirm: () => {
        ctx.onChange(deletePage(ctx.definition, pageIndex));
        refocus('[data-action="add-page"]');
      },
    });
  };

  return (
    <Card
      data-page={page.id}
      id={`page-${page.id}`}
      className="scroll-mt-24 gap-0 py-0"
      aria-labelledby={`${titleId}-heading`}
      role="region"
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={`${titleId}-heading`} className="truncate text-sm font-semibold">
            {t("pageOf", { page: pageIndex + 1, pages: pageCount })}
            {page.title.trim() ? (
              <span className="text-muted-foreground font-normal"> · {page.title}</span>
            ) : null}
          </h2>
        </div>
        {pageIndex > 0 ? (
          <div className="flex shrink-0 items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-action="move--1"
              aria-label={t("movePageUp")}
              disabled={!canMovePage(definition, pageIndex, -1)}
              onClick={() => move(-1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-action="move-1"
              aria-label={t("movePageDown")}
              disabled={!canMovePage(definition, pageIndex, 1)}
              onClick={() => move(1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("deletePage")}
              disabled={!canDeletePage(pageIndex)}
              onClick={remove}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-5 p-4">
        {pageIndex === 0 ? (
          <p className="text-muted-foreground flex gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("firstPageNote")}
          </p>
        ) : null}
        <div className="grid gap-4">
          <Field>
            <FieldLabel htmlFor={titleId}>
              {t("pageTitle")}
              <span className="text-muted-foreground font-normal">({tc("optional")})</span>
            </FieldLabel>
            <Input
              id={titleId}
              value={page.title}
              maxLength={200}
              aria-invalid={messagesAt(pageProblems, "title").length > 0}
              onChange={(event) =>
                ctx.onChange(updatePage(definition, pageIndex, { title: event.target.value }))
              }
            />
            <FieldProblems messages={messagesAt(pageProblems, "title")} />
          </Field>
          <Field>
            <FieldLabel htmlFor={descriptionId}>
              {t("pageDescription")}
              <span className="text-muted-foreground font-normal">({tc("optional")})</span>
            </FieldLabel>
            <Textarea
              id={descriptionId}
              rows={2}
              value={page.description}
              maxLength={2000}
              aria-invalid={messagesAt(pageProblems, "description").length > 0}
              onChange={(event) =>
                ctx.onChange(updatePage(definition, pageIndex, { description: event.target.value }))
              }
            />
            <FieldProblems messages={messagesAt(pageProblems, "description")} />
          </Field>
        </div>

        {pageIndex > 0 ? (
          <ConditionEditor
            ctx={ctx}
            condition={page.showIf}
            onChange={(showIf) => ctx.onChange(updatePage(definition, pageIndex, { showIf }))}
            available={earlierQuestions(definition, { pageIndex })}
            legend={t("showPage")}
            emptyHint={t("noEarlierPage")}
            problems={pageProblems}
          />
        ) : null}
        <FieldProblems messages={messagesExcept(pageProblems, ["title", "description", "showIf"])} />

        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("tabQuestions")}</h3>
          {page.questions.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
              {t("noQuestions")}
            </p>
          ) : (
            <ol className="space-y-2">
              {page.questions.map((question, questionIndex) => (
                <QuestionCard
                  key={question.id}
                  ctx={ctx}
                  pageId={page.id}
                  questionRef={{ pageIndex, questionIndex }}
                  question={question}
                  open={props.openQuestions.has(question.id)}
                  onOpenChange={(open) => props.onOpenQuestion(question.id, open)}
                  onOpenQuestion={(id) => props.onOpenQuestion(id, true)}
                  problems={props.problems.questions.get(questionKey({ pageIndex, questionIndex }))}
                />
              ))}
            </ol>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" data-action="add-question">
                <Plus aria-hidden />
                {t("addQuestion")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              onCloseAutoFocus={(event) => {
                if (added.current) event.preventDefault();
                added.current = false;
              }}
            >
              {QUESTION_TYPES.map((type) => {
                const Icon = TYPE_ICONS[type];
                return (
                  <DropdownMenuItem
                    key={type}
                    onSelect={() => {
                      const question = createQuestion(definition, type, t("newQuestion"), [
                        t("choiceN", { n: 1 }),
                        t("choiceN", { n: 2 }),
                      ]);
                      added.current = true;
                      ctx.onChange(addQuestion(definition, pageIndex, question));
                      props.onOpenQuestion(question.id, true);
                      refocus(`#label-${question.id}`, undefined, { select: true });
                    }}
                  >
                    <Icon aria-hidden />
                    {t(`type_${type}`)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}
