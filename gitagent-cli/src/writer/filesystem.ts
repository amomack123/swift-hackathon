import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * One complete Markdown file returned by the consolidator.
 *
 * `target_file` is a repository-relative destination, and `content` is the
 * full replacement text to write at that destination.
 */
export interface MarkdownUpdate {
  target_file: string;
  content: string;
}

/** The top-level JSON shape expected from the consolidator. */
export interface MarkdownUpdatePayload {
  updates: MarkdownUpdate[];
}

/** Paths successfully written by {@link applyMarkdownUpdates}. */
export interface MarkdownOperationResult {
  written: string[];
}

/** A validated update with its safe, absolute destination path attached. */
type PreparedUpdate = MarkdownUpdate & { absolutePath: string };

/**
 * Writes complete Markdown files returned by the LLM.
 *
 * `content` replaces the current file contents when the file already exists,
 * and creates the file when it does not.
 *
 * @param json - A JSON string shaped like `{ updates: [{ target_file, content }] }`.
 * @param outputRoot - The repository directory that bounds all writable paths.
 * @returns The repository-relative paths written during this call.
 * @throws When the JSON is malformed, an update is invalid, or a target path
 * escapes `outputRoot`.
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

/** Parses the raw LLM response and validates its top-level `updates` array. */
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

/** Validates one untrusted array item and converts it to the public update type. */
function validateUpdate(value: unknown, index: number): MarkdownUpdate {
  if (!isRecord(value) || typeof value.target_file !== "string" || typeof value.content !== "string") {
    throw new Error(`Update ${index} must include string target_file and content fields.`);
  }

  return { target_file: value.target_file, content: value.content };
}

/**
 * Converts a repository-relative Markdown path to an absolute path while
 * rejecting absolute paths and lexical attempts to escape the repository.
 */
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

/** Type guard for plain JSON objects used by the parser and validators. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
