import OpenAI from "openai";

import { SYSTEM_PROMPTS } from "./prompts.js";

export interface ChangeAssessment {
  change_required: boolean;
  "sub-directory": string;
  reason: string;
}

export interface CurrentContext {
  rules: string;
  memory: string;
  skills: string;
}

export interface HarnessAnalysisInput {
  intent: string;
  diff: string;
  current_context: CurrentContext;
}

export interface HarnessUpdate {
  target_file: string;
  content: string;
}

export interface HarnessUpdateResult {
  updates: HarnessUpdate[];
}

export interface DiffAnalysisResult extends HarnessUpdateResult {
  assessment: ChangeAssessment;
}

export type ContextLoader = (
  subDirectory: string,
) => CurrentContext | Promise<CurrentContext>;

export interface GitAgentAIClientOptions {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
}

const CHANGE_ASSESSMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["change_required", "sub-directory", "reason"],
  properties: {
    change_required: { type: "boolean" },
    "sub-directory": { type: "string" },
    reason: { type: "string" },
  },
} as const;

const HARNESS_UPDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["updates"],
  properties: {
    updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["target_file", "content"],
        properties: {
          target_file: { type: "string" },
          content: { type: "string" },
        },
      },
    },
  },
} as const;

const DEFAULT_MODEL = "gpt-4.1-mini";
const HARNESS_PATH_PATTERN = /^(rules|memory|skills)\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+\.md$/;

/** Runs GitAgent's classifier and harness-reconciliation LLM calls. */
export class GitAgentAIClient {
  readonly #client: OpenAI;
  readonly #model: string;

  constructor(options: GitAgentAIClientOptions = {}) {
    this.#client =
      options.client ?? new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
    this.#model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  }

  /** First LLM call: determine whether the raw diff contains durable knowledge. */
  async assessChange(rawDiff: string): Promise<ChangeAssessment> {
    assertNonEmpty(rawDiff, "rawDiff");

    const result = await this.#requestJson(
      SYSTEM_PROMPTS.bigEnoughChangePrompt,
      `Analyze this raw Git diff:\n\n${rawDiff}`,
      "gitagent_change_assessment",
      CHANGE_ASSESSMENT_SCHEMA,
    );

    return parseChangeAssessment(result);
  }

  /** Second LLM call: produce complete final contents for affected harness files. */
  async analyzeHarnessChange(input: HarnessAnalysisInput): Promise<HarnessUpdateResult> {
    assertNonEmpty(input.intent, "input.intent");
    assertNonEmpty(input.diff, "input.diff");
    assertCurrentContext(input.current_context);

    const result = await this.#requestJson(
      SYSTEM_PROMPTS.codebaseChangePrompt,
      JSON.stringify(input),
      "gitagent_harness_updates",
      HARNESS_UPDATE_SCHEMA,
    );

    return parseHarnessUpdateResult(result);
  }

  /** Runs both calls, skipping reconciliation when no context change is needed. */
  async analyzeDiff(
    rawDiff: string,
    context: CurrentContext | ContextLoader,
  ): Promise<DiffAnalysisResult> {
    const assessment = await this.assessChange(rawDiff);

    if (!assessment.change_required) {
      return { assessment, updates: [] };
    }

    const currentContext =
      typeof context === "function"
        ? await context(assessment["sub-directory"])
        : context;

    const result = await this.analyzeHarnessChange({
      intent: assessment.reason,
      diff: rawDiff,
      current_context: currentContext,
    });

    return { assessment, updates: result.updates };
  }

  async #requestJson(
    systemPrompt: string,
    userPrompt: string,
    schemaName: string,
    schema: Record<string, unknown>,
  ): Promise<unknown> {
    const completion = await this.#client.chat.completions.create({
      model: this.#model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
    });

    const message = completion.choices[0]?.message;
    if (!message) throw new Error("The LLM returned no response choice.");
    if (message.refusal) throw new Error(`The LLM refused the request: ${message.refusal}`);
    if (!message.content) throw new Error("The LLM returned an empty response.");

    try {
      return JSON.parse(message.content) as unknown;
    } catch (error) {
      throw new Error("The LLM returned invalid JSON despite structured output mode.", {
        cause: error,
      });
    }
  }
}

function parseChangeAssessment(value: unknown): ChangeAssessment {
  if (!isRecord(value)) {
    throw new TypeError("Invalid change assessment: expected an object.");
  }

  const changeRequired = value.change_required;
  const subDirectory = value["sub-directory"];
  const reason = value.reason;

  if (typeof changeRequired !== "boolean") {
    throw new TypeError("Invalid change assessment: change_required must be a boolean.");
  }
  if (!isSafeRelativePath(subDirectory)) {
    throw new TypeError("Invalid change assessment: sub-directory must be a safe relative path.");
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new TypeError("Invalid change assessment: reason must be a non-empty string.");
  }

  return {
    change_required: changeRequired,
    "sub-directory": subDirectory,
    reason,
  };
}

function parseHarnessUpdateResult(value: unknown): HarnessUpdateResult {
  if (!isRecord(value) || !Array.isArray(value.updates)) {
    throw new TypeError("Invalid harness update result: updates must be an array.");
  }

  const updates = value.updates.map((update, index): HarnessUpdate => {
    if (!isRecord(update)) {
      throw new TypeError(`Invalid harness update at index ${index}: expected an object.`);
    }

    const targetFile = update.target_file;
    const content = update.content;
    if (
      typeof targetFile !== "string" ||
      !isSafeRelativePath(targetFile) ||
      !HARNESS_PATH_PATTERN.test(targetFile)
    ) {
      throw new TypeError(
        `Invalid harness update at index ${index}: target_file must be a safe Markdown path under rules/, memory/, or skills/.`,
      );
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new TypeError(
        `Invalid harness update at index ${index}: content must be a non-empty string.`,
      );
    }

    return { target_file: targetFile, content };
  });

  return { updates };
}

function assertCurrentContext(value: CurrentContext): void {
  if (
    !isRecord(value) ||
    typeof value.rules !== "string" ||
    typeof value.memory !== "string" ||
    typeof value.skills !== "string"
  ) {
    throw new TypeError("current_context must contain string rules, memory, and skills fields.");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function isSafeRelativePath(value: unknown): value is string {
  const backslash = String.fromCharCode(92);
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith(backslash) &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes(backslash) &&
    !value.split("/").includes("..")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
