export const EXPERIMENTS = [
  "single",
  "multi",
  "batch",
  "free-text",
  "html",
  "markdown",
  "plan",
  "preallowed",
  "cancel",
] as const;
export type Mode = (typeof EXPERIMENTS)[number];
export interface RunConfig {
  mode: Mode;
  prediction?: "execute" | "block" | "mixed" | "observe";
}
export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}
export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}
export interface Selection {
  labels: string[];
  other?: string;
}
export type AnswerDecision =
  | { kind: "answers"; selections: Record<string, Selection> }
  | { kind: "response"; response: string }
  | { kind: "cancel" };
export interface QuestionRequest {
  id: string;
  questions: Question[];
  toolUseID: string;
  previewFormat: "html" | "markdown" | "none";
  deadline: string;
}
export interface AnswerResult {
  answers?: Record<string, string>;
  response?: string;
  cancelled: boolean;
  requestId: string;
}
export interface Trace {
  phase: "hook" | "callback" | "post";
  tool: string;
  decision: string;
}
export interface Evidence {
  mode: Mode;
  prediction?: string;
  predictedCorrect?: boolean;
  expectedStage: string;
  expectedOutcome: string;
  observedOutcome: string;
  callbackCalls: number;
  questionCount: number;
  multiSelectCount: number;
  previewCount: number;
  answers: Record<string, string>;
  response?: string;
  questions: Question[];
  originalQuestionsPreserved: boolean;
  completed: string[];
  trace: Trace[];
  nativeErrors: number;
  reportedModes: string[];
  sessionIds: string[];
  resultStatuses: string[];
  cancelled: boolean;
  pendingAfterRun: number;
  fixtureUnchanged: boolean;
  fileCreated: boolean;
  fileContents: string | null;
  reviewSource: string;
}
export type LabEvent =
  | { type: "options"; config: RunConfig; options: unknown }
  | { type: "configuration"; files: { name: string; contents: string }[] }
  | {
      type: "initialized";
      model: string;
      sessionId: string;
      tools: string[];
      permissionMode: string;
    }
  | ({ type: "question-request" } & QuestionRequest)
  | {
      type: "question-resolved";
      id: string;
      answers?: Record<string, string>;
      response?: string;
      cancelled: boolean;
      originalQuestionsPreserved: boolean;
    }
  | { type: "trace"; entry: Trace }
  | { type: "tool"; name: string; args: unknown }
  | { type: "native-result"; name: string; isError: boolean; content: unknown }
  | { type: "message"; sdkType: string; summary: string }
  | { type: "answer"; text: string }
  | { type: "result"; status: string; text: string; costUsd: number | null }
  | ({ type: "evidence" } & Evidence)
  | { type: "notice" | "error"; text: string };
