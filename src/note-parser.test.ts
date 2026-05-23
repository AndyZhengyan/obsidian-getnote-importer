import { describe, it, expect } from 'vitest';
import { renderNote, getNoteTitle } from './note-parser';
import { getCategoryDir } from './types';
import type { GetNoteNote } from './types';

function makeNote(overrides: Partial<GetNoteNote> = {}): GetNoteNote {
  return {
    id: 1,
    note_id: 'note_001',
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

describe('renderNote', () => {
  it('includes note_id and title in frontmatter', () => {
    const md = renderNote(makeNote());
    expect(md).toContain('uid: "note_001"');
    expect(md).toContain('title: "测试笔记"');
    expect(md).toContain('正文内容');
  });

  it('falls back to content for empty title', () => {
    const md = renderNote(makeNote({ title: '', content: '1234567890内容' }));
    expect(md).toContain('title: "1234567890内容"');
  });

  it('handles notes with tags', () => {
    const md = renderNote(makeNote({ tags: [{ name: 'work' }, { name: 'obsidian' }] }));
    expect(md).toContain('tags: ["work", "obsidian"]');
  });

  it('handles empty tags', () => {
    const md = renderNote(makeNote());
    expect(md).toContain('tags: []');
  });
});

describe('getNoteTitle', () => {
  it('returns title when present', () => {
    expect(getNoteTitle(makeNote())).toBe('测试笔记');
  });

  it('falls back to content preview when title is empty', () => {
    const note = makeNote({ title: '', content: 'abcdefghij额外' });
    expect(getNoteTitle(note)).toBe('abcdefghij...');
  });
});

describe('getCategoryDir', () => {
  it('maps known note types', () => {
    expect(getCategoryDir('plain_text')).toBe('纯文本');
    expect(getCategoryDir('link')).toBe('链接笔记');
    expect(getCategoryDir('immediate_audio')).toBe('即时录音');
  });

  it('returns 其他 for unknown types', () => {
    expect(getCategoryDir('unknown_type')).toBe('其他');
  });
});
