// Pre-commit hook & raw git diffs
// As soon as someone makes a commit, the pre-commit hook will run and check for any issues
// in the code. It will also generate raw git diffs to show what changes have been made.
// This helps maintain code quality and ensures that only valid code is committed to the repository.

// As soon as someone writes .commit, this triggers and sees what files have been edited
// and cleans the files (keeping only the relevant files).

// ## 3. GitAgent Core Architecture Flow
// GitAgent operates as a synchronous, blocking local pipeline triggered entirely by a Git hook.
// **The Interceptor (`pre-commit` hook)**: Runs automatically when a developer executes `git commit`.
// Extracts the staged file changes using `git diff --cached`.
// **The Pre-Processor (Noise Gate)**: Filters out lockfiles, strips unstaged files,
// and structurally parses config files (like `package.json`) to extract only the modified keys.

import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { resolve } from 'path';

export interface StagedChange {
  file: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U'; // Added, Modified, Deleted, Renamed, Copied, Unmerged
  diff: string;
}

export interface DiffSummary {
  files: StagedChange[];
  totalChanges: number;
  rawDiff: string;
}

/**
 * GitClient handles all git operations needed by GitAgent.
 * This class is the Interceptor component that extracts staged changes
 * and manages file staging for the generated context files.
 */
export class GitClient {
  private git: SimpleGit;

  constructor(repoPath: string = process.cwd()) {
    this.git = simpleGit(resolve(repoPath));
  }

  /**
   * Gets the raw diff of staged changes using `git diff --cached`.
   * This is the primary entry point for the Interceptor component.
   * Returns the complete diff payload that will be passed to the Pre-Processor (Noise Gate).
   */
  async getStagedDiff(): Promise<string> {
    try {
      const diff = await this.git.diff(['--cached']);
      return diff;
    } catch (error) {
      console.error('Error getting staged diff:', error);
      throw new Error('Failed to retrieve staged git diff');
    }
  }

  /**
   * Gets a list of all staged files with their status and individual diffs.
   * This helps the Pre-Processor filter out lockfiles and unstaged changes.
   */
  async getStagedFiles(): Promise<StagedChange[]> {
    try {
      const status = await this.git.status();
      const stagedFiles: StagedChange[] = [];

      // Process files that are staged (in the index)
      if (status.files) {
        for (const file of status.files) {
          // Only include staged files
          if (file.index !== ' ' && file.index !== '?') {
            const diff = await this.git.diff(['--cached', file.path]);
            stagedFiles.push({
              file: file.path,
              status: (file.index as any) || 'M',
              diff: diff,
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

  /**
   * Gets the complete diff summary combining all staged changes.
   * This aggregates the raw diff and structured file list for the pipeline.
   */
  async getDiffSummary(): Promise<DiffSummary> {
    try {
      const rawDiff = await this.getStagedDiff();
      const files = await this.getStagedFiles();

      return {
        files,
        totalChanges: files.length,
        rawDiff,
      };
    } catch (error) {
      console.error('Error generating diff summary:', error);
      throw new Error('Failed to generate diff summary');
    }
  }

  /**
   * Stages a file for commit using `git add`.
   * This is used by the Virtual File System Mutator to stage newly generated
   * Markdown files (AGENTS.md, .devin.md playbooks, etc.) back into the commit.
   */
  async stageFile(filePath: string): Promise<void> {
    try {
      await this.git.add(filePath);
    } catch (error) {
      console.error(`Error staging file ${filePath}:`, error);
      throw new Error(`Failed to stage file: ${filePath}`);
    }
  }

  /**
   * Stages multiple files for commit.
   * Batch operation for staging all generated context files at once.
   */
  async stageFiles(filePaths: string[]): Promise<void> {
    try {
      await this.git.add(filePaths);
    } catch (error) {
      console.error('Error staging files:', error);
      throw new Error('Failed to stage files');
    }
  }

  /**
   * Gets the root directory of the git repository.
   * Useful for determining where to write context files.
   */
  async getRepoRoot(): Promise<string> {
    try {
      const root = await this.git.revparse(['--show-toplevel']);
      return root.trim();
    } catch (error) {
      console.error('Error getting repo root:', error);
      throw new Error('Failed to determine git repository root');
    }
  }

  /**
   * Checks if a path is in the git repository.
   * Validates that generated files can be tracked by git.
   */
  async isInRepo(filePath: string): Promise<boolean> {
    try {
      const root = await this.getRepoRoot();
      return resolve(filePath).startsWith(resolve(root));
    } catch {
      return false;
    }
  }

  /**
   * Gets the list of files that would be excluded by .gitignore.
   * Helps the Pre-Processor identify which files to filter out.
   */
  async getGitIgnoredFiles(): Promise<string[]> {
    try {
      const ignored = await this.git.raw(['ls-files', '--others', '--ignored', '--exclude-standard']);
      return ignored
        .split('\n')
        .filter((file) => file.trim().length > 0);
    } catch (error) {
      console.error('Error getting gitignored files:', error);
      return [];
    }
  }

  /**
   * Checks if the repository is in a valid state for running the hook.
   * Prevents running during merge conflicts or other unstable states.
   */
  async isRepoClean(): Promise<boolean> {
    try {
      const status = await this.git.status();
      return !status.conflicted || status.conflicted.length === 0;
    } catch {
      return false;
    }
  }

  /**
   * Gets the current branch name.
   * Useful for logging and debugging the hook execution context.
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim();
    } catch (error) {
      console.error('Error getting current branch:', error);
      throw new Error('Failed to determine current branch');
    }
  }

  /**
   * Gets the last commit message.
   * Can be used for context in the LLM prompts.
   */
  async getLastCommitMessage(): Promise<string> {
    try {
      const log = await this.git.log(['-1']);
      if (log.latest) {
        return log.latest.message.trim();
      }
      return '';
    } catch {
      return '';
    }
  }

  /**
   * Validates that git is available and the current directory is a git repository.
   * Should be called at the start of the pre-commit hook.
   */
  async validateGitEnvironment(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets the list of currently staged files with their short status.
   * Returns a simple object for quick access to staged file names.
   */
  async getStagedFilesList(): Promise<string[]> {
    try {
      const diff = await this.git.raw(['diff', '--cached', '--name-only']);
      return diff
        .split('\n')
        .filter((file) => file.trim().length > 0);
    } catch (error) {
      console.error('Error getting staged files list:', error);
      throw new Error('Failed to retrieve staged files list');
    }
  }
}

