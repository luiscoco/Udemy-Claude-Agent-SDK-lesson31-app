import { randomUUID } from "node:crypto";
import type {
  Question,
  AnswerResult,
  AnswerDecision,
  QuestionRequest,
  LabEvent,
} from "./protocol.js";
export function parseQuestions(input: Record<string, unknown>): Question[] {
  const qs = input.questions;
  if (!Array.isArray(qs) || qs.length < 1 || qs.length > 4)
    throw new Error("Expected one to four SDK-generated questions.");
  const seen = new Set<string>();
  for (const q of qs) {
    if (
      !q ||
      typeof q.question !== "string" ||
      !q.question.trim() ||
      q.question.length > 2000 ||
      seen.has(q.question) ||
      typeof q.header !== "string" ||
      q.header.length > 200 ||
      typeof q.multiSelect !== "boolean" ||
      !Array.isArray(q.options) ||
      q.options.length < 2 ||
      q.options.length > 4
    )
      throw new Error("Invalid SDK question shape or duplicate question text.");
    seen.add(q.question);
    const labels = new Set<string>();
    for (const option of q.options) {
      if (
        !option ||
        typeof option.label !== "string" ||
        !option.label.trim() ||
        option.label.length > 200 ||
        labels.has(option.label) ||
        typeof option.description !== "string" ||
        option.description.length > 2000 ||
        (option.preview !== undefined &&
          (typeof option.preview !== "string" || option.preview.length > 20000))
      )
        throw new Error("Invalid SDK option.");
      labels.add(option.label);
    }
  }
  // Preserve Claude's original objects: the UI never appends new questions.
  return qs as Question[];
}
export function mapAnswers(
  questions: Question[],
  value: unknown,
): Omit<AnswerResult, "requestId"> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provide an answer decision.");
  const d = value as AnswerDecision;
  if (d.kind === "cancel") return { cancelled: true };
  if (d.kind === "response") {
    if (
      typeof d.response !== "string" ||
      !d.response.trim() ||
      d.response.length > 2000
    )
      throw new Error("Enter a general reply of at most 2000 characters.");
    return { cancelled: false, response: d.response.trim() };
  }
  if (
    d.kind !== "answers" ||
    !d.selections ||
    typeof d.selections !== "object" ||
    Array.isArray(d.selections)
  )
    throw new Error("Provide structured selections.");
  if (
    Object.keys(d.selections).length !== questions.length ||
    Object.keys(d.selections).some(
      (key) => !questions.some((q) => q.question === key),
    )
  )
    throw new Error("Answers must match the original full question texts.");
  const answers: Record<string, string> = Object.create(null);
  for (const q of questions) {
    const s = d.selections[q.question];
    if (
      !s ||
      !Array.isArray(s.labels) ||
      s.labels.some(
        (label) =>
          typeof label !== "string" ||
          !q.options.some((o) => o.label === label),
      ) ||
      new Set(s.labels).size !== s.labels.length ||
      (!q.multiSelect && s.labels.length > 1)
    )
      throw new Error("Select only options from this question.");
    if (s.other !== undefined) {
      if (
        typeof s.other !== "string" ||
        !s.other.trim() ||
        s.other.length > 500 ||
        s.labels.length
      )
        throw new Error(
          "Use either selected labels or a custom answer of at most 500 characters.",
        );
      answers[q.question] = s.other.trim();
    } else {
      if (!s.labels.length)
        throw new Error("Answer every question before submitting.");
      answers[q.question] = s.labels.join(", ");
    }
  }
  return { cancelled: false, answers };
}
const pending = new Map<
  string,
  { questions: Question[]; settle: (result: AnswerResult) => void }
>();
export function pendingCount() {
  return pending.size;
}
export function resolveAnswers(id: string, decision: unknown) {
  const item = pending.get(id);
  if (!item) return false;
  const result = mapAnswers(item.questions, decision);
  item.settle({ ...result, requestId: id });
  return true;
}
export function requestAnswers(
  details: Omit<QuestionRequest, "id" | "deadline">,
  emit: (event: LabEvent) => void,
  signal: AbortSignal,
  timeoutMs = 120000,
): Promise<AnswerResult> {
  return new Promise((resolve) => {
    const id = randomUUID();
    let timer: ReturnType<typeof setTimeout>;
    const settle = (result: AnswerResult) => {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = () => settle({ requestId: id, cancelled: true });
    pending.set(id, { questions: details.questions, settle });
    timer = setTimeout(abort, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    emit({
      type: "question-request",
      id,
      ...details,
      deadline: new Date(Date.now() + timeoutMs).toISOString(),
    });
  });
}
