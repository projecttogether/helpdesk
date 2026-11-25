import type { Answer } from "@helpdesk/shared/api/tickets";
import { AttachmentList } from "@/components/attachments";
import { useT } from "@/i18n";
import { useFormatter } from "@/lib/format";
import { messages } from "./messages";

/** The request's answers as they were asked: label, then the answer. */
export function Answers({ answers }: { answers: Answer[] }) {
  const t = useT(messages);
  if (answers.length === 0) return <p className="text-muted-foreground text-sm">{t("noDetails")}</p>;
  return (
    <dl className="grid gap-4">
      {answers.map((answer) => (
        <div key={answer.questionId} className="grid gap-1">
          <dt className="text-muted-foreground text-sm font-medium">{answer.label}</dt>
          <dd className="min-w-0 text-sm">
            <AnswerValue answer={answer} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AnswerValue({ answer }: { answer: Answer }) {
  const t = useT(messages);
  const format = useFormatter();
  const [first] = answer.display;
  switch (answer.type) {
    case "checkbox":
      return <>{t("yes")}</>;
    case "file":
      return answer.attachments.length > 0 ? (
        <AttachmentList attachments={answer.attachments} />
      ) : (
        <>{answer.display.join(", ") || "–"}</>
      );
    case "long_text":
      return <div className="break-words whitespace-pre-wrap">{first ?? "–"}</div>;
    case "date":
      return <>{first ? format.date(first) : "–"}</>;
    case "email":
      return first ? (
        <a href={`mailto:${first}`} className="break-all underline underline-offset-4">
          {first}
        </a>
      ) : (
        <>–</>
      );
    case "multiple_choice":
      return answer.display.length > 1 ? (
        <ul className="list-inside list-disc">
          {answer.display.map((value, index) => (
            <li key={`${value}-${index}`}>{value}</li>
          ))}
        </ul>
      ) : (
        <>{first ?? "–"}</>
      );
    default:
      return <div className="break-words">{answer.display.join(", ") || "–"}</div>;
  }
}
