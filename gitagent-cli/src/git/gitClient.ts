import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { resolve, extname } from 'path';

export interface StagedChange {
  file: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U';
  diff: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  extension: string;
  oldFile?: string;
}

export interface DiffSummary {
  files: StagedChange[];
  repoRoot: string;
}

function parseNumstat(line: string): { additions: number; deletions: number; isBinary: boolean } {
  const [addRaw, delRaw] = line.split('\t');
  if (addRaw === '-' || delRaw === '-') {
    return { additions: 0, deletions: 0, isBinary: true };
  }
  return {
    additions: Number(addRaw) || 0,
    deletions: Number(delRaw) || 0,
    isBinary: false,
  };
}

export class GitClient {
  private git: SimpleGit;

  constructor(repoPath: string = process.cwd()) {
    this.git = simpleGit(resolve(repoPath));
  }

  async getStagedFiles(): Promise<StagedChange[]> {
    try {
      const status = await this.git.status();
      const root = await this.getRepoRoot();
      const stagedFiles: StagedChange[] = [];

      if (status.files) {
        for (const file of status.files) {
          if (file.index !== ' ' && file.index !== '?') {
            const absPath = resolve(root, file.path);
            const pathArgs = file.from ? [resolve(root, file.from), absPath] : [absPath];
            const diff = await this.git.diff(['--cached', '--', ...pathArgs]);
            const numstatRaw = await this.git.raw(['diff', '--cached', '--numstat', '--', ...pathArgs]);
            const { additions, deletions, isBinary } = parseNumstat(numstatRaw.trim());

            stagedFiles.push({
              file: file.path,
              status: (file.index as StagedChange['status']) || 'M',
              diff,
              additions,
              deletions,
              isBinary,
              extension: extname(file.path),
              ...(file.from ? { oldFile: file.from } : {}),
            });
          }
        }
      }

      return stagedFiles;
    } catch (error) {
      console.error('Error getting staged files:', error);
      throw new Error('Failed to retrieve staged files from git');
    }
  }

  async getDiffSummary(): Promise<DiffSummary> {
    try {
      const [files, repoRoot] = await Promise.all([this.getStagedFiles(), this.getRepoRoot()]);
      return { files, repoRoot };
    } catch (error) {
      console.error('Error generating diff summary:', error);
      throw new Error('Failed to generate diff summary');
    }
  }

  async getRawStagedDiff(): Promise<string> {
    return await this.git.diff(['--cached']);
  }

  async stageFiles(filePaths: string[]): Promise<void> {
    try {
      await this.git.add(filePaths);
    } catch (error) {
      console.error('Error staging files:', error);
      throw new Error('Failed to stage files');
    }
  }

  async getRepoRoot(): Promise<string> {
    try {
      const root = await this.git.revparse(['--show-toplevel']);
      return root.trim();
    } catch (error) {
      console.error('Error getting repo root:', error);
      throw new Error('Failed to determine git repository root');
    }
  }

  async validateGitEnvironment(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }
}
