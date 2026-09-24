/** An explicitly archived local copy must never participate in sync identity ownership. */
export function isArchivedSyncNote(raw: string): boolean {
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  return Boolean(frontmatter && /^dedao_sync_archived:[ \t]*true[ \t]*(?:#.*)?$/m.test(frontmatter[1]));
}
