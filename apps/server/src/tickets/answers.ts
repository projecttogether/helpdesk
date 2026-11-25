import type { Answers, QuestionType, VisiblePage } from "@helpdesk/shared/form";

/** One answered question as it was asked, stored with the ticket so later form changes do not alter it. */
export type StoredAnswer = {
  questionId: string;
  label: string;
  type: QuestionType;
  /** The text, the chosen choices' labels, or the file names. Empty for a ticked checkbox. */
  display: string[];
  attachmentIds: string[];
};

/** The answered questions of a submission, without the system questions (they become ticket fields). */
export function storedAnswers(
  visible: VisiblePage[],
  values: Answers,
  filenames: ReadonlyMap<string, string>,
): StoredAnswer[] {
  const answers: StoredAnswer[] = [];
  for (const { questions } of visible) {
    for (const question of questions) {
      if (question.system) continue;
      const value = values[question.id];
      if (value === undefined || value === null) continue;
      const base = { questionId: question.id, label: question.label, type: question.type };
      switch (question.type) {
        case "single_choice":
        case "multiple_choice": {
          const ids = Array.isArray(value) ? value : [String(value)];
          const labels = ids.map((id) => question.options.find((option) => option.id === id)?.label ?? id);
          answers.push({ ...base, display: labels, attachmentIds: [] });
          break;
        }
        case "file": {
          const ids = Array.isArray(value) ? value : [];
          answers.push({ ...base, display: ids.map((id) => filenames.get(id) ?? id), attachmentIds: ids });
          break;
        }
        case "checkbox":
          answers.push({ ...base, display: [], attachmentIds: [] });
          break;
        default:
          answers.push({ ...base, display: [String(value)], attachmentIds: [] });
      }
    }
  }
  return answers;
}

/** Attachment ids of the file questions of a submission. */
export function fileAnswerIds(visible: VisiblePage[], values: Answers): string[] {
  const ids: string[] = [];
  for (const { questions } of visible) {
    for (const question of questions) {
      const value = values[question.id];
      if (question.type === "file" && Array.isArray(value)) ids.push(...value);
    }
  }
  return [...new Set(ids)];
}
