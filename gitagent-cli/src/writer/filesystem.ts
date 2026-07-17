import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface MarkdownUpdate {
  target_file: string;
  content: string;
}

export interface MarkdownOperationResult {
  written: string[];
}

type PreparedUpdate = MarkdownUpdate & { absolutePath: string };

export function applyMarkdownUpdates(
  updates: MarkdownUpdate[],
  outputRoot: string,
): MarkdownOperationResult {
  const root = resolve(outputRoot);
  const seenPaths = new Set<string>();
  const prepared: PreparedUpdate[] = [];

  for (const [index, update] of updates.entries()) {
    let absolutePath: string;
    try {
      absolutePath = resolveMarkdownPath(root, update.target_file, index);
    } catch (e) {
      console.warn(`[gitagent] Skipping invalid path "${update.target_file}": ${(e as Error).message}`);
      continue;
    }
    if (seenPaths.has(absolutePath)) {
      console.warn(`[gitagent] Skipping duplicate target file "${update.target_file}".`);
      continue;
    }
    seenPaths.add(absolutePath);
    prepared.push({ ...update, absolutePath });
  }

  const result: MarkdownOperationResult = { written: [] };
  for (const update of prepared) {
    mkdirSync(dirname(update.absolutePath), { recursive: true });
    writeFileSync(update.absolutePath, update.content, 'utf8');
    result.written.push(update.target_file);
  }

  return result;
}

function resolveMarkdownPath(root: string, inputPath: string, operationIndex: number): string {
  if (
    !inputPath ||
    isAbsolute(inputPath) ||
    !inputPath.endsWith('.md') ||
    !inputPath.startsWith('.gitagent/')
  ) {
    throw new Error(
      `Operation ${operationIndex}: path must be a relative .md file path under .gitagent/.`,
    );
  }

  const absolutePath = resolve(root, inputPath);
  const pathFromRoot = relative(root, absolutePath);
  if (
    pathFromRoot === '' ||
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Operation ${operationIndex}: path escapes the output root.`);
  }

  return absolutePath;
}
