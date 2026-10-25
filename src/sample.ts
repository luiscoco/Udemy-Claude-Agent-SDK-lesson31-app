import { runAgent, validateConfig } from "./agent.js";
const c = validateConfig({ mode: process.argv[2] || "single" });
if (!process.argv.includes("--answer-first"))
  throw new Error(
    "Use the web app for real selections, or explicitly supply --answer-first for a scripted demonstration.",
  );
await runAgent(
  c,
  (e) => console.log(JSON.stringify(e)),
  new AbortController(),
  async (r) =>
    c.mode === "cancel"
      ? { kind: "cancel" }
      : {
          kind: "answers",
          selections: Object.fromEntries(
            r.questions.map((q) => [
              q.question,
              c.mode === "free-text"
                ? {
                    labels: [],
                    other: "A concise lesson for beginner students",
                  }
                : {
                    labels: q.options
                      .slice(0, c.mode === "multi" ? 2 : 1)
                      .map((o) => o.label),
                  },
            ]),
          ),
        },
);
