import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** A complete Markdown file produced by the consolidator. */
export interface MarkdownUpdate {
  target_file: string;
  content: string;
}

export interface MarkdownUpdatePayload {
  updates: MarkdownUpdate[];
}

export interface MarkdownOperationResult {
  written: string[];
}

type PreparedUpdate = MarkdownUpdate & { absolutePath: string };

/**
 * Writes complete Markdown files returned by the LLM.
 *
 * `content` replaces the current file contents when the file already exists,
 * and creates the file when it does not.
 */
export function applyMarkdownUpdates(
  json: string,
  outputRoot: string,
): MarkdownOperationResult {
  const updates = parseUpdates(json);
  const root = resolve(outputRoot);
  const seenPaths = new Set<string>();
  const prepared: PreparedUpdate[] = [];

  for (const [index, update] of updates.entries()) {
    const absolutePath = resolveMarkdownPath(root, update.target_file, index);
    if (seenPaths.has(absolutePath)) {
      throw new Error(`Update ${index}: duplicate target file \"${update.target_file}\".`);
    }

    seenPaths.add(absolutePath);
    prepared.push({ ...update, absolutePath });
  }

  const result: MarkdownOperationResult = { written: [] };
  for (const update of prepared) {
    mkdirSync(dirname(update.absolutePath), { recursive: true });
    writeFileSync(update.absolutePath, update.content, "utf8");
    result.written.push(update.target_file);
  }

  return result;
}

function parseUpdates(json: string): MarkdownUpdate[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Markdown updates must be valid JSON.");
  }

  if (!isRecord(value) || !Array.isArray(value.updates)) {
    throw new Error("Markdown updates must be an object with an updates array.");
  }

  return value.updates.map((update, index) => validateUpdate(update, index));
}

function validateUpdate(value: unknown, index: number): MarkdownUpdate {
  if (!isRecord(value) || typeof value.target_file !== "string" || typeof value.content !== "string") {
    throw new Error(`Update ${index} must include string target_file and content fields.`);
  }

  return { target_file: value.target_file, content: value.content };
}

function resolveMarkdownPath(root: string, inputPath: string, operationIndex: number): string {
  if (!inputPath || isAbsolute(inputPath) || !inputPath.endsWith(".md")) {
    throw new Error(`Operation ${operationIndex}: path must be a relative .md file path.`);
  }

  const absolutePath = resolve(root, inputPath);
  const pathFromRoot = relative(root, absolutePath);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Operation ${operationIndex}: path escapes the output root.`);
  }

  return absolutePath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
