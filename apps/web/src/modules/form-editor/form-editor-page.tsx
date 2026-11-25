import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { CircleAlert, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { Form } from "@helpdesk/shared/api/form";
import type { FormDefinition } from "@helpdesk/shared/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Page, PageHeader } from "@/components/ui/page";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { ApiError, errorMessage } from "@/lib/api";
import { issueMessage } from "@/lib/validation";
import { formQuery, useCategories, useFormQuery, usePublishForm } from "./api";
import { CategoriesEditor } from "./categories-editor";
import {
  collectProblems,
  dedupeProblems,
  indexProblems,
  normalizeDefinition,
  prepareForSave,
  sameDefinition,
  serverProblems,
  type Problem,
} from "./editor-state";
import { messages } from "./messages";
import type { ConfirmRequest, EditorContext } from "./parts";
import { QuestionsTab } from "./questions-tab";

export type FormEditorTab = "questions" | "categories";

function Header() {
  const t = useT(messages);
  return (
    <PageHeader
      title={t("title")}
      description={t("description")}
      actions={
        <Button variant="outline" asChild className="h-auto min-h-9 whitespace-normal">
          <a href="/requests/new" target="_blank" rel="noopener noreferrer" title={t("openFormHint")}>
            <ExternalLink aria-hidden />
            {t("openForm")}
          </a>
        </Button>
      }
    />
  );
}

/** `/admin/form`: the request form's questions and the categories. */
export function FormEditorPage(props: { tab: FormEditorTab; onTabChange: (tab: FormEditorTab) => void }) {
  const form = useFormQuery();
  if (form.isLoading || form.isError || !form.data) {
    return (
      <Page className="max-w-4xl">
        <Header />
        {form.isLoading ? (
          <LoadingState />
        ) : (
          <ErrorState error={form.error} onRetry={() => void form.refetch()} />
        )}
      </Page>
    );
  }
  return <FormEditor latest={form.data} tab={props.tab} onTabChange={props.onTabChange} />;
}

type Base = { form: Form; definition: FormDefinition };
const loaded = (form: Form): Base => ({ form, definition: normalizeDefinition(form.definition) });

function FormEditor(props: { latest: Form; tab: FormEditorTab; onTabChange: (tab: FormEditorTab) => void }) {
  const t = useT(messages);
  const tc = useT(common);
  const queryClient = useQueryClient();
  const categoryList = useCategories();
  const publish = usePublishForm();
  const { latest } = props;

  /** The published version the draft started from, and the draft. */
  const [base, setBase] = useState(() => loaded(latest));
  const [draft, setDraft] = useState(base.definition);
  /** The last save failed because someone else published meanwhile. */
  const [conflict, setConflict] = useState(false);
  const [saveProblems, setSaveProblems] = useState<Problem[]>([]);
  const [openQuestions, setOpenQuestions] = useState<ReadonlySet<string>>(() => new Set());
  const [confirm, setConfirm] = useState<{ request: ConfirmRequest; open: boolean } | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const [askReload, setAskReload] = useState(false);

  const dirty = !sameDefinition(draft, base.definition);
  const adopt = (form: Form) => {
    const next = loaded(form);
    setBase(next);
    setDraft(next.definition);
    setConflict(false);
    setSaveProblems([]);
  };
  // A newer version arrived (someone else published): take it when nothing is lost.
  if (latest.version > base.form.version && !dirty) adopt(latest);
  const outdated = conflict || latest.version > base.form.version;

  const live = useMemo(() => collectProblems(draft, issueMessage), [draft]);
  const problems = useMemo(() => dedupeProblems([...live, ...saveProblems]), [live, saveProblems]);
  const index = useMemo(() => indexProblems(problems), [problems]);

  const categories = useMemo(
    () => categoryList.data?.items ?? latest.categories.map((category) => ({ ...category, isActive: true })),
    [categoryList.data, latest.categories],
  );
  const ctx: EditorContext = {
    definition: draft,
    onChange: (next) => {
      setDraft(next);
      if (saveProblems.length) setSaveProblems([]);
    },
    askConfirm: (request) => setConfirm({ request, open: true }),
    categories,
    activeCategoryIds: categories.filter((category) => category.isActive).map((category) => category.id),
  };

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname,
    enableBeforeUnload: dirty,
    disabled: !dirty,
    withResolver: true,
  });

  const save = () => {
    if (problems.length > 0 || publish.isPending || outdated) return;
    publish.mutate(
      { baseVersion: base.form.version, definition: prepareForSave(draft) },
      {
        onSuccess: (form) => {
          queryClient.setQueryData(formQuery.queryKey, form);
          adopt(form);
          toast.success(t("published", { version: form.version }));
        },
        onError: (error) => {
          if (error instanceof ApiError && (error.code === "form_changed" || error.status === 409)) {
            setConflict(true);
            void queryClient.invalidateQueries({ queryKey: formQuery.queryKey });
            return;
          }
          if (error instanceof ApiError && error.fields) setSaveProblems(serverProblems(error.fields));
          toast.error(errorMessage(error));
        },
      },
    );
  };

  const reload = async () => {
    try {
      adopt(await queryClient.fetchQuery({ ...formQuery, staleTime: 0 }));
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  };

  const setOpen = (id: string, open: boolean) =>
    setOpenQuestions((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Page className="max-w-4xl">
      <Header />
      <Tabs
        value={props.tab}
        onValueChange={(tab) => props.onTabChange(tab === "categories" ? "categories" : "questions")}
      >
        <TabsList>
          <TabsTrigger value="questions">
            {t("tabQuestions")}
            {problems.length > 0 ? (
              <Badge variant="destructive" className="h-5 min-w-5 px-1.5 tabular-nums">
                <span className="sr-only">{t("problems", { count: problems.length })}</span>
                <span aria-hidden>{problems.length}</span>
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="categories">{t("tabCategories")}</TabsTrigger>
        </TabsList>
        <TabsContent value="questions" className="mt-4">
          <QuestionsTab
            ctx={ctx}
            form={base.form}
            problems={problems}
            index={index}
            openQuestions={openQuestions}
            onOpenQuestion={setOpen}
          />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoriesEditor />
        </TabsContent>
      </Tabs>

      {dirty ? (
        <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-3 z-20 space-y-3 rounded-xl border p-3 shadow-lg backdrop-blur sm:px-4">
          {outdated ? (
            <Alert variant="destructive" role="status" className="border-destructive/40">
              <CircleAlert aria-hidden />
              <AlertTitle>{t("conflictTitle")}</AlertTitle>
              <AlertDescription>
                {latest.version > base.form.version
                  ? t("conflictText", { version: latest.version })
                  : t("conflictTextUnknown")}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 text-sm" aria-live="polite">
              <p className="font-medium">{t("unsaved")}</p>
              {problems.length > 0 ? (
                <p className="text-destructive">{t("fixToSave", { count: problems.length })}</p>
              ) : null}
            </div>
            <Button type="button" variant="ghost" onClick={() => setAskDiscard(true)}>
              {t("discard")}
            </Button>
            {outdated ? (
              <Button type="button" onClick={() => setAskReload(true)}>
                {t("reload")}
              </Button>
            ) : (
              <Button type="button" disabled={problems.length > 0 || publish.isPending} onClick={save}>
                {publish.isPending ? <Spinner /> : null}
                {tc("save")}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm?.open ?? false}
        onOpenChange={(open) => setConfirm((current) => current && { ...current, open })}
        title={confirm?.request.title ?? ""}
        description={confirm?.request.description}
        confirmLabel={confirm?.request.confirmLabel}
        destructive
        onConfirm={() => confirm?.request.onConfirm()}
      >
        {confirm?.request.details}
      </ConfirmDialog>
      <ConfirmDialog
        open={askDiscard}
        onOpenChange={setAskDiscard}
        title={t("discardTitle")}
        description={t("discardText", { version: base.form.version })}
        confirmLabel={t("discard")}
        destructive
        onConfirm={() => {
          setDraft(base.definition);
          setSaveProblems([]);
        }}
      />
      <ConfirmDialog
        open={askReload}
        onOpenChange={setAskReload}
        title={t("reloadTitle")}
        description={t("reloadText")}
        confirmLabel={t("reload")}
        destructive
        onConfirm={reload}
      />
      <ConfirmDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title={t("leaveTitle")}
        description={t("leaveText")}
        confirmLabel={t("leave")}
        destructive
        onConfirm={() => blocker.proceed?.()}
      />
    </Page>
  );
}
