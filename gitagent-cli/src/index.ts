import { Command } from 'commander';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { GitClient } from './git/gitClient.js';
import { GitAgentAIClient } from './ai/client.js';
import { filterJunk } from './parser/diffFilter.js';
import { applyMarkdownUpdates } from './writer/filesystem.js';
import type { CurrentContext } from './ai/client.js';

function safeRead(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function loadContext(subDir: string, repoRoot: string): CurrentContext {
  const rulesDir = join(repoRoot, '.gitagent', 'rules');
  const memoryDir = join(repoRoot, '.gitagent', 'memory');
  const skillsDir = join(repoRoot, '.gitagent', 'skills', subDir);

  const rules = [
    safeRead(join(rulesDir, 'global.md')),
    subDir !== 'global' ? safeRead(join(rulesDir, `${subDir}.md`)) : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const memory = [
    safeRead(join(memoryDir, 'global.md')),
    subDir !== 'global' ? safeRead(join(memoryDir, `${subDir}.md`)) : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  let skills = '';
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    skills = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => safeRead(join(skillsDir, e.name)))
      .filter(Boolean)
      .join('\n\n');
  } catch {
    // skills directory doesn't exist — empty string is fine
  }

  return { rules, memory, skills };
}

const program = new Command();

program
  .name('gitagent')
  .description('GitAgent — auto-generate AI context files from your git commits')
  .version('1.0.0');

program
  .command('run-hook')
  .description('Invoked by the pre-commit hook: extract staged diff, classify, and update harness files')
  .action(async () => {
    const git = new GitClient();

    if (!(await git.validateGitEnvironment())) {
      console.error('[gitagent] Not a git repository — skipping.');
      return;
    }

    console.log('[gitagent] pre-commit hook triggered');

    const summary = await git.getDiffSummary();
    const filtered = filterJunk(summary.files).filter(
      (f) => !f.isBinary && f.diff.trim().length > 0,
    );

    if (filtered.length === 0) {
      console.log('[gitagent] No meaningful staged changes — skipping.');
      return;
    }

    console.log(`[gitagent] ${filtered.length} staged file(s) after junk filter:`);
    for (const f of filtered) {
      console.log(`           ${f.status}  ${f.file}`);
    }

    const rawDiff = filtered.map((f) => f.diff).join('\n');
    const repoRoot = summary.repoRoot;

    try {
      const ai = new GitAgentAIClient();
      const result = await ai.analyzeDiff(rawDiff, (subDir) => loadContext(subDir, repoRoot));

      console.log(
        `[gitagent] LLM 1: change_required=${result.assessment.change_required}` +
          (result.assessment.changes.length > 0
            ? `, scopes=${result.assessment.changes.map((c) => c.sub_directory).join(', ')}`
            : ''),
      );

      const updates = result.updates.filter((u) => u.target_file.startsWith(".gitagent/rules/"));

      if (updates.length === 0) {
        console.log('[gitagent] No harness files to update.');
        return;
      }

      const { written } = applyMarkdownUpdates(updates, repoRoot);

      console.log(`[gitagent] Wrote ${written.length} harness file(s):`);
      for (const f of written) {
        console.log(`           ${f}`);
      }

      const absPaths = written.map((f) => join(repoRoot, f));
      await git.stageFiles(absPaths);
      console.log('[gitagent] Re-staged harness files into the commit.');
    } catch (error) {
      console.error('[gitagent] AI step failed — skipping harness update:', error);
    }
  });

program.parseAsync(process.argv);
