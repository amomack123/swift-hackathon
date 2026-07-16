import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** A complete Markdown file produced by the consolidator. */
export interface CreateMarkdownOperation {
  action: "create";
  path: string;
  content: string;
}

export type MarkdownOperation = CreateMarkdownOperation;

export interface MarkdownOperationResult {
  written: string[];
}

type PreparedOperation = CreateMarkdownOperation & { absolutePath: string };

/**
 * Writes complete Markdown files returned by the LLM.
 *
 * `content` replaces the current file contents when the file already exists,
 * and creates the file when it does not.
 */
export function applyMarkdownOperations(
  json: string,
  outputRoot: string,
): MarkdownOperationResult {
  const operations = parseOperations(json);
  const root = resolve(outputRoot);
  const seenPaths = new Set<string>();
  const prepared: PreparedOperation[] = [];

  for (const [index, operation] of operations.entries()) {
    const absolutePath = resolveMarkdownPath(root, operation.path, index);
    if (seenPaths.has(absolutePath)) {
      throw new Error(`Operation ${index}: duplicate target path \"${operation.path}\".`);
    }

    seenPaths.add(absolutePath);
    prepared.push({ ...operation, absolutePath });
  }

  const result: MarkdownOperationResult = { written: [] };
  for (const operation of prepared) {
    mkdirSync(dirname(operation.absolutePath), { recursive: true });
    writeFileSync(operation.absolutePath, operation.content, "utf8");
    result.written.push(operation.path);
  }

  return result;
}

function parseOperations(json: string): MarkdownOperation[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Markdown operations must be valid JSON.");
  }

  if (!Array.isArray(value)) {
    throw new Error("Markdown operations must be a JSON array.");
  }

  return value.map((operation, index) => validateOperation(operation, index));
}

function validateOperation(value: unknown, index: number): MarkdownOperation {
  if (!isRecord(value) || typeof value.action !== "string" || typeof value.path !== "string") {
    throw new Error(`Operation ${index} must include string action and path fields.`);
  }

  if (value.action !== "create") {
    throw new Error(`Operation ${index}: unsupported action \"${value.action}\". Only \"create\" is supported.`);
  }
  if (typeof value.content !== "string") {
    throw new Error(`Operation ${index}: create requires string content.`);
  }

  return { action: "create", path: value.path, content: value.content };
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
