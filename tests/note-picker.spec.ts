import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { fetchNotes } from '../src/api';
import { generateDisplayTitle } from '../src/note-parser';
import { NotePickerModal } from '../src/ui/note-picker-modal';
import type { GetNoteNote } from '../src/types';

vi.mock('../src/api', () => ({
  fetchNotes: vi.fn().mockResolvedValue({ notes: [], hasMore: false }),
}));

function makeNote(overrides: Partial<GetNoteNote> = {}): GetNoteNote {
  return {
    id: 1,
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

afterEach(() => {
  vi.mocked(fetchNotes).mockClear();
  render(null, document.body);
  document.body.innerHTML = '';
});

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

describe('NotePickerModal auth chains', () => {
  async function renderPicker(props: { token: string; clientId: string; authMode: 'openapi' | 'web' }, onConfirm = vi.fn()) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(
        h(NotePickerModal, {
          ...props,
          onConfirm,
          onCancel: vi.fn(),
        }),
        container
      );
      await Promise.resolve();
    });
    return container;
  }

  it('loads the first page with OpenAPI credentials', async () => {
    await renderPicker({
      token: 'openapi-token',
      clientId: 'openapi-client',
      authMode: 'openapi',
    });

    expect(fetchNotes).toHaveBeenCalledWith(expect.objectContaining({
      token: 'openapi-token',
      clientId: 'openapi-client',
      authMode: 'openapi',
      sinceId: '0',
    }));
  });

  it('loads the first page with Web Token credentials', async () => {
    await renderPicker({
      token: 'web-token',
      clientId: '',
      authMode: 'web',
    });

    expect(fetchNotes).toHaveBeenCalledWith(expect.objectContaining({
      token: 'web-token',
      clientId: '',
      authMode: 'web',
      sinceId: '0',
    }));
  });

  it('filters the picker list with its own dropdown and submits that scope', async () => {
    const onConfirm = vi.fn();
    vi.mocked(fetchNotes).mockResolvedValueOnce({
      notes: [
        makeNote({ note_id: 'plain', title: '纯文本笔记', note_type: 'plain_text' }),
        makeNote({ note_id: 'link', title: '链接笔记', note_type: 'link' }),
      ],
      hasMore: false,
    });

    const container = await renderPicker({
      token: 'web-token',
      clientId: '',
      authMode: 'web',
    }, onConfirm);

    const trigger = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '全部笔记');
    expect(trigger).toBeTruthy();
    await act(() => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const plainTextOption = Array.from(container.querySelectorAll('label'))
      .find(label => label.textContent === '文字笔记');
    expect(plainTextOption).toBeTruthy();
    const plainTextCheckbox = plainTextOption!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(() => {
      plainTextCheckbox.checked = false;
      plainTextCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).not.toContain('纯文本笔记');
    expect(container.textContent).toContain('链接笔记');

    const linkRowCheckbox = Array.from(container.querySelectorAll('.getnote-picker-row input[type="checkbox"]'))[0] as HTMLInputElement;
    await act(() => {
      linkRowCheckbox.checked = true;
      linkRowCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith(['link'], ['immediate_audio', 'recorder_audio', 'audio_long', 'local_audio', 'link', 'img_text', 'recorder_flash_audio']);
  });
});
