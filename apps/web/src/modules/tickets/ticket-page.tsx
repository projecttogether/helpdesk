import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, FileQuestion, Pencil } from "lucide-react";
import type { TicketDetail } from "@helpdesk/shared/api/tickets";
import { Page } from "@/components/ui/page";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ticket-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { ApiError } from "@/lib/api";
import { ticketQuery, usePendingChange, useUpdateTicket, withChange, type TicketChange } from "./api";
import { Answers } from "./answers";
import { Composer } from "./composer";
import { IdentityRequests } from "./identity";
import { messages } from "./messages";
import { TicketPanel } from "./ticket-panel";
import { Timeline } from "./timeline-view";
import { personName } from "./timeline";

/** The staff page of one ticket. */
export function TicketPage({ number }: { number: number }) {
  const t = useT(messages);
  const valid = Number.isInteger(number) && number > 0;
  const ticket = useQuery({ ...ticketQuery(number), enabled: valid });

  // Background refreshes keep the shown ticket (and the draft) even when they fail.
  if (!ticket.data) {
    const missing = !valid || (ticket.error instanceof ApiError && ticket.error.status === 404);
    return (
      <Page>
        {valid && ticket.isPending ? (
          <LoadingState />
        ) : missing ? (
          <EmptyState
            icon={<FileQuestion />}
            title={t("notFound")}
            description={t("notFoundHint")}
            action={
              <Button variant="outline" asChild>
                <Link to="/board">{t("backToBoard")}</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={ticket.error} onRetry={() => void ticket.refetch()} />
        )}
      </Page>
    );
  }
  return <TicketView ticket={ticket.data} />;
}

function TicketView({ ticket: saved }: { ticket: TicketDetail }) {
  const t = useT(messages);
  const headingId = useId();
  const update = useUpdateTicket();
  const ticket = withChange(saved, usePendingChange(saved.number));
  const change = (next: TicketChange) =>
    update.mutate({ number: saved.number, revision: saved.revision, change: next });

  return (
    <Page>
      <div className="grid gap-3">
        <Link
          to="/board"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 rounded-sm text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("backToBoard")}
        </Link>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <TitleEditor number={ticket.number} title={ticket.title} onSave={(title) => change({ title })} />
          <StatusBadge status={ticket.status} className="mt-2" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <aside
          aria-label={t("details")}
          className="lg:sticky lg:top-18 lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto"
        >
          <TicketPanel ticket={ticket} onChange={change} />
        </aside>

        <div className="grid min-w-0 gap-6 lg:col-start-1 lg:row-start-1">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t("request")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Answers answers={ticket.answers} />
            </CardContent>
          </Card>

          <IdentityRequests ticket={ticket} />

          <section aria-labelledby={headingId} className="grid gap-4">
            <h2 id={headingId} className="text-base font-semibold">
              {t("activity")}
            </h2>
            <Timeline messages={ticket.messages} events={ticket.events} />
            <Composer
              key={ticket.number}
              number={ticket.number}
              requesterName={personName(ticket.requester)}
            />
          </section>
        </div>
      </div>
    </Page>
  );
}

/** "#12 Title": the title turns into a field on click, saved with Enter or Save. */
function TitleEditor(props: { number: number; title: string; onSave: (title: string) => void }) {
  const t = useT(messages);
  const tc = useT(common);
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const start = () => {
    setDraft(props.title);
    setEditing(true);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    if (title !== props.title) props.onSave(title);
    setEditing(false);
  };

  if (editing) {
    return (
      <form onSubmit={save} className="flex min-w-0 flex-1 basis-80 flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          {t("colTitle")}
        </label>
        <Input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
          maxLength={120}
          autoFocus
          aria-invalid={draft.trim() === "" || undefined}
          className="h-10 min-w-0 flex-1 basis-64 text-lg font-semibold md:text-lg"
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={draft.trim() === ""}>
            {tc("save")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            {tc("cancel")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="group flex min-w-0 flex-1 basis-80 items-start gap-1">
      <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">
        <span className="text-muted-foreground mr-2 font-normal tabular-nums">#{props.number}</span>
        <span onClick={start} className="cursor-text">
          {props.title}
        </span>
      </h1>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground mt-0.5 shrink-0 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={t("editTitle")}
        title={t("editTitle")}
        onClick={start}
      >
        <Pencil />
      </Button>
    </div>
  );
}
