import { EXPERIMENTS, type RunConfig, type Mode } from "./protocol.js";
export const MODES = [...EXPERIMENTS];
export const SCENARIOS: Record<Mode, { stage: string; outcome: string }> = {
  single: { stage: "Choose one generated option", outcome: "execute" },
  multi: { stage: "Choose several generated options", outcome: "execute" },
  batch: {
    stage: "Answer two generated questions in one form",
    outcome: "execute",
  },
  "free-text": {
    stage: "Use your own words as the question answer",
    outcome: "execute",
  },
  html: { stage: "Inspect actual optional HTML previews", outcome: "execute" },
  markdown: {
    stage: "Inspect actual optional Markdown previews",
    outcome: "execute",
  },
  plan: { stage: "Answer before a read-only plan", outcome: "observe" },
  preallowed: {
    stage: "AskUserQuestion still requires the callback",
    outcome: "execute",
  },
  cancel: { stage: "Cancel without fabricating an answer", outcome: "block" },
};
export function validateConfig(value: unknown): RunConfig {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !MODES.includes((value as RunConfig).mode)
  )
    throw new Error("Choose a listed question experiment.");
  const c = value as RunConfig;
  if (
    c.prediction !== undefined &&
    !["execute", "block", "mixed", "observe"].includes(c.prediction)
  )
    throw new Error("Choose a listed prediction.");
  return { mode: c.mode, prediction: c.prediction };
}
