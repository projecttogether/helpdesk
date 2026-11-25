import { useRef, useState } from "react";
import { Paperclip, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { Attachment } from "@helpdesk/shared/api/tickets";
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  isAllowedAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@helpdesk/shared/tickets";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { useFormatter } from "@/lib/format";
import { defineMessages, useT } from "@/i18n";
import { cn } from "@/components/ui/utils";

const messages = defineMessages({
  en: {
    add: "Add files",
    remove: "Remove {name}",
    tooLarge: "{name} is larger than 10 MB",
    notAllowed: "{name}: this file type is not allowed",
    tooMany: "At most {count} files",
    hint: "Up to {count} files, 10 MB each",
    download: "Download {name}",
  },
  de: {
    add: "Dateien hinzufügen",
    remove: "{name} entfernen",
    tooLarge: "{name} ist größer als 10 MB",
    notAllowed: "{name}: Dieser Dateityp ist nicht erlaubt",
    tooMany: "Höchstens {count} Dateien",
    hint: "Bis zu {count} Dateien, je 10 MB",
    download: "{name} herunterladen",
  },
});

const ACCEPT = ALLOWED_ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`).join(",");

/**
 * Uploads files right away and lists them; `value` holds the uploaded files,
 * whose ids a form or message then sends. Removing a file only drops it from
 * the list (the server removes unused uploads after a day).
 */
export function AttachmentPicker(props: {
  value: Attachment[];
  onChange: (files: Attachment[]) => void;
  disabled?: boolean;
  /** Labels the button for screen readers, e.g. the question. */
  id?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useT(messages);
  const format = useFormatter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string[]>([]);
  const files = useRef(props.value);
  files.current = props.value;

  const add = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const chosen = [...list];
    if (input.current) input.current.value = "";
    if (files.current.length + chosen.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      toast.error(t("tooMany", { count: MAX_ATTACHMENTS_PER_MESSAGE }));
      return;
    }
    const valid = chosen.filter((file) => {
      if (!isAllowedAttachment(file.name)) {
        toast.error(t("notAllowed", { name: file.name }));
        return false;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(t("tooLarge", { name: file.name }));
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;
    setPending((current) => [...current, ...valid.map((file) => file.name)]);
    props.onBusyChange?.(true);
    for (const file of valid) {
      try {
        const uploaded = await api.upload<Attachment>("/attachments", file);
        files.current = [...files.current, uploaded];
        props.onChange(files.current);
      } catch (error) {
        toast.error(`${file.name}: ${errorMessage(error)}`);
      } finally {
        setPending((current) => {
          const index = current.indexOf(file.name);
          return index === -1 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
        });
      }
    }
    props.onBusyChange?.(false);
  };

  return (
    <div className="grid gap-2">
      {props.value.length > 0 || pending.length > 0 ? (
        <ul className="grid gap-1.5">
          {props.value.map((file) => (
            <li
              key={file.id}
              className="bg-muted/50 flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
            >
              <Paperclip className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.filename}</span>
              <span className="text-muted-foreground shrink-0 text-xs">{format.bytes(file.size)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t("remove", { name: file.filename })}
                disabled={props.disabled}
                onClick={() => props.onChange(props.value.filter((item) => item.id !== file.id))}
              >
                <X />
              </Button>
            </li>
          ))}
          {pending.map((name, index) => (
            <li
              key={`${name}-${index}`}
              className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-sm"
            >
              <Spinner className="size-4" />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          id={props.id}
          type="button"
          variant="outline"
          size="sm"
          disabled={props.disabled || props.value.length >= MAX_ATTACHMENTS_PER_MESSAGE}
          onClick={() => input.current?.click()}
        >
          <Upload />
          {t("add")}
        </Button>
        <span className="text-muted-foreground text-xs">
          {t("hint", { count: MAX_ATTACHMENTS_PER_MESSAGE })}
        </span>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        tabIndex={-1}
        onChange={(event) => void add(event.target.files)}
      />
    </div>
  );
}

/** Download links for a ticket's or message's files. */
export function AttachmentList({
  attachments,
  className,
}: {
  attachments: Attachment[];
  className?: string;
}) {
  const t = useT(messages);
  const format = useFormatter();
  if (attachments.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((file) => (
        <li key={file.id}>
          <a
            href={`/api/v1/attachments/${file.id}`}
            download={file.filename}
            className="hover:bg-muted inline-flex max-w-72 items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
            aria-label={t("download", { name: file.filename })}
          >
            <Paperclip className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{file.filename}</span>
            <span className="text-muted-foreground shrink-0 text-xs">{format.bytes(file.size)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
