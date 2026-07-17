# GitAgent LVP: Architecture & Context One-Pager

## 1. Project Vision & Goal
GitAgent is a local Node.js CLI tool that runs invisibly during standard Git workflows to dynamically generate and maintain AI context files. It intercepts `git commit` operations, analyzes the code diffs using an LLM, and automatically writes repository-specific rules, memory logs, and skills into Markdown files. The goal is to solve AI context window bloat and team misalignment by using the repository as the single source of truth for agent memory.

## 2. Target Output Structure (Tool-Agnostic, LVP)
For the LVP, GitAgent does **not** target any IDE-native config format (Windsurf's `.windsurf/rules/`, Devin's `.devin/`, Cursor's `.cursor/rules/`, etc). It writes to its own convention under a `.gitagent/` root, committed to version control like any other repo file:

*   **Rules** ("The Law" — strict, immutable instructions): `.gitagent/rules/{scope}.md`, plus `.gitagent/rules/global.md` for cross-cutting rules.
*   **Memory** ("The Journal" — living context, state, history): `.gitagent/memory/{scope} memory.md`, plus `.gitagent/memory/global.md`.
*   **Skills** ("The SOP" — step-by-step execution workflows): `.gitagent/skills/{scope}/`, a folder that can hold multiple Markdown files per scope.

`scope` is a sub-directory name (e.g. `auth`, `database`) inferred per-commit by the LLM router, not a fixed taxonomy.

Mapping this output onto a specific IDE's native format (e.g. Windsurf's `.windsurf/rules/*.md` with `trigger` frontmatter, or Devin's config) is explicitly deferred — that's free to add later since it only changes which path strings the Writer targets, not the pipeline itself. Development and testing for the LVP happens in VS Code, not inside any AI-native IDE.

## 3. GitAgent Core Architecture Flow
GitAgent operates as a synchronous, blocking local pipeline triggered entirely by a Git hook. There is no `gitagent init` command for the LVP — target Markdown files are hand-created for testing.

1.  **The Interceptor (`pre-commit` hook)**: Runs automatically when a developer executes `git commit`. Extracts the staged file changes and their diffs via `git diff --cached`.
2.  **The Junk Filter (Task A)**: Acts like a `.gitignore` for the CLI itself — drops files with no bearing on architecture or conventions (lockfiles, `.DS_Store`, `node_modules/`, build output) before anything reaches an LLM. No structural JSON/YAML key-extraction and no context-window truncation for the LVP; the remaining diffs are passed through as-is.
3.  **LLM 1 — The Judge & Router**: Takes the filtered diff and returns `{ change_required: boolean, changes: [{ sub_directory, reason }] }`. A single commit can flag multiple scopes (e.g. a PR touching both `auth` and `database`).
4.  **Node Orchestration Loop**: For each `{ sub_directory, reason }` LLM 1 returns, the script sequentially reads that scope's current context — `.gitagent/rules/{scope}.md`, `.gitagent/memory/{scope} memory.md`, the two `global.md` files, and everything under `.gitagent/skills/{scope}/` — then makes one isolated call to LLM 2. Looping per scope (instead of batching all scopes into one call) keeps each LLM 2 prompt small and focused.
5.  **LLM 2 — The Consolidator**: Given the diff, the `reason` as intent, and the scope's current files, returns `{ updates: [{ target_file, content }] }` — fully rewritten Markdown per file, constrained to the `.gitagent/` path convention. No CREATE/UPDATE/DELETE distinction and no duplication checks for the LVP; every entry is a blind overwrite.
6.  **The Writer**: Iterates `updates[]` and `fs.writeFileSync`s each `target_file`, creating parent directories as needed.
7.  **Git Index Restorer**: Automatically stages the newly written Markdown files with `git add` and allows the commit to complete.

## 4. Tech Stack Requirements
*   **Runtime**: Node.js (v20+) with TypeScript.
*   **CLI Framework**: `commander` (routing the `run-hook` command).
*   **Git Integration**: `simple-git` (for diff extraction and staging).
*   **LLM Orchestration**: Standard SDKs (`@anthropic-ai/sdk` or `openai`) using strict JSON output formatting. No LangChain.

## 5. Build Sequence (LVP)
1.  **Task A — Junk Filter** (`src/parser/diffFilter.ts`): `FileDiff` type, junk filename/directory lists, `isJunkFile` matcher, `filterJunk` function.
2.  **Diff Extraction** (`src/git/gitClient.ts`): run `git diff --cached` and shape the output into `FileDiff[]`.
3.  **LLM 1 — Judge & Router** (`src/ai/`): prompt, response types, JSON-enforced call wrapper.
4.  **Node Orchestration**: the per-scope `for` loop and file reads described above.
5.  **LLM 2 — Consolidator** (`src/ai/`): prompt, response types.
6.  **Writer** (`src/writer/filesystem.ts`): blind `fs.writeFileSync` per update.
7.  **Wiring** (`src/index.ts`): `run-hook` command chaining every step above, plus the actual pre-commit hook script.
8.  **End-to-end manual test**: hand-crafted `.gitagent/rules/*.md` and `.gitagent/memory/*.md` fixtures, a real commit touching a known scope, verify the loop runs and rewrites files sanely.

Deferred to v2: `gitagent init`, context truncation for large diffs, duplication checks in generated Markdown, structural JSON/YAML config parsing (Task B), CRUD-aware writes, and IDE-native output paths (Windsurf, Devin, Cursor, etc).
