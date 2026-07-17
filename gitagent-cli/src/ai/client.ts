import OpenAI from 'openai';
import { SYSTEM_PROMPTS } from './prompts.js';

export interface ScopeChange {
  sub_directory: string;
  reason: string;
}

export interface ChangeAssessment {
  change_required: boolean;
  changes: ScopeChange[];
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

export type ContextLoader = (subDirectory: string) => CurrentContext | Promise<CurrentContext>;

export interface GitAgentAIClientOptions {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
}

const CHANGE_ASSESSMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['change_required', 'changes'],
  properties: {
    change_required: { type: 'boolean' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sub_directory', 'reason'],
        properties: {
          sub_directory: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

const HARNESS_UPDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['updates'],
  properties: {
    updates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target_file', 'content'],
        properties: {
          target_file: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
  },
} as const;

const DEFAULT_MODEL = 'gpt-4.1-mini';

export class GitAgentAIClient {
  readonly #client: OpenAI;
  readonly #model: string;

  constructor(options: GitAgentAIClientOptions = {}) {
    this.#client =
      options.client ?? new OpenAI({ apiKey: options.apiKey ?? process.env['OPENAI_API_KEY'] });
    this.#model = options.model ?? process.env['OPENAI_MODEL'] ?? DEFAULT_MODEL;
  }

  async assessChange(rawDiff: string): Promise<ChangeAssessment> {
    assertNonEmpty(rawDiff, 'rawDiff');
    return await this.#requestJson(
      SYSTEM_PROMPTS.bigEnoughChangePrompt,
      `Analyze this raw Git diff:\n\n${rawDiff}`,
      'gitagent_change_assessment',
      CHANGE_ASSESSMENT_SCHEMA,
    ) as ChangeAssessment;
  }

  async analyzeHarnessChange(input: HarnessAnalysisInput): Promise<HarnessUpdateResult> {
    return await this.#requestJson(
      SYSTEM_PROMPTS.codebaseChangePrompt,
      JSON.stringify(input),
      'gitagent_harness_updates',
      HARNESS_UPDATE_SCHEMA,
    ) as HarnessUpdateResult;
  }

  async analyzeDiff(rawDiff: string, contextLoader: ContextLoader): Promise<DiffAnalysisResult> {
    const assessment = await this.assessChange(rawDiff);

    if (!assessment.change_required || assessment.changes.length === 0) {
      return { assessment, updates: [] };
    }

    const allUpdates: HarnessUpdate[] = [];
    for (const change of assessment.changes) {
      const context = await contextLoader(change.sub_directory);
      const result = await this.analyzeHarnessChange({
        intent: change.reason,
        diff: rawDiff,
        current_context: context,
      });
      allUpdates.push(...result.updates);
    }

    return { assessment, updates: allUpdates };
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
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
    });

    const message = completion.choices[0]?.message;
    if (!message) throw new Error('The LLM returned no response choice.');
    if (message.refusal) throw new Error(`The LLM refused the request: ${message.refusal}`);
    if (!message.content) throw new Error('The LLM returned an empty response.');

    return JSON.parse(message.content) as unknown;
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new TypeError(`${name} must be a non-empty string.`);
}
