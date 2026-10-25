import test from "node:test";
import assert from "node:assert/strict";
import {
  parseQuestions,
  mapAnswers,
  requestAnswers,
  resolveAnswers,
  pendingCount,
} from "./questions.js";
import { validateConfig } from "./modes.js";
import { prepareWorkspace } from "./workspace.js";
import type { Question, QuestionRequest } from "./protocol.js";
const questions: Question[] = [
  {
    question: "Which format?",
    header: "Format",
    multiSelect: false,
    options: [
      { label: "Summary", description: "Brief" },
      { label: "Detailed", description: "Longer" },
    ],
  },
  {
    question: "Which sections?",
    header: "Sections",
    multiSelect: true,
    options: [
      { label: "Introduction", description: "Start" },
      { label: "Conclusion", description: "Finish" },
    ],
  },
];
test("parse original SDK questions without mutating or adding them", () => {
  assert.equal(parseQuestions({ questions }), questions);
  assert.throws(() =>
    parseQuestions({ questions: [questions[0], questions[0]] }),
  );
  assert.throws(() => validateConfig({ mode: "bypass" }));
});
test("map full question texts to actual labels and joined multi-select labels", () => {
  const r = mapAnswers(questions, {
    kind: "answers",
    selections: {
      "Which format?": { labels: ["Summary"] },
      "Which sections?": { labels: ["Introduction", "Conclusion"] },
    },
  });
  assert.deepEqual(
    { ...r.answers },
    {
      "Which format?": "Summary",
      "Which sections?": "Introduction, Conclusion",
    },
  );
});
test("custom answers differ from a general response", () => {
  assert.equal(
    mapAnswers([questions[0]], {
      kind: "answers",
      selections: { "Which format?": { labels: [], other: "My own format" } },
    }).answers?.["Which format?"],
    "My own format",
  );
  const general = mapAnswers(questions, {
    kind: "response",
    response: "Let us discuss the goal first.",
  });
  assert.equal(general.answers, undefined);
  assert.equal(general.response, "Let us discuss the goal first.");
});
test("reject unknown labels, extra keys, missing answers and multiple single selections", () => {
  assert.throws(() =>
    mapAnswers([questions[0]], {
      kind: "answers",
      selections: { "Which format?": { labels: ["Invented"] } },
    }),
  );
  assert.throws(() =>
    mapAnswers([questions[0]], {
      kind: "answers",
      selections: { Format: { labels: ["Summary"] } },
    }),
  );
  assert.throws(() =>
    mapAnswers([questions[0]], {
      kind: "answers",
      selections: { "Which format?": { labels: ["Summary", "Detailed"] } },
    }),
  );
  assert.throws(() =>
    mapAnswers([questions[0]], {
      kind: "answers",
      selections: { "Which format?": { labels: [] } },
    }),
  );
});
test("pending answers are single-use and invalid submissions leave the request pending", async () => {
  let request!: QuestionRequest;
  const p = requestAnswers(
    { questions: [questions[0]], toolUseID: "test", previewFormat: "none" },
    (e) => {
      if (e.type === "question-request") request = e;
    },
    new AbortController().signal,
  );
  assert.equal(pendingCount(), 1);
  assert.throws(() =>
    resolveAnswers(request.id, { kind: "answers", selections: {} }),
  );
  assert.equal(pendingCount(), 1);
  assert.equal(
    resolveAnswers(request.id, {
      kind: "answers",
      selections: { "Which format?": { labels: ["Summary"] } },
    }),
    true,
  );
  assert.equal((await p).answers?.["Which format?"], "Summary");
  assert.equal(resolveAnswers(request.id, { kind: "cancel" }), false);
  assert.equal(pendingCount(), 0);
});
test("abort and timeout settle without fabricating answers", async () => {
  const c = new AbortController();
  const p = requestAnswers(
    { questions: [questions[0]], toolUseID: "abort", previewFormat: "none" },
    () => {},
    c.signal,
  );
  c.abort();
  assert.equal((await p).cancelled, true);
  const expired = await requestAnswers(
    { questions: [questions[0]], toolUseID: "timeout", previewFormat: "none" },
    () => {},
    new AbortController().signal,
    5,
  );
  assert.equal(expired.answers, undefined);
  assert.equal(pendingCount(), 0);
});
test("the fixture is unchanged and no outputs are created", async () => {
  const w = await prepareWorkspace();
  try {
    const e = await w.inspect();
    assert.equal(e.fixtureUnchanged, true);
    assert.equal(e.fileCreated, false);
  } finally {
    await w.cleanup();
  }
});
