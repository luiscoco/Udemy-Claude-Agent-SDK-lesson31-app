import {
  query,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { MODES, SCENARIOS, validateConfig } from "./modes.js";
import {
  parseQuestions,
  mapAnswers,
  requestAnswers,
  pendingCount,
} from "./questions.js";
import { prepareWorkspace } from "./workspace.js";
import type {
  RunConfig,
  Mode,
  Question,
  QuestionRequest,
  AnswerDecision,
  Evidence,
  LabEvent,
  Trace,
} from "./protocol.js";
export { MODES, validateConfig };
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const DEFAULT_CONFIG: RunConfig = {
  mode: "single",
  prediction: "execute",
};
const tasks: Record<Mode, string> = {
  single:
    "Ask one single-select question about the preferred lesson explanation format, with two concise options.",
  multi:
    "Ask one multi-select question about which learning activities to include, with three concise options. Set multiSelect true.",
  batch:
    "Ask two questions in the SAME AskUserQuestion call: one single-select question about lesson format and one single-select question about student experience. Give two options for each.",
  "free-text":
    "Ask one single-select question about the preferred lesson format with two concise options. The host UI supports a custom Other answer; do not add Other yourself.",
  html: "Ask one single-select question comparing two visual card layouts for a student dashboard. Include a small styled div HTML preview for each layout using the configured preview format. Use readable font sizes of at least 20px. Keep previews simple and self-contained with no links or external assets.",
  markdown:
    "Ask one single-select question comparing two layouts for a student dashboard. Include a small ASCII mockup in a fenced Markdown code block for each option using the configured preview format.",
  plan: "Clarify a vague request to plan a student learning dashboard. Ask one single-select question about the intended audience, with two options. After the answer, propose a brief read-only plan as final text, without saving a plan file or using ExitPlanMode.",
  preallowed:
    "Ask one single-select question about lesson explanation format, with two concise options. An allow entry is present, but human answers still must come through the callback.",
  cancel:
    "Ask one single-select question about lesson format, with two concise options. Wait for the user; never invent an answer.",
};
export const PROMPTS = Object.fromEntries(
  MODES.map((mode) => [
    mode,
    "Use the real AskUserQuestion tool exactly once as your FIRST action. " +
      tasks[mode] +
      " Generate the question wording and labels yourself. After receiving the actual user answer, Read lesson.txt and provide a short explanation that explicitly repeats every selected label or custom answer and the QUESTION-31 marker. Do not ask again, write files or simulate tool results.",
  ]),
) as Record<Mode, string>;
export function redact(text: string) {
  for (const secret of [
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_AUTH_TOKEN,
  ].filter(Boolean) as string[])
    text = text.split(secret).join("[REDACTED]");
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 24000);
}
export async function runAgent(
  config: RunConfig,
  emit: (e: LabEvent) => void,
  controller = new AbortController(),
  provider?: (
    request: QuestionRequest,
    signal: AbortSignal,
  ) => Promise<AnswerDecision>,
) {
  const c = validateConfig(config),
    s = SCENARIOS[c.mode],
    workspace = await prepareWorkspace();
  const trace: Trace[] = [],
    completed: string[] = [],
    reportedModes: string[] = [],
    sessionIds: string[] = [],
    resultStatuses: string[] = [];
  const generated: Question[] = [];
  let callbackCalls = 0,
    nativeErrors = 0,
    originalQuestionsPreserved = true;
  let answers: Record<string, string> = Object.create(null),
    response: string | undefined;
  const previewFormat =
    c.mode === "html" ? "html" : c.mode === "markdown" ? "markdown" : "none";
  const record = (entry: Trace) => {
    trace.push(entry);
    emit({ type: "trace", entry });
  };
  let release!: () => void;
  const gate = new Promise<void>((ok) => {
    release = ok;
  });
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      message: {
        role: "user",
        content: PROMPTS[c.mode] + `\nWorking directory: ${workspace.cwd}`,
      },
      parent_tool_use_id: null,
      session_id: "",
    };
    await gate;
  }
  const options: Options = {
    model: MODEL,
    cwd: workspace.cwd,
    tools: ["Read", "AskUserQuestion"],
    permissionMode: c.mode === "plan" ? "plan" : "default",
    allowedTools:
      c.mode === "preallowed" ? ["Read", "AskUserQuestion"] : ["Read"],
    ...(previewFormat !== "none"
      ? { toolConfig: { askUserQuestion: { previewFormat } } }
      : {}),
    ...(c.mode === "plan"
      ? {
          planModeInstructions:
            "Ask the requested clarifying question first. Return a short read-only plan as final text. Do not create a plan file or use ExitPlanMode. The app only exposes Read and AskUserQuestion.",
        }
      : {}),
    settingSources: [],
    skills: [],
    plugins: [],
    mcpServers: {},
    strictMcpConfig: true,
    persistSession: false,
    maxTurns: 6,
    maxBudgetUsd: 0.45,
    effort: "low",
    thinking: { type: "disabled" },
    abortController: controller,
    env: {
      ...process.env,
      HOME: workspace.home,
      USERPROFILE: workspace.home,
      CLAUDE_CONFIG_DIR: workspace.sdkHome,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    },
    systemPrompt:
      "This is a real classroom clarifying-question experiment. Ask exactly once using AskUserQuestion before reading the fixture. The model owns the question text and options; the host only renders them and collects real answers. Wait for those answers. Do not replace the question tool with natural-language questions. Follow the actual selected labels or free text and keep your final response brief. Never write files or request a mode change.",
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (e) => {
              if (e.hook_event_name !== "PreToolUse") return {};
              const v = e.tool_input as Record<string, unknown>;
              const pass =
                e.tool_name === "AskUserQuestion" ||
                (e.tool_name === "Read" &&
                  typeof v.file_path === "string" &&
                  resolve(workspace.cwd, v.file_path) ===
                    resolve(workspace.cwd, "lesson.txt"));
              record({
                phase: "hook",
                tool: e.tool_name,
                decision: pass ? "pass" : "deny",
              });
              return pass
                ? {}
                : {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      permissionDecision: "deny",
                      permissionDecisionReason:
                        "Only clarifying questions and the fixed lesson fixture read are in scope.",
                    },
                  };
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            async (e) => {
              if (e.hook_event_name === "PostToolUse") {
                completed.push(e.tool_name);
                record({
                  phase: "post",
                  tool: e.tool_name,
                  decision: "completed",
                });
              }
              return {};
            },
          ],
        },
      ],
    },
    canUseTool: async (toolName, input, context) => {
      callbackCalls++;
      record({
        phase: "callback",
        tool: toolName,
        decision: "waiting for actual answers",
      });
      if (toolName !== "AskUserQuestion")
        return {
          behavior: "deny",
          message:
            "No unrelated tool approval is provided by this question handler.",
        };
      const questions = parseQuestions(input),
        before = JSON.stringify(input.questions);
      generated.push(...questions);
      const signal = AbortSignal.any([context.signal, controller.signal]);
      const details: Omit<QuestionRequest, "id" | "deadline"> = {
        questions,
        toolUseID: context.toolUseID,
        previewFormat,
      };
      let result;
      if (provider) {
        const request = {
          id: randomUUID(),
          ...details,
          deadline: new Date(Date.now() + 120000).toISOString(),
        };
        emit({ type: "question-request", ...request });
        result = {
          ...mapAnswers(questions, await provider(request, signal)),
          requestId: request.id,
        };
      } else result = await requestAnswers(details, emit, signal);
      if (result.cancelled || signal.aborted) {
        controller.abort();
        emit({
          type: "question-resolved",
          id: result.requestId,
          cancelled: true,
          originalQuestionsPreserved: true,
        });
        return {
          behavior: "deny",
          message:
            "The student cancelled. No answers were supplied. Stop without guessing.",
        };
      }
      answers = { ...answers, ...result.answers };
      response = result.response;
      const updatedInput = {
        ...input,
        questions: input.questions,
        ...(result.response !== undefined
          ? { response: result.response }
          : { answers: result.answers }),
      };
      originalQuestionsPreserved =
        originalQuestionsPreserved &&
        JSON.stringify(updatedInput.questions) === before;
      emit({
        type: "question-resolved",
        id: result.requestId,
        answers: result.answers,
        response: result.response,
        cancelled: false,
        originalQuestionsPreserved,
      });
      return { behavior: "allow", updatedInput };
    },
  };
  emit({
    type: "configuration",
    files: [
      {
        name: "Actual question configuration",
        contents: JSON.stringify(
          {
            tools: options.tools,
            allowedTools: options.allowedTools,
            permissionMode: options.permissionMode,
            previewFormat,
            transport: "SSE question-request; POST /api/answers",
            questionOwnership: "Generated by Claude; preserved unchanged",
            timeoutSeconds: 120,
          },
          null,
          2,
        ),
      },
    ],
  });
  emit({
    type: "options",
    config: c,
    options: {
      model: MODEL,
      tools: options.tools,
      allowedTools: options.allowedTools,
      permissionMode: options.permissionMode,
      toolConfig: options.toolConfig ?? "(unset)",
      referenceStage: s.stage,
      expectedOutcome: s.outcome,
      cwd: "fresh disposable directory",
    },
  });
  let run: ReturnType<typeof query> | undefined;
  const names = new Map<string, string>();
  try {
    const active = query({ prompt: input(), options });
    run = active;
    try {
      for await (const message of active) {
        emit({
          type: "message",
          sdkType: message.type,
          summary:
            "subtype" in message
              ? String(message.subtype)
              : "Actual SDK message",
        });
        if (message.type === "system" && message.subtype === "init") {
          reportedModes.push(message.permissionMode);
          emit({
            type: "initialized",
            model: message.model,
            sessionId: message.session_id,
            tools: message.tools,
            permissionMode: message.permissionMode,
          });
        }
        if (message.type === "assistant")
          for (const block of message.message.content) {
            if (block.type === "text")
              emit({ type: "answer", text: redact(block.text) });
            if (block.type === "tool_use") {
              names.set(block.id, block.name);
              emit({ type: "tool", name: block.name, args: block.input });
            }
          }
        if (message.type === "user" && Array.isArray(message.message.content))
          for (const block of message.message.content)
            if (block.type === "tool_result") {
              if (block.is_error) nativeErrors++;
              emit({
                type: "native-result",
                name: names.get(block.tool_use_id) || block.tool_use_id,
                isError: Boolean(block.is_error),
                content: JSON.parse(redact(JSON.stringify(block.content))),
              });
            }
        if (message.type === "result") {
          const status =
            message.subtype === "success"
              ? message.is_error
                ? "error"
                : "success"
              : message.subtype;
          resultStatuses.push(status);
          sessionIds.push(message.session_id);
          emit({
            type: "result",
            status,
            text: redact(
              message.subtype === "success"
                ? message.result
                : message.errors.join("\n"),
            ),
            costUsd: message.total_cost_usd,
          });
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
    if (controller.signal.aborted)
      emit({
        type: "result",
        status: "cancelled",
        text: "Cancelled while questions were pending. No answer was fabricated.",
        costUsd: null,
      });
    const files = await workspace.inspect();
    const observedOutcome = completed.length
      ? nativeErrors
        ? "mixed"
        : "execute"
      : "block";
    const evidence: Evidence = {
      mode: c.mode,
      prediction: c.prediction,
      predictedCorrect: c.prediction
        ? c.prediction === "observe" || c.prediction === observedOutcome
        : undefined,
      expectedStage: s.stage,
      expectedOutcome: s.outcome,
      observedOutcome,
      callbackCalls,
      questionCount: generated.length,
      multiSelectCount: generated.filter((q) => q.multiSelect).length,
      previewCount: generated
        .flatMap((q) => q.options)
        .filter((o) => o.preview !== undefined).length,
      answers,
      response,
      questions: generated,
      originalQuestionsPreserved,
      completed,
      trace,
      nativeErrors,
      reportedModes,
      sessionIds,
      resultStatuses,
      cancelled: controller.signal.aborted,
      pendingAfterRun: pendingCount(),
      fixtureUnchanged: files.fixtureUnchanged,
      fileCreated: files.fileCreated,
      fileContents: files.fileContents,
      reviewSource: provider
        ? "Explicit test/CLI answer provider"
        : "Actual browser selections and submit button",
    };
    emit({ type: "evidence", ...evidence });
    return evidence;
  } finally {
    release();
    controller.abort();
    run?.close();
    await workspace.cleanup();
  }
}
