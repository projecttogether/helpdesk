import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import type { Answer, Attachment, Message, RequestDetail } from "@helpdesk/shared/api/tickets";
import { AttachmentList, AttachmentPicker } from "@/components/attachments";
import { Page, PageHeader } from "@/components/ui/page";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge, UrgencyBadge } from "@/components/ticket-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { initials } from "@/modules/tickets/display";
import { useMe } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import { useFormatter } from "@/lib/format";
import { queryClient } from "@/lib/query";
import { cn } from "@/components/ui/utils";
import { useT } from "@/i18n";
import { requestQuery } from "./api";
import { messages } from "./messages";

/** The answers of a request as it was asked. */
export function AnswerList({ answers, yes }: { answers: Answer[]; yes: string }) {
  return (
    <dl className="grid gap-4">
      {answers.map((answer) => (
        <div key={answer.questionId} className="grid gap-1">
          <dt className="text-muted-foreground text-sm">{answer.label}</dt>
          <dd className="text-sm break-words whitespace-pre-wrap">
            {answer.type === "file" ? (
              <AttachmentList attachments={answer.attachments} />
            ) : answer.type === "checkbox" ? (
              yes
            ) : (
              answer.display.join(", ")
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MessageItem({ message, mine }: { message: Message; mine: boolean }) {
  const t = useT(messages);
  const format = useFormatter();
  const author = mine ? t("you") : (message.author?.name ?? "—");
  return (
    <li className={cn("flex gap-3", mine && "flex-row-reverse")}>
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
          mine ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
        aria-hidden
      >
        {initials(message.author?.name ?? "?")}
      </div>
      <div className={cn("grid max-w-[85%] gap-1", mine && "justify-items-end")}>
        <div className="text-muted-foreground flex gap-2 text-xs">
          <span className="text-foreground font-medium">{author}</span>
          <time dateTime={message.createdAt} title={format.dateTime(message.createdAt)}>
            {format.relative(message.createdAt)}
          </time>
        </div>
        {message.body ? (
          <div
            className={cn(
              "rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap",
              mine ? "bg-primary/10" : "bg-muted",
            )}
          >
            {message.body}
          </div>
        ) : null}
        <AttachmentList attachments={message.attachments} />
      </div>
    </li>
  );
}

function ReplyBox({ request }: { request: RequestDetail }) {
  const t = useT(messages);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const reply = useMutation({
    mutationFn: () =>
      api.post<RequestDetail>(`/requests/${request.number}/messages`, {
        body,
        attachmentIds: files.map((file) => file.id),
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(requestQuery(request.number).queryKey, detail);
      void queryClient.invalidateQueries({ queryKey: ["requests"] });
      setBody("");
      setFiles([]);
      toast.success(t("replied"));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const empty = body.trim() === "" && files.length === 0;
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty) reply.mutate();
      }}
    >
      {request.replyReopens ? (
        <Alert>
          <RotateCcw />
          <AlertDescription>{t("replyReopens")}</AlertDescription>
        </Alert>
      ) : null}
      <Label htmlFor="reply" className="sr-only">
        {t("reply")}
      </Label>
      <Textarea
        id="reply"
        rows={4}
        value={body}
        maxLength={10_000}
        placeholder={t("replyPlaceholder")}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <AttachmentPicker value={files} onChange={setFiles} onBusyChange={setUploading} />
        <Button type="submit" disabled={empty || uploading || reply.isPending}>
          {reply.isPending ? <Spinner /> : <Send />}
          {t("reply")}
        </Button>
      </div>
    </form>
  );
}

export function RequestPage({ number }: { number: number }) {
  const t = useT(messages);
  const format = useFormatter();
  const me = useMe();
  const request = useQuery(requestQuery(number));

  if (request.isPending) return <LoadingState />;
  if (request.isError) {
    return (
      <Page>
        <ErrorState error={request.error} onRetry={() => void request.refetch()} />
      </Page>
    );
  }
  const detail = request.data;
  return (
    <Page className="max-w-4xl">
      <PageHeader
        title={
          <>
            <span className="text-muted-foreground mr-2 font-normal tabular-nums">#{detail.number}</span>
            {detail.title}
          </>
        }
        actions={<StatusBadge status={detail.status} className="text-sm" />}
      />
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{t("category")}</dt>
          <dd>{detail.category ?? "—"}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{t("urgency")}</dt>
          <dd>
            <UrgencyBadge urgency={detail.urgency} />
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{t("handledBy")}</dt>
          <dd>{detail.assigneeName ?? <span className="text-muted-foreground">{t("nobodyYet")}</span>}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{t("created")}</dt>
          <dd title={format.dateTime(detail.createdAt)}>{format.relative(detail.createdAt)}</dd>
        </div>
      </dl>

      {detail.answers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("yourAnswers")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AnswerList answers={detail.answers} yes={t("yes")} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("conversation")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          {detail.messages.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noMessages")}</p>
          ) : (
            <ol className="grid gap-4">
              {detail.messages.map((message) => (
                <MessageItem key={message.id} message={message} mine={message.author?.id === me.id} />
              ))}
            </ol>
          )}
          {detail.canReply ? (
            <ReplyBox request={detail} />
          ) : (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                {t("closedText")}
                <Button asChild size="sm" variant="outline">
                  <Link to="/requests/new">{t("newRequest")}</Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
