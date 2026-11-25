import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Lock, MessageSquareReply, Send } from "lucide-react";
import { z } from "zod";
import { attachmentSchema, type Attachment } from "@helpdesk/shared/api/tickets";
import { AttachmentPicker } from "@/components/attachments";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { cn } from "@/components/ui/utils";
import { useSendMessage } from "./api";
import { messages } from "./messages";

type Visibility = "public" | "internal";
type Draft = { body: string; visibility: Visibility; files: Attachment[] };

const EMPTY: Draft = { body: "", visibility: "public", files: [] };
const draftSchema = z.object({
  body: z.string(),
  visibility: z.enum(["public", "internal"]),
  files: z.array(attachmentSchema),
});

const storageKey = (number: number) => `helpdesk.ticket-draft.${number}`;

function readDraft(number: number): Draft {
  try {
    const raw = window.sessionStorage.getItem(storageKey(number));
    const parsed = draftSchema.safeParse(raw ? JSON.parse(raw) : null);
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeDraft(number: number, draft: Draft) {
  try {
    if (draft.body === "" && draft.files.length === 0 && draft.visibility === "public") {
      window.sessionStorage.removeItem(storageKey(number));
    } else {
      window.sessionStorage.setItem(storageKey(number), JSON.stringify(draft));
    }
  } catch {
    // Storage may be full or blocked; the draft still lives in this page.
  }
}

/**
 * The draft of a reply or note: it lives in the page (refreshes of the
 * ticket don't touch it) and in the tab's session storage (a reload keeps it).
 */
function useDraft(number: number) {
  const [draft, setDraft] = useState<Draft>(() => readDraft(number));
  const update = (patch: Partial<Draft>) =>
    setDraft((current) => {
      const next = { ...current, ...patch };
      writeDraft(number, next);
      return next;
    });
  return [draft, update] as const;
}

/** Writes a reply to the requester or an internal note. Mount with `key={number}`. */
export function Composer({ number, requesterName }: { number: number; requesterName: string | null }) {
  const t = useT(messages);
  const id = useId();
  const [draft, update] = useDraft(number);
  const [uploading, setUploading] = useState(false);
  const send = useSendMessage(number);
  const internal = draft.visibility === "internal";
  const empty = draft.body.trim() === "" && draft.files.length === 0;
  const disabled = empty || uploading || send.isPending;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (disabled) return;
    send.mutate(
      {
        body: draft.body.trim(),
        visibility: draft.visibility,
        attachmentIds: draft.files.map((file) => file.id),
      },
      {
        onSuccess: () => {
          update({ body: "", files: [] });
          toast.success(internal ? t("noteSaved") : t("replySent"));
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
  };

  return (
    <form
      onSubmit={submit}
      aria-label={internal ? t("internalNote") : t("replyToRequester")}
      className={cn(
        "rounded-lg border p-3 shadow-xs transition-colors sm:p-4",
        internal ? "border-amber-500/40 bg-amber-500/10 dark:bg-amber-400/10" : "bg-card",
      )}
    >
      <Tabs value={draft.visibility} onValueChange={(value) => update({ visibility: value as Visibility })}>
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="public">
            <MessageSquareReply aria-hidden />
            {t("replyToRequester")}
          </TabsTrigger>
          <TabsTrigger
            value="internal"
            className="data-[state=active]:bg-amber-100 data-[state=active]:text-amber-900 dark:data-[state=active]:border-amber-500/40 dark:data-[state=active]:bg-amber-500/20 dark:data-[state=active]:text-amber-200"
          >
            <Lock aria-hidden />
            {t("internalNote")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Textarea
        id={`${id}-body`}
        value={draft.body}
        onChange={(event) => update({ body: event.target.value })}
        onKeyDown={onKeyDown}
        maxLength={10_000}
        rows={4}
        aria-label={internal ? t("internalNote") : t("replyToRequester")}
        aria-describedby={`${id}-hint`}
        placeholder={
          internal
            ? t("notePlaceholder")
            : requesterName
              ? t("replyPlaceholder", { name: requesterName })
              : t("replyPlaceholderAnonymous")
        }
        className="bg-background mt-3 min-h-28 dark:bg-transparent"
      />
      <p id={`${id}-hint`} className="text-muted-foreground mt-2 text-xs">
        {internal ? t("noteHint") : t("replyHint")}
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <AttachmentPicker
          value={draft.files}
          onChange={(files) => update({ files })}
          onBusyChange={setUploading}
          disabled={send.isPending}
        />
        <Button
          type="submit"
          disabled={disabled}
          title={t("sendShortcut")}
          className={cn(
            "self-end",
            internal && "bg-amber-600 text-white hover:bg-amber-600/90 dark:bg-amber-500 dark:text-amber-950",
          )}
        >
          {send.isPending ? <Spinner /> : <Send />}
          {internal ? t("saveNote") : t("send")}
        </Button>
      </div>
    </form>
  );
}
