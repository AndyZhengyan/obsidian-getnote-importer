import { describe, it, expect } from 'vitest';
import { generateDisplayTitle } from '../src/note-parser';
import type { GetNoteNote } from '../src/types';

function makeNote(overrides: Partial<GetNoteNote> = {}): GetNoteNote {
  return {
    id: '1',
    note_id: 'test-1',
    title: '测试笔记',
    content: '正文内容',
    note_type: 'plain_text',
    source: 'app',
    tags: [],
    created_at: '2026-04-27T22:26:17+08:00',
    updated_at: '2026-04-28T10:00:00+08:00',
    ...overrides,
  };
}

function filterNotes(notes: GetNoteNote[], query: string): GetNoteNote[] {
  if (!query) return notes;
  return notes.filter(n =>
    generateDisplayTitle(n).toLowerCase().includes(query.toLowerCase())
  );
}

describe('filterNotes (note picker search)', () => {
  const notes = [
    makeNote({ note_id: '1', title: '周报 2026' }),
    makeNote({ note_id: '2', title: '会议纪要' }),
    makeNote({ note_id: '3', title: '项目规划' }),
    makeNote({ note_id: '4', title: '', content: '这是关于周报的笔记没有标题' }),
  ];

  it('returns all notes when query is empty', () => {
    expect(filterNotes(notes, '')).toHaveLength(4);
  });

  it('filters notes by title (case-insensitive)', () => {
    const result = filterNotes(notes, '周报');
    expect(result).toHaveLength(2);
    expect(result.map(n => n.note_id)).toContain('1');
    expect(result.map(n => n.note_id)).toContain('4');
  });

  it('filters by partial title match', () => {
    const result = filterNotes(notes, '会');
    expect(result).toHaveLength(1);
    expect(result[0].note_id).toBe('2');
  });

  it('returns empty when no match', () => {
    const result = filterNotes(notes, '不存在');
    expect(result).toHaveLength(0);
  });

  it('filters by content when title is empty (generateDisplayTitle fallback)', () => {
    const result = filterNotes(notes, '周报');
    // Note 4 has no title, generateDisplayTitle falls back to content first 20 chars
    expect(result.some(n => n.note_id === '4')).toBe(true);
  });
});
