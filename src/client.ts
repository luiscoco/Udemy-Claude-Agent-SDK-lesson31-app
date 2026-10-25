import { renderMarkdown } from "./markdown.js";
import { showQuestions } from "./question-form.js";
import type { AnswerDecision } from "./protocol.js";
import type { LabEvent, Mode, RunConfig } from "./protocol.js";
const $ = (id: string) => document.getElementById(id)!;
const button = $("run") as HTMLButtonElement,
  rows: LabEvent[] = [];
const traces: unknown[] = [],
  native: unknown[] = [],
  warnings: unknown[] = [];
let questionId = "";
async function sendAnswers(decision: AnswerDecision) {
  const submitted = questionId;
  const response = await fetch("/api/answers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: submitted, ...decision }),
  });
  if (!response.ok) {
    $("question-status").textContent = await response.text();
    return;
  }
  if (questionId === submitted)
    document
      .querySelectorAll<HTMLButtonElement>("#question-panel button")
      .forEach((b) => (b.disabled = true));
}
const json = (id: string, value: unknown) => {
  $(id).textContent = JSON.stringify(value, null, 2);
  (window as any).Prism?.highlightElement($(id));
};
function receive(e: LabEvent) {
  rows.push(e);
  if (e.type === "question-request") {
    questionId = e.id;
    $("question-panel").hidden = false;
    showQuestions(e, sendAnswers);
    json("question-input", {
      questions: e.questions,
      toolUseID: e.toolUseID,
      previewFormat: e.previewFormat,
    });
  }
  if (e.type === "question-resolved") {
    json("answer-summary", e);
    $("question-status").textContent = e.cancelled
      ? "Cancelled. No answer was fabricated."
      : "Your actual answers were returned to the SDK. Claude can continue.";
  }
  if (e.type === "configuration") {
    const select = $("configuration-file") as HTMLSelectElement;
    select.replaceChildren();
    e.files.forEach((file, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = file.name;
      select.append(option);
    });
    const show = () => {
      $("configuration-content").textContent =
        e.files[Number(select.value)].contents;
      (window as any).Prism?.highlightElement($("configuration-content"));
    };
    select.onchange = show;
    show();
  }
  if (e.type === "options") json("options", e.options);
  if (e.type === "initialized") {
    $("session").textContent = e.sessionId;
    json("discovery", e);
  }
  if (e.type === "trace") {
    traces.push(e.entry);
    json("trace", traces);
  }
  if (e.type === "native-result") {
    native.push(e);
    json("native", native);
  }
  if (e.type === "answer") renderMarkdown($("answer"), e.text);
  if (e.type === "result") {
    $("status").textContent = e.status;
    $("cost").textContent =
      e.costUsd === null
        ? "Not reported by SDK for cancelled run"
        : "$" + e.costUsd.toFixed(5);
    renderMarkdown($("answer"), e.text);
  }
  if (e.type === "evidence") {
    json("evidence", e);
    const feedback =
      e.predictedCorrect === undefined
        ? "No prediction provided."
        : e.predictedCorrect
          ? "Your prediction matched."
          : "Compare the recorded evidence with the reference order.";
    $("verdict").textContent =
      `Observed: ${e.observedOutcome}. Prediction: ${e.prediction || "not provided"}. ` +
      feedback;
    const tr = document.createElement("tr");
    for (const value of [
      e.mode,
      e.expectedStage,
      e.prediction || "—",
      e.observedOutcome,
      e.callbackCalls,
      e.questionCount,
      Object.values(e.answers).join("; ") || "No answer",
    ]) {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.append(td);
    }
    $("history").append(tr);
  }
  if (e.type === "notice" || e.type === "error")
    $("notice").textContent = e.text;
  if (e.type === "error") $("status").textContent = "Could not finish";
  if (
    [
      "message",
      "tool",
      "native-result",
      "trace",
      "result",
      "warning",
      "error",
    ].includes(e.type)
  ) {
    const li = document.createElement("li");
    li.textContent = JSON.stringify(e);
    $("events").append(li);
  }
}
button.onclick = async () => {
  button.disabled = true;
  traces.length = 0;
  native.length = 0;
  warnings.length = 0;
  questionId = "";
  $("question-panel").hidden = true;
  json("answer-summary", {});
  $("answer").replaceChildren();
  $("events").replaceChildren();
  $("notice").textContent = "";
  $("status").textContent = "Running…";
  $("verdict").textContent = "Waiting for actual evidence…";
  for (const id of [
    "options",
    "discovery",
    "native",
    "trace",
    "evidence",
    "question-input",
  ])
    json(id, {});
  $("session").textContent = "—";
  $("cost").textContent = "—";
  const config: RunConfig = {
    mode: ($("mode") as HTMLSelectElement).value as Mode,
    prediction: ($("prediction") as HTMLSelectElement).value as
      | "execute"
      | "block"
      | "mixed"
      | "observe",
  };
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error(await response.text());
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines)
        if (line.startsWith("data: ")) receive(JSON.parse(line.slice(6)));
      if (done) break;
    }
    if ($("status").textContent === "Running…")
      $("status").textContent = "No final result; inspect the actual events";
  } catch (error) {
    $("status").textContent = "Could not finish";
    $("notice").textContent =
      error instanceof Error ? error.message : "Request failed";
  } finally {
    button.disabled = false;
  }
};
$("download").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "lesson31-observations.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
fetch("/api/config")
  .then((r) => r.json())
  .then((c) => {
    $("configuration").textContent =
      `Model: ${c.model} · SDK ${c.typescriptVersion} · ${c.ready ? "API key configured" : "Configure .env first"}`;
    button.disabled = !c.ready;
    ($("mode") as HTMLSelectElement).value = c.defaults.mode;
  })
  .catch(() => {
    $("configuration").textContent =
      "Could not reach the server. See How to run.";
  });
