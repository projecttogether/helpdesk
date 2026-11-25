import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Attachment, StaffTicketCreate } from "@helpdesk/shared/api/tickets";
import { URGENCIES, urgencySchema, type Urgency } from "@helpdesk/shared/tickets";
import { AttachmentPicker } from "@/components/attachments";
import { Page, PageHeader } from "@/components/ui/page";
import { PersonPicker, type PickedPerson } from "@/components/person-picker";
import { UrgencyBadge } from "@/components/ticket-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useUrgencyLabel } from "@/lib/labels";
import { applyServerErrors, useSchemaResolver } from "@/lib/validation";
import { categoriesQuery, ticketKeys } from "./api";
import { messages } from "./messages";

type Values = {
  requester: PickedPerson | null;
  title: string;
  categoryId: string;
  urgency: Urgency;
  description: string;
  assignee: PickedPerson | null;
  attachments: Attachment[];
};

const SERVER_FIELDS = {
  requesterId: "requester",
  assigneeId: "assignee",
  attachmentIds: "attachments",
} as const;

/** Staff record a request for someone, e.g. after a phone call. */
export function NewTicketPage() {
  const t = useT(messages);
  const tc = useT(common);
  const urgencyLabel = useUrgencyLabel();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useQuery(categoriesQuery);
  // One key per visit: sending twice (double click, retry) creates one ticket.
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [uploading, setUploading] = useState(false);

  const schema = useMemo(
    () =>
      z.object({
        requester: z.custom<PickedPerson | null>().refine((value) => value !== null, t("chooseRequester")),
        title: z.string().trim().min(1, t("enterTitle")).max(120),
        categoryId: z.string().min(1, t("chooseCategory")),
        urgency: urgencySchema,
        description: z.string().trim().max(10_000),
        assignee: z.custom<PickedPerson | null>(),
        attachments: z.custom<Attachment[]>(),
      }),
    [t],
  );
  const resolver = useSchemaResolver<Values, Values>(schema);
  const form = useForm<Values, unknown, Values>({
    resolver,
    defaultValues: {
      requester: null,
      title: "",
      categoryId: "",
      urgency: "normal",
      description: "",
      assignee: null,
      attachments: [],
    },
  });
  const errors = form.formState.errors;

  const create = useMutation({
    mutationFn: (body: StaffTicketCreate) => api.post<{ number: number }>("/tickets", body),
  });

  const submit = form.handleSubmit(async (values) => {
    if (!values.requester) return;
    try {
      const { number } = await create.mutateAsync({
        requesterId: values.requester.id,
        title: values.title.trim(),
        categoryId: values.categoryId,
        urgency: values.urgency,
        description: values.description.trim(),
        assigneeId: values.assignee?.id ?? null,
        attachmentIds: values.attachments.map((file) => file.id),
        submissionKey,
      });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.boards });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
      toast.success(t("createdToast", { number }));
      void navigate({ to: "/tickets/$number", params: { number: String(number) } });
    } catch (error) {
      const unmatched = applyServerErrors(form, error, SERVER_FIELDS);
      if (!(error instanceof ApiError && error.fields)) toast.error(errorMessage(error));
      else if (unmatched.length > 0) toast.error(unmatched.join(" "));
    }
  });

  const active = (categories.data?.items ?? []).filter((category) => category.isActive);
  const chosen = active.find((category) => category.id === form.watch("categoryId"));
  const defaultAssignee = chosen?.defaultAssigneeName ?? null;
  const busy = form.formState.isSubmitting || create.isPending;

  return (
    <Page className="max-w-3xl">
      <PageHeader title={t("newTitle")} description={t("newDescription")} />
      <Card>
        <CardContent>
          <form onSubmit={(event) => void submit(event)} noValidate>
            <FieldGroup className="gap-6">
              <Field data-invalid={Boolean(errors.requester) || undefined}>
                <FieldLabel htmlFor="new-requester">{t("requester")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="requester"
                  render={({ field }) => (
                    <PersonPicker
                      id="new-requester"
                      scope="all"
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t("chooseRequester")}
                      aria-invalid={Boolean(errors.requester)}
                      disabled={busy}
                    />
                  )}
                />
                <FieldDescription>{t("requesterHint")}</FieldDescription>
                <FieldError errors={[errors.requester]} />
              </Field>

              <Field data-invalid={Boolean(errors.title) || undefined}>
                <FieldLabel htmlFor="new-title">{t("colTitle")}</FieldLabel>
                <Input
                  id="new-title"
                  maxLength={120}
                  autoComplete="off"
                  aria-invalid={Boolean(errors.title)}
                  disabled={busy}
                  {...form.register("title")}
                />
                <FieldError errors={[errors.title]} />
              </Field>

              <div className="grid gap-6 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.categoryId) || undefined}>
                  <FieldLabel htmlFor="new-category">{t("category")}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                        <SelectTrigger
                          id="new-category"
                          className="w-full"
                          aria-invalid={Boolean(errors.categoryId)}
                          onBlur={field.onBlur}
                        >
                          <SelectValue
                            placeholder={categories.isLoading ? tc("loading") : t("chooseCategory")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {active.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.categoryId]} />
                </Field>

                <Field data-invalid={Boolean(errors.urgency) || undefined}>
                  <FieldLabel htmlFor="new-urgency">{t("urgency")}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="urgency"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                        <SelectTrigger id="new-urgency" className="w-full" onBlur={field.onBlur}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {URGENCIES.map((urgency) => (
                            <SelectItem key={urgency} value={urgency}>
                              <span aria-hidden>
                                <UrgencyBadge urgency={urgency} compact />
                              </span>
                              {urgencyLabel(urgency)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.urgency]} />
                </Field>
              </div>

              <Field data-invalid={Boolean(errors.description) || undefined}>
                <FieldLabel htmlFor="new-description">
                  {t("description")}
                  <span className="text-muted-foreground font-normal">({tc("optional")})</span>
                </FieldLabel>
                <Textarea
                  id="new-description"
                  rows={6}
                  className="min-h-32"
                  maxLength={10_000}
                  placeholder={t("descriptionPlaceholder")}
                  aria-invalid={Boolean(errors.description)}
                  disabled={busy}
                  {...form.register("description")}
                />
                <FieldError errors={[errors.description]} />
              </Field>

              <Field data-invalid={Boolean(errors.assignee) || undefined}>
                <FieldLabel htmlFor="new-assignee">
                  {t("assignee")}
                  <span className="text-muted-foreground font-normal">({tc("optional")})</span>
                </FieldLabel>
                <Controller
                  control={form.control}
                  name="assignee"
                  render={({ field }) => (
                    <PersonPicker
                      id="new-assignee"
                      scope="staff"
                      allowNone
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={
                        defaultAssignee ? t("defaultAssignee", { name: defaultAssignee }) : undefined
                      }
                      aria-invalid={Boolean(errors.assignee)}
                      disabled={busy}
                    />
                  )}
                />
                <FieldDescription>{t("assigneeHint")}</FieldDescription>
                <FieldError errors={[errors.assignee]} />
              </Field>

              <Field data-invalid={Boolean(errors.attachments) || undefined}>
                <FieldLabel htmlFor="new-files">
                  {t("files")}
                  <span className="text-muted-foreground font-normal">({tc("optional")})</span>
                </FieldLabel>
                <Controller
                  control={form.control}
                  name="attachments"
                  render={({ field }) => (
                    <AttachmentPicker
                      id="new-files"
                      value={field.value}
                      onChange={field.onChange}
                      onBusyChange={setUploading}
                      disabled={busy}
                    />
                  )}
                />
                <FieldError errors={[errors.attachments]} />
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={busy || uploading}>
                  {busy ? <Spinner /> : null}
                  {t("createTicket")}
                </Button>
                <Button type="button" variant="ghost" asChild>
                  <Link to="/board">{tc("cancel")}</Link>
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </Page>
  );
}
