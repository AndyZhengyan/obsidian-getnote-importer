# Repository Instructions

This repository contains `obsidian-getnote-importer`, a TypeScript Obsidian plugin that syncs GetNote notes into a local Obsidian vault.

## Mandatory GitHub Workflow

- Never push directly to `main`.
- All code, workflow, documentation, release, and automation changes must go through a pull request targeting `main`.
- Work on branches prefixed with `codex/` unless the user explicitly asks for a different branch name.
- After pushing a branch, create a pull request and share the PR URL.
- Merge only after required checks pass and the user explicitly approves the merge.
- If the user says "提交", interpret it as commit and push the current feature branch, not direct push to `main`.
- If the user says "merge", confirm whether they mean merging an existing PR unless they explicitly say to bypass PR.

## Project Shape

- `src/main.tsx` wires the plugin lifecycle, commands, settings, and sync history.
- `src/sync.ts` owns GetNote-to-vault sync behavior and must be treated as high risk.
- `src/api.ts`, `src/note-parser.ts`, and `src/types.ts` contain API parsing and shared contracts.
- `src/ui/` and `src/settings/` contain Obsidian modal and settings UI implemented with Preact-compatible React APIs.
- Tests live in `tests/` and adjacent `src/*.test.ts` files.

## Required Checks

Run these before proposing a pull request or claiming a fix is complete:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Run this after editing GitHub Actions workflows:

```bash
actionlint
```

## Engineering Rules

- Keep changes small and scoped to the issue or review comment.
- Preserve existing Obsidian vault data. Do not overwrite user notes unless the existing sync contract explicitly allows it.
- Be careful with GetNote IDs and timestamps. Large numeric IDs may exceed JavaScript safe integer precision, so prefer string-preserving parsing and comparisons.
- Add or update focused tests for sync, parser, settings, modal, or i18n behavior changes.
- Do not bump `package.json` or `manifest.json` versions unless the task is explicitly about releasing.
- Release artifacts are `main.js`, `manifest.json`, and `styles.css`.

## Local Memory

- Keep claude-mem or other dynamic session memory out of tracked repository files.
- Local claude-mem context for this workspace should be written to `.claude-mem-context.md`, which is ignored by Git.
