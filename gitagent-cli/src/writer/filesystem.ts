import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface TextPatch {
  oldText: string;
  newText: string;
}

export interface CreateMarkdownOperation {
  action: "create";
  path: string;
  content: string;
}

export interface UpdateMarkdownOperation {
  action: "update";
  path: string;
  patches: TextPatch[];
}

export interface DeleteMarkdownOperation {
  action: "delete";
  path: string;
}

export type MarkdownOperation =
  | CreateMarkdownOperation
  | UpdateMarkdownOperation
  | DeleteMarkdownOperation;

export interface MarkdownOperationResult {
  created: string[];
  updated: string[];
  deleted: string[];
}

type PreparedOperation =
  | { action: "create"; path: string; absolutePath: string; content: string }
  | { action: "update"; path: string; absolutePath: string; content: string }
  | { action: "delete"; path: string; absolutePath: string };

/**
 * Applies Markdown create, update, and delete operations returned by the LLM.
 * Update patches must match exactly once in the file content produced by the
 * preceding patch, so an ambiguous instruction never changes the wrong section.
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

    switch (operation.action) {
      case "create":
        prepared.push({ ...operation, absolutePath });
        break;
      case "update": {
        if (!existsSync(absolutePath)) {
          throw new Error(`Operation ${index}: cannot update missing file \"${operation.path}\".`);
        }

        let content = readFileSync(absolutePath, "utf8");
        for (const [patchIndex, patch] of operation.patches.entries()) {
          content = applyPatch(content, patch, operation.path, patchIndex);
        }
        prepared.push({ action: "update", path: operation.path, absolutePath, content });
        break;
      }
      case "delete":
        if (!existsSync(absolutePath)) {
          throw new Error(`Operation ${index}: cannot delete missing file \"${operation.path}\".`);
        }
        prepared.push({ ...operation, absolutePath });
        break;
    }
  }

  const result: MarkdownOperationResult = { created: [], updated: [], deleted: [] };
  for (const operation of prepared) {
    switch (operation.action) {
      case "create":
        mkdirSync(dirname(operation.absolutePath), { recursive: true });
        writeFileSync(operation.absolutePath, operation.content, "utf8");
        result.created.push(operation.path);
        break;
      case "update":
        mkdirSync(dirname(operation.absolutePath), { recursive: true });
        writeFileSync(operation.absolutePath, operation.content, "utf8");
        result.updated.push(operation.path);
        break;
      case "delete":
        unlinkSync(operation.absolutePath);
        result.deleted.push(operation.path);
        break;
    }
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

  switch (value.action) {
    case "create":
      if (typeof value.content !== "string") {
        throw new Error(`Operation ${index}: create requires string content.`);
      }
      return { action: "create", path: value.path, content: value.content };
    case "update":
      if (!Array.isArray(value.patches) || value.patches.length === 0) {
        throw new Error(`Operation ${index}: update requires a non-empty patches array.`);
      }
      return {
        action: "update",
        path: value.path,
        patches: value.patches.map((patch, patchIndex) => validatePatch(patch, index, patchIndex)),
      };
    case "delete":
      return { action: "delete", path: value.path };
    default:
      throw new Error(`Operation ${index}: unsupported action \"${value.action}\".`);
  }
}

function validatePatch(value: unknown, operationIndex: number, patchIndex: number): TextPatch {
  if (
    !isRecord(value) ||
    typeof value.oldText !== "string" ||
    typeof value.newText !== "string" ||
    value.oldText.length === 0
  ) {
    throw new Error(
      `Operation ${operationIndex}, patch ${patchIndex}: oldText must be non-empty and newText must be a string.`,
    );
  }

  return { oldText: value.oldText, newText: value.newText };
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

function applyPatch(content: string, patch: TextPatch, path: string, patchIndex: number): string {
  const firstMatch = content.indexOf(patch.oldText);
  if (firstMatch === -1) {
    throw new Error(`Patch ${patchIndex} for \"${path}\" did not match any text.`);
  }

  if (content.indexOf(patch.oldText, firstMatch + 1) !== -1) {
    throw new Error(
      `Patch ${patchIndex} for \"${path}\" is ambiguous: oldText matched multiple locations. Include more surrounding Markdown context.`,
    );
  }

  return `${content.slice(0, firstMatch)}${patch.newText}${content.slice(firstMatch + patch.oldText.length)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
