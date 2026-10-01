import type { GetNoteNote, RecallSearchResult } from './types';

export interface KeywordSearchPage {
  results: RecallSearchResult[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function filterKeywordSearchPage(
  query: string,
  page: { notes: GetNoteNote[]; hasMore: boolean },
): KeywordSearchPage {
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase();
  const matches = (value: string | undefined) =>
    (value ?? '').normalize('NFKC').toLocaleLowerCase().includes(needle);
  const results = page.notes
    .filter(note => matches(note.title) || matches(note.content)
      || note.tags?.some(tag => matches(tag.name)))
    .map((note): RecallSearchResult => ({
      note_id: note.note_id,
      title: note.title,
      content: note.content,
      note_type: note.note_type,
      created_at: note.created_at,
      updated_at: note.updated_at,
    }));
  const nextCursor = page.notes.at(-1)?.note_id || null;
  return { results, nextCursor, hasMore: page.hasMore && Boolean(nextCursor) };
}
