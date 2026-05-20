# Security Policy

Thank you for helping keep GetNote Importer and its users safe. This plugin can
handle Obsidian vault files and GetNote credentials, so security reports are
treated with priority and care.

## Supported Versions

Security fixes are released for the latest published version of GetNote
Importer. Please upgrade to the newest release before reporting an issue that
may already have been fixed.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | Best effort only |

## Reporting a Vulnerability

Please do not open a public issue for suspected vulnerabilities.

Use one of these private channels instead:

1. Open a GitHub security advisory report with **Report a vulnerability** on
   this repository's Security page, if available.
2. If private vulnerability reporting is not available, email the maintainer at
   the contact address listed on the maintainer's GitHub profile.

Include as much detail as you can safely share:

- Affected version, Obsidian version, operating system, and whether the issue
  appears on desktop, mobile, or both.
- A clear description of the impact.
- Reproduction steps, proof-of-concept input, logs, screenshots, or a minimal
  test vault when relevant.
- Whether any GetNote token, authorization header, vault file, synced note, or
  downloaded attachment was exposed.
- Any workaround you have already found.

Do not include live GetNote credentials, bearer tokens, private notes, or vault
contents unless we have explicitly agreed on a secure way to exchange them.
Redacted examples are strongly preferred.

## Response Expectations

Best effort response targets:

| Step | Target |
| --- | --- |
| Initial acknowledgement | Within 7 days |
| Triage and severity assessment | Within 14 days |
| Fix or mitigation plan | After validation, based on severity and complexity |
| Public disclosure | After a fix is available or a coordinated disclosure date is agreed |

If a report is accepted, we will try to keep you informed while we investigate,
prepare a fix, and publish a release. If the issue does not qualify as a
security vulnerability, we may redirect it to a regular GitHub issue.

## Scope

In scope:

- Leaks of GetNote OpenAPI tokens, web authorization headers, or OAuth-related
  data.
- Unintended writes, overwrites, deletion, or path traversal affecting files in
  an Obsidian vault.
- Unsafe handling of downloaded attachments, transcripts, links, Markdown, or
  frontmatter produced by synced notes.
- Cross-platform behavior that weakens security on Obsidian desktop or mobile.
- Supply-chain issues in release artifacts or runtime dependencies.

Out of scope:

- Vulnerabilities in Obsidian, GetNote, browsers, operating systems, or network
  infrastructure outside this plugin's control.
- Reports that require a compromised local machine, malicious Obsidian
  installation, or attacker-controlled plugin environment without a plugin
  vulnerability.
- Social engineering, phishing, spam, denial-of-service, or physical attacks.
- Scanner-only reports without a concrete impact on this project.

## Safe Research Guidelines

Please:

- Test only against your own Obsidian vault, GetNote account, and local
  environment.
- Avoid destructive tests against real notes, attachments, or vault data.
- Stop testing and report promptly if you encounter private user data,
  credentials, or content that is not yours.
- Give the maintainer reasonable time to validate and fix the issue before
  public disclosure.
- Do not attempt to access, modify, or exfiltrate data belonging to other users.

## Security Practices for Users

- Keep GetNote Importer updated through Obsidian Community Plugins or the latest
  GitHub release.
- Treat GetNote tokens and copied web authorization headers like passwords.
- Prefer the official OpenAPI mode when available.
- If using Web mode, refresh and replace the copied authorization header if you
  suspect it was exposed.
- Install releases only from Obsidian Community Plugins or this repository's
  GitHub Releases page.
- Back up your vault before running large imports or changing sync settings.

## Disclosure and Credit

We appreciate responsible reports. With your permission, accepted
vulnerability reports may be credited in the release notes, GitHub advisory, or
both.
