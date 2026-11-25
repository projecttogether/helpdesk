import { useEffect, useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import type { IdentityOptions, IdentityRequest, IdentityRequestInput } from "@helpdesk/shared/api/identity";
import type { Answer, TicketDetail } from "@helpdesk/shared/api/tickets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-me";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { ApiError, api, errorMessage } from "@/lib/api";
import { ticketKeys } from "./api";
import { messages } from "./messages";

/** The dialog's values: text, IDs as strings. */
export type IdentityValues = {
  firstName: string;
  lastName: string;
  personalEmail: string;
  jobTitle: string;
  personType: string;
  teamId: string;
  managerEmail: string;
  startDate: string;
  endDate: string;
  notes: string;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The dialog's first values: the ticket's answers to the questions the IAM settings map. */
export function valuesFromAnswers(answers: Answer[], options: IdentityOptions): IdentityValues {
  const answer = (questionId: string | null) =>
    questionId ? answers.find((item) => item.questionId === questionId) : undefined;
  const text = (questionId: string | null) => answer(questionId)?.display.join(", ") ?? "";
  const date = (questionId: string | null) => {
    const value = answer(questionId)?.display[0] ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  };
  const { mapping } = options;
  const typeAnswer = text(mapping.personType);
  const teamAnswer = text(mapping.team);
  return {
    firstName: text(mapping.firstName),
    lastName: text(mapping.lastName),
    personalEmail: text(mapping.personalEmail),
    jobTitle: text(mapping.jobTitle),
    personType:
      options.personTypes.find((type) => same(type.label, typeAnswer) || same(type.value, typeAnswer))
        ?.value ?? "",
    teamId: String(options.teams.find((team) => same(team.name, teamAnswer))?.id ?? ""),
    managerEmail: text(mapping.managerEmail),
    startDate: date(mapping.startDate),
    endDate: date(mapping.endDate),
    notes: text(mapping.notes),
  };
}

/**
 * Answers of a send that end its key for good: IAM refused the details, or
 * the key belongs to another ticket. Anything else (Helpdesk's own checks,
 * IAM not set up, a lost answer) keeps the key, so a saved request is never
 * sent again under a second reference.
 */
const REFUSED = new Set(["iam_refused", "duplicate_submission"]);

const optionsQuery = {
  queryKey: ["identity-options"] as const,
  queryFn: () => api.get<IdentityOptions>("/identity/options"),
  staleTime: 5 * 60_000,
  retry: false,
};

function RequestDialog(props: {
  ticket: TicketDetail;
  submissionKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
  onRefused: () => void;
}) {
  const t = useT(messages);
  const tc = useT(common);
  const options = useQuery({ ...optionsQuery, enabled: props.open });
  // The dialog stays open while a send runs: one send at a time, and its answer lands here.
  const [sending, setSending] = useState(false);
  const change = (open: boolean) => {
    if (!open && sending) return;
    props.onOpenChange(open);
  };
  return (
    <Dialog open={props.open} onOpenChange={change}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("identityDialogTitle")}</DialogTitle>
          <DialogDescription>{t("identityDialogDescription")}</DialogDescription>
        </DialogHeader>
        {/* Once loaded, the form stays: a failed refetch in the background must not take it away. */}
        {!options.data ? (
          options.isError ? (
            <ErrorState error={options.error} onRetry={() => void options.refetch()} />
          ) : (
            <LoadingState />
          )
        ) : options.data.personTypes.length === 0 ? (
          <>
            <p className="text-sm">{t("identityNoTypes")}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => props.onOpenChange(false)}>
                {tc("cancel")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <RequestForm
            ticket={props.ticket}
            options={options.data}
            submissionKey={props.submissionKey}
            onCancel={() => props.onOpenChange(false)}
            onSent={props.onSent}
            onRefused={props.onRefused}
            onSendingChange={setSending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RequestForm(props: {
  ticket: TicketDetail;
  options: IdentityOptions;
  submissionKey: string;
  onCancel: () => void;
  onSent: () => void;
  onRefused: () => void;
  onSendingChange: (sending: boolean) => void;
}) {
  const t = useT(messages);
  const tc = useT(common);
  const id = useId();
  const client = useQueryClient();
  const [values, setValues] = useState(() => valuesFromAnswers(props.ticket.answers, props.options));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: (input: IdentityRequestInput) =>
      api.post<TicketDetail>(`/tickets/${props.ticket.number}/identity-requests`, input),
    onSuccess: (ticket, input) => {
      client.setQueryData(ticketKeys.detail(ticket.number), ticket);
      // Saved, but IAM did not answer clearly: the card shows it, and the helpdesk goes on trying.
      const sent = ticket.identityRequests.find((request) => request.id === input.submissionKey);
      if (sent?.status === "sending") toast.warning(t("identityUnconfirmedToast"));
      else toast.success(t("identitySent"));
      props.onSent();
    },
    onError: (error) => {
      setErrors(error instanceof ApiError && error.fields ? error.fields : {});
      toast.error(errorMessage(error));
      // Refused for good (or the key belongs to another ticket): corrected
      // details go as a new request. Any other error keeps the key, so a
      // saved request is never sent twice under two references.
      if (error instanceof ApiError && REFUSED.has(error.code)) props.onRefused();
    },
  });
  const { onSendingChange } = props;
  useEffect(() => onSendingChange(send.isPending), [onSendingChange, send.isPending]);
  // A form that goes away no longer holds the dialog open.
  useEffect(() => () => onSendingChange(false), [onSendingChange]);
  const set = (key: keyof IdentityValues) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate({
      firstName: values.firstName,
      lastName: values.lastName,
      personalEmail: values.personalEmail,
      jobTitle: values.jobTitle,
      personType: values.personType,
      teamId: values.teamId ? Number(values.teamId) : null,
      managerEmail: values.managerEmail,
      startDate: values.startDate || null,
      endDate: values.endDate || null,
      notes: values.notes,
      submissionKey: props.submissionKey,
    });
  };
  const text = (key: keyof IdentityValues, label: string, extra: { type?: string; hint?: string } = {}) => (
    <Field data-invalid={errors[key] ? true : undefined}>
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${key}`}
        type={extra.type ?? "text"}
        autoComplete="off"
        value={values[key]}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={extra.hint ? `${id}-${key}-hint` : undefined}
        onChange={(event) => set(key)(event.target.value)}
      />
      {extra.hint ? <FieldDescription id={`${id}-${key}-hint`}>{extra.hint}</FieldDescription> : null}
      {errors[key] ? <FieldError>{errors[key]}</FieldError> : null}
    </Field>
  );
  return (
    <form noValidate onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {text("firstName", t("identityFirstName"))}
        {text("lastName", t("identityLastName"))}
        {text("personalEmail", t("identityPersonalEmail"), {
          type: "email",
          hint: t("identityPersonalEmailHint"),
        })}
        {text("jobTitle", t("identityJobTitle"))}
        <Field data-invalid={errors.personType ? true : undefined}>
          <FieldLabel htmlFor={`${id}-personType`}>{t("identityPersonType")}</FieldLabel>
          <NativeSelect
            id={`${id}-personType`}
            className="w-full"
            value={values.personType}
            aria-invalid={errors.personType ? true : undefined}
            onChange={(event) => set("personType")(event.target.value)}
          >
            <NativeSelectOption value="">{t("identityChooseType")}</NativeSelectOption>
            {props.options.personTypes.map((type) => (
              <NativeSelectOption key={type.value} value={type.value}>
                {type.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {errors.personType ? <FieldError>{errors.personType}</FieldError> : null}
        </Field>
        <Field data-invalid={errors.teamId ? true : undefined}>
          <FieldLabel htmlFor={`${id}-teamId`}>{t("identityTeam")}</FieldLabel>
          <NativeSelect
            id={`${id}-teamId`}
            className="w-full"
            value={values.teamId}
            onChange={(event) => set("teamId")(event.target.value)}
          >
            <NativeSelectOption value="">{t("identityNoTeam")}</NativeSelectOption>
            {props.options.teams.map((team) => (
              <NativeSelectOption key={team.id} value={String(team.id)}>
                {team.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {errors.teamId ? <FieldError>{errors.teamId}</FieldError> : null}
        </Field>
        {text("managerEmail", t("identityManagerEmail"), { type: "email" })}
        <div className="hidden sm:block" />
        {text("startDate", t("identityStartDate"), { type: "date" })}
        {text("endDate", t("identityEndDate"), { type: "date" })}
      </div>
      <Field data-invalid={errors.notes ? true : undefined}>
        <FieldLabel htmlFor={`${id}-notes`}>{t("identityNotes")}</FieldLabel>
        <Textarea
          id={`${id}-notes`}
          rows={3}
          maxLength={5000}
          value={values.notes}
          onChange={(event) => set("notes")(event.target.value)}
        />
        {errors.notes ? <FieldError>{errors.notes}</FieldError> : null}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={send.isPending} onClick={props.onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={send.isPending}>
          {send.isPending ? <Spinner /> : null}
          {t("identitySend")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RequestItem({ number, request }: { number: number; request: IdentityRequest }) {
  const t = useT(messages);
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const resend = useMutation({
    mutationFn: () => api.post<TicketDetail>(`/tickets/${number}/identity-requests/${request.id}/send`),
    onSuccess: (ticket) => {
      client.setQueryData(ticketKeys.detail(number), ticket);
      const now = ticket.identityRequests.find((item) => item.id === request.id);
      if (now?.status === "sending") toast.warning(t("identityStillUnconfirmed"));
      else if (now?.status === "refused") toast.error(t("identityRefusedToast"));
      else toast.success(t("identitySent"));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const cancel = async () => {
    try {
      const ticket = await api.post<TicketDetail>(
        `/tickets/${number}/identity-requests/${request.id}/cancel`,
      );
      client.setQueryData(ticketKeys.detail(number), ticket);
      toast.success(t("identityCancelled"));
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  };
  return (
    <li className="grid gap-1 border-b pb-3 text-sm last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{request.name}</span>
        <Badge
          variant={
            request.status === "rejected" || request.status === "refused"
              ? "destructive"
              : request.status === "sending"
                ? "outline"
                : "secondary"
          }
        >
          {t(`identity_${request.status}`)}
        </Badge>
      </div>
      {request.status === "sending" ? (
        <>
          <p className="text-muted-foreground">{t("identityUnconfirmedHint")}</p>
          {request.lastError ? <p>{t("identityLastError", { error: request.lastError })}</p> : null}
        </>
      ) : null}
      {request.personStatus ? (
        <p className="text-muted-foreground">{t("identityPerson", { status: request.personStatus })}</p>
      ) : null}
      {request.workEmail ? (
        <p className="text-muted-foreground">{t("identityWorkEmail", { email: request.workEmail })}</p>
      ) : null}
      {request.reason ? <p>{t("identityReason", { reason: request.reason })}</p> : null}
      {request.sentBy ? (
        <p className="text-muted-foreground">{t("identitySentBy", { name: request.sentBy })}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {request.url ? (
          <Button variant="link" size="sm" className="h-auto px-0" asChild>
            <a href={request.url} target="_blank" rel="noreferrer noopener">
              {t("identityOpenInIam")}
              <ExternalLink aria-hidden />
            </a>
          </Button>
        ) : null}
        {request.status === "sending" ? (
          <Button variant="outline" size="sm" disabled={resend.isPending} onClick={() => resend.mutate()}>
            {resend.isPending ? <Spinner /> : null}
            {t("identitySendAgain")}
          </Button>
        ) : null}
        {request.status === "open" ? (
          <Button
            variant="link"
            size="sm"
            className="text-destructive h-auto px-0"
            onClick={() => setConfirming(true)}
          >
            {t("identityCancel")}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("identityCancelTitle", { name: request.name })}
        description={t("identityCancelDescription")}
        confirmLabel={t("identityCancel")}
        destructive
        onConfirm={cancel}
      />
    </li>
  );
}

/** Requests to IAM from this ticket, and the button to send one. Shown once IAM is set up. */
export function IdentityRequests({ ticket }: { ticket: TicketDetail }) {
  const t = useT(messages);
  const me = useMe();
  const [open, setOpen] = useState(false);
  // Kept until a send is saved: a send that was closed or failed without an
  // answer, and is sent again, stays one request in IAM. A refusal starts a
  // new one, for the corrected details.
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());
  if (!me.identityRequests && ticket.identityRequests.length === 0) return null;
  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1.5">
          <CardTitle>
            <h2>{t("identityTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("identityDescription")}</CardDescription>
        </div>
        {me.identityRequests ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <UserRoundPlus />
            {t("requestIdentity")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {ticket.identityRequests.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("identityNone")}</p>
        ) : (
          <ul className="grid gap-3">
            {ticket.identityRequests.map((request) => (
              <RequestItem key={request.id} number={ticket.number} request={request} />
            ))}
          </ul>
        )}
      </CardContent>
      {open ? (
        <RequestDialog
          ticket={ticket}
          submissionKey={submissionKey}
          open={open}
          onOpenChange={setOpen}
          onSent={() => {
            setOpen(false);
            setSubmissionKey(crypto.randomUUID());
          }}
          onRefused={() => setSubmissionKey(crypto.randomUUID())}
        />
      ) : null}
    </Card>
  );
}
