import { describe, expect, it } from 'vitest';
import { filterKeywordSearchPage } from '../src/keyword-search';
import type { GetNoteNote } from '../src/types';

function note(noteId: string, overrides: Partial<GetNoteNote> = {}): GetNoteNote {
  return {
    id: noteId,
    note_id: noteId,
    title: '',
    content: '',
    note_type: 'plain_text',
    source: 'web',
    tags: [],
    created_at: '2026-09-01T00:00:00+08:00',
    updated_at: '2026-09-01T00:00:00+08:00',
    ...overrides,
  };
}

describe('filterKeywordSearchPage', () => {
  it('matches titles, bodies, and tags without changing large note IDs', () => {
    const page = filterKeywordSearchPage(' Agent ', {
      notes: [
        note('1909193892067130512', { title: 'Agent 工作流' }),
        note('1909193892067130513', { content: 'AI agent 编排' }),
        note('1909193892067130514', { tags: [{ name: 'AGENT' }] }),
        note('1909193892067130515', { title: '其他内容' }),
      ],
      hasMore: true,
    });

    expect(page.results.map(result => result.note_id)).toEqual([
      '1909193892067130512', '1909193892067130513', '1909193892067130514',
    ]);
    expect(page.nextCursor).toBe('1909193892067130515');
    expect(page.hasMore).toBe(true);
  });

  it('keeps an empty matching page navigable when more remote notes exist', () => {
    const page = filterKeywordSearchPage('agent', {
      notes: [note('1909193892067130516', { title: '无关笔记' })],
      hasMore: true,
    });

    expect(page.results).toEqual([]);
    expect(page.nextCursor).toBe('1909193892067130516');
    expect(page.hasMore).toBe(true);
  });

  it('stops paging when a remote page has no cursor progress', () => {
    const page = filterKeywordSearchPage('agent', { notes: [], hasMore: true });
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});
