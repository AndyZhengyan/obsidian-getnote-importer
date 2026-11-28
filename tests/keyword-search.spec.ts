import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterKeywordSearchPage, searchKeywordPage } from '../src/keyword-search';
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('matches ASCII I independently of the host locale', () => {
    vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string) {
      return this.replaceAll('I', 'ı').toLowerCase();
    });

    const page = filterKeywordSearchPage('istanbul', {
      notes: [note('1909193892067130517', { title: 'Istanbul knowledge base' })],
      hasMore: false,
    });

    expect(page.results.map(result => result.note_id)).toEqual(['1909193892067130517']);
  });

  it('stops paging when a remote page has no cursor progress', () => {
    const page = filterKeywordSearchPage('agent', { notes: [], hasMore: true });
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});

describe('searchKeywordPage', () => {
  it('fills missing text using detail IDs and retains the list cursor', async () => {
    const refId = '1909193892067130512';
    const lastId = '1909193892067130515';
    const signal = new AbortController().signal;
    const fetchDetail = vi.fn(async (id: string, _signal: AbortSignal): Promise<Partial<GetNoteNote>> =>
      id === 'ref-prime'
        ? { note_id: 'different-detail-id', title: '引用', content: 'Agent 引用正文' }
        : { title: 'Agent 普通笔记' });

    const result = await searchKeywordPage('agent', {
      notes: [
        note(refId, { note_type: 'ref', prime_id: 'ref-prime' }),
        note('1909193892067130513', { title: 'Agent 列表结果', content: '正文' }),
        note(lastId, { content: '保留列表正文' }),
      ],
      hasMore: true,
    }, fetchDetail, signal);

    expect(fetchDetail.mock.calls).toEqual([['ref-prime', signal], [lastId, signal]]);
    expect(result.results.map(({ note_id, title, content }) => [note_id, title, content])).toEqual([
      [refId, '引用', 'Agent 引用正文'],
      ['1909193892067130513', 'Agent 列表结果', '正文'],
      [lastId, 'Agent 普通笔记', '保留列表正文'],
    ]);
    expect(result.nextCursor).toBe(lastId);
    expect(result.hasMore).toBe(true);
  });
});
