import { basename } from 'path';
import type { StagedChange } from '../git/gitClient.js';

const JUNK_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.DS_Store',
]);

const JUNK_DIR_SEGMENTS = new Set(['node_modules', 'dist', 'build', '.next']);

export function isJunkFile(filePath: string): boolean {
  if (JUNK_FILENAMES.has(basename(filePath))) return true;
  return filePath.split('/').some((seg) => JUNK_DIR_SEGMENTS.has(seg));
}

export function filterJunk(files: StagedChange[]): StagedChange[] {
  return files.filter((f) => !isJunkFile(f.file));
}
