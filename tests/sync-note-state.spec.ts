import { describe, expect, it } from 'vitest';
import { isArchivedSyncNote } from '../src/sync-note-state';

describe('local sync archive marker', () => {
  it.each(['\n', '\r\n'])('reads a true marker from raw frontmatter using %j', newline => {
    expect(isArchivedSyncNote(['\uFEFF---', 'uid: "1900000000000000100"', 'dedao_sync_archived: true', '---', 'body'].join(newline))).toBe(true);
  });
  it.each(['false', '"true"'])('does not archive a note with a non-boolean marker %s', value => {
    expect(isArchivedSyncNote(`---\ndedao_sync_archived: ${value}\n---\nbody`)).toBe(false);
  });
  it('ignores marker-like text in the body', () => {
    expect(isArchivedSyncNote('---\nuid: "1"\n---\ndedao_sync_archived: true')).toBe(false);
  });
});
