# GitAgent MVP: Architecture & Context One-Pager

## 1. Project Vision & Goal
GitAgent is a local Node.js CLI tool that runs invisibly during standard Git workflows to dynamically generate and maintain AI context files. It intercepts `git commit` operations, analyzes the code diffs using an LLM, and automatically writes repository-specific rules, memory logs, and skills into standard AI configuration files. The goal is to solve AI context window bloat and team misalignment by using the repository as the single source of truth for agent memory.

## 2. Target Agent Environment (Devin)
GitAgent generates context that AI agents ingest. For this MVP, we are targeting Devin's native configuration structure. GitAgent must interact with the following standards:

*   **Configuration Format**: Devin uses JSON files (with comment support) for all primary configurations.
*   **User Settings**: Global agent behaviors and models are stored in `~/.config/devin/config.json`.
*   **Project Settings**: Shared project configurations are stored in `.devin/config.json` at the project root and committed to version control.
*   **Local Overrides**: Personal project overrides (like API keys) go in `.devin/config.local.json`, which is automatically gitignored.
*   **Agent Context & Rules**: `AGENTS.md` is the recommended standard file placed in the project root to provide context, coding standards, and persistent instructions, acting as a README for agents.
*   **Personal Rules**: Developer-specific instructions that shouldn't be shared with the team belong in `AGENTS.local.md`.
*   **Cross-Tool Compatibility**: Devin CLI natively reads and supports configuration formats from other tools, including Cursor (`.cursor/rules/`), Windsurf (`.windsurfrules`), and Claude Code (`CLAUDE.md`).
*   **Playbooks**: Step-by-step standard operating procedures, execution rules, and constraints for recurring tasks are defined in Markdown files using a `.devin.md` extension.
*   **Tool Integrations**: Devin supports the Model Context Protocol (MCP) to securely connect to external databases, APIs, and services.

## 3. GitAgent Core Architecture Flow
GitAgent operates as a synchronous, blocking local pipeline triggered entirely by a Git hook.

1.  **The Interceptor (`pre-commit` hook)**: Runs automatically when a developer executes `git commit`. Extracts the staged file changes using `git diff --cached`.
2.  **The Pre-Processor (Noise Gate)**: Filters out lockfiles, strips unstaged files, and structurally parses config files (like `package.json`) to extract only the modified keys.
3.  **The Taxonomy Judge (LLM Prompt 1)**: Evaluates the clean diff payload to determine if the change introduces core architecture patterns, conventions, or best practices. Aborts immediately if the change is generic business logic.
4.  **The Consolidator (LLM Prompt 2)**: Reads the current `.md` rule/memory files in the target directory, compares them against the diff, and outputs a strict JSON array of CRUD operations (Create, Update, Delete).
5.  **Virtual File System Mutator**: Executes the CRUD operations by writing plain-text Markdown files directly to the file system (e.g., generating new `AGENTS.md` rules or `.devin.md` playbooks).
6.  **Git Index Restorer**: Automatically stages the newly generated Markdown files using `git add` and allows the atomic commit to complete successfully.

## 4. Tech Stack Requirements
*   **Runtime**: Node.js (v20+) with TypeScript.
*   **CLI Framework**: `commander` (solely for routing manual setup commands like `gitagent init`).
*   **Git Integration**: `simple-git` (for reliable diff extraction and staging).
*   **LLM Orchestration**: Standard SDKs (`@anthropic-ai/sdk` or `openai`) using strict JSON output formatting. No LangChain.

## 5. Team Execution Milestones (4-Person Delegation)
To complete this MVP in 12 hours, the architecture is split into four distinct, parallelized modules:

*   **Milestone 1 (The Skeleton)**: Install the `pre-commit` hook, extract a diff via `simple-git`, and write a hardcoded mock `.md` file to prove the background loop works.
*   **Milestone 2 (The Filter & Judge)**: Build the diff-cleaning parser, make the first API call to the Taxonomy Judge, and successfully categorize the codebase change in terminal output.
*   **Milestone 3 (The Generator)**: Pass existing repo context and the new diff to the Consolidator LLM, parse the JSON response, dynamically write the actual Markdown files, and `git add` them to the commit.
*   **Milestone 4 (The Wow Factor)**: Build the `gitagent init` manual CLI command to scan a fresh repository, generate an initial `AGENTS.md` context file, and automatically install the background hook.