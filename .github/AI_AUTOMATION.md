# AI Automation

This repository uses Codex as an autonomous maintenance system.

## Workflows

- `Codex Agent`: triages issues, responds to `/codex` or `/ai`, creates focused branches, pushes fixes, and opens pull requests.
- `Codex Review`: reviews pull requests and submits a formal GitHub review with `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`.
- `Codex AutoMerge`: merges eligible pull requests after the merge gates pass.

## Labels

- `ai-autofix`: lets Codex update a pull request branch in response to valid review feedback.
- `ai-automerge`: lets Codex merge the pull request after required checks pass and an independent approving review exists.

## Recommended Secrets

Use separate GitHub App installation tokens or fine-grained bot tokens so the author, reviewer, and merger are different identities:

- `CODEX_AGENT_TOKEN`: creates branches, pushes commits, comments, and opens pull requests.
- `CODEX_REVIEW_TOKEN`: submits pull request reviews.
- `CODEX_MERGE_TOKEN`: merges pull requests after all gates pass.

If these secrets are not configured, the workflows fall back to `GITHUB_TOKEN`. That is useful for testing, but it may not satisfy required review rules when the same bot both authors and reviews a pull request.

## Merge Gates

`Codex AutoMerge` only attempts a squash merge when:

- the pull request targets `main`;
- the pull request is open and not draft;
- the `ai-automerge` label is present;
- at least one latest review is approved;
- no latest review requests changes;
- commit statuses and check runs for the head commit are successful.

Branch rules on `main` remain the final source of truth. If GitHub refuses the merge, the workflow logs the reason and leaves the pull request open.
