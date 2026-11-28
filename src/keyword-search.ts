import type { GetNoteNote, RecallSearchResult } from './types';

export interface KeywordSearchPage {
  results: RecallSearchResult[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface NoteListPage {
  notes: GetNoteNote[];
  hasMore: boolean;
}

export async function searchKeywordPage(
  query: string,
  page: NoteListPage,
  fetchDetail: (id: string, signal: AbortSignal) => Promise<Partial<GetNoteNote>>,
  signal: AbortSignal,
): Promise<KeywordSearchPage> {
  const notes: GetNoteNote[] = [];
  for (const note of page.notes) {
    signal.throwIfAborted();
    // The list endpoint may omit searchable text for highlights and text notes.
    if ((note.note_type === 'ref' || note.note_type === 'plain_text') && (!note.title || !note.content)) {
      const detail = await fetchDetail(note.prime_id ?? note.note_id, signal);
      notes.push({ ...note, title: note.title || detail.title || '', content: note.content || detail.content || '' });
    } else {
      notes.push(note);
    }
  }
  signal.throwIfAborted();
  return filterKeywordSearchPage(query, { notes, hasMore: page.hasMore });
}

export function filterKeywordSearchPage(
  query: string,
  page: NoteListPage,
): KeywordSearchPage {
  const needle = query.trim().normalize('NFKC').toLowerCase();
  const matches = (value: string | undefined) =>
    (value ?? '').normalize('NFKC').toLowerCase().includes(needle);
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
