// Prompts, schemas, & OpenAI/Anthropic SDK calls

Key Information for AI Component Owner:
1. Input Data Contract — What they'll receive from gitClient:

// The main payload from the Interceptor
interface DiffSummary {
  files: StagedChange[]           // Array of changed files
  totalChanges: number            // Count of files changed
  rawDiff: string                 // Full unified diff (for context)
}

interface StagedChange {
  file: string                    // File path (e.g., "src/index.ts")
  status: 'A'|'M'|'D'|'R'|'C'|'U' // Git status code
  diff: string                    // Individual file diff
}
2. Primary Entry Point:

const gitClient = new GitClient(repoPath);
const diffSummary = await gitClient.getDiffSummary();
// Pass diffSummary to LLM prompts (Taxonomy Judge & Consolidator)
3. Additional Context Available:
The AI person can request:

getCurrentBranch() — For branch-specific rules
getLastCommitMessage() — For recent context
getRepoRoot() — For reading existing AGENTS.md / .devin.md files
4. Output Requirements:
They need to return structured data that the filesystem writer can consume:

CRUD operations (Create/Update/Delete) on Markdown files
File paths relative to repo root
Generated content ready for direct write