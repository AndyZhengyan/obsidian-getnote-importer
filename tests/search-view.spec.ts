import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { TFile, type App } from 'obsidian';
import { SearchPanel, findSyncedNoteFile } from '../src/ui/search-view';
import type { RecallSearchResult } from '../src/types';

function makeResult(overrides: Partial<RecallSearchResult> = {}): RecallSearchResult {
  return {
    note_id: 'note-1',
    title: '搜索结果',
    content: '命中的正文片段',
    note_type: 'plain_text',
    updated_at: '2026-05-20 10:00:00',
    ...overrides,
  };
}

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

async function flushPromises(times = 3): Promise<void> {
  for (let index = 0; index < times; index++) {
    await Promise.resolve();
  }
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('SearchPanel', () => {
  it('renders search results with open/sync actions based on local uid lookup', async () => {
    const localFile = new TFile('得到大脑/纯文本/搜索结果.md');
    const onSearch = vi.fn().mockResolvedValue([
      makeResult({ note_id: 'synced', title: '已同步结果' }),
      makeResult({ note_id: 'remote', title: '远端结果', note_type: 'link' }),
    ]);
    const onOpenLocal = vi.fn();
    const onSyncNote = vi.fn().mockResolvedValue(undefined);
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      render(h(SearchPanel, {
        initialQuery: '关键词',
        autoSearchKey: 1,
        onSearch,
        resolveLocalFile: (noteId) => noteId === 'synced' ? localFile : null,
        onOpenLocal,
        onSyncNote,
      }), container);
      await flushPromises();
    });
    await act(async () => {
      await flushPromises();
    });
    await act(async () => {
      await flushPromises();
    });

    expect(onSearch).toHaveBeenCalledWith('关键词', expect.any(AbortSignal));
    expect(container.textContent).toContain('已同步结果');
    expect(container.textContent).toContain('远端结果');
    expect(container.textContent).toContain('链接笔记');

    const openButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '打开本地笔记');
    const syncButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '同步到本地');
    expect(openButton).toBeTruthy();
    expect(syncButton).toBeTruthy();

    await act(() => {
      openButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenLocal).toHaveBeenCalledWith(localFile);

    await act(async () => {
      syncButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onSyncNote).toHaveBeenCalledWith('remote');
  });

  it('keeps the syncing state isolated to the clicked search result', async () => {
    let resolveSync: (() => void) | undefined;
    const onSearch = vi.fn().mockResolvedValue([
      makeResult({ note_id: 'note-a', title: '第一条' }),
      makeResult({ note_id: 'note-b', title: '第二条' }),
    ]);
    const onSyncNote = vi.fn().mockImplementation(() => new Promise<void>(resolve => {
      resolveSync = resolve;
    }));
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      render(h(SearchPanel, {
        initialQuery: '关键词',
        autoSearchKey: 1,
        onSearch,
        resolveLocalFile: () => null,
        onOpenLocal: vi.fn(),
        onSyncNote,
      }), container);
      await flushPromises();
    });
    await act(async () => {
      await flushPromises();
    });

    const cards = Array.from(container.querySelectorAll('.getnote-search-note-card'));
    expect(cards).toHaveLength(2);
    const firstButton = cards[0].querySelector('button') as HTMLButtonElement;
    const secondButton = cards[1].querySelector('button') as HTMLButtonElement;

    await act(async () => {
      firstButton.click();
      await Promise.resolve();
    });

    expect(onSyncNote).toHaveBeenCalledTimes(1);
    expect(onSyncNote).toHaveBeenCalledWith('note-a');
    expect(firstButton.textContent).toBe('同步中...');
    expect(firstButton.disabled).toBe(true);
    expect(secondButton.textContent).toBe('同步到本地');
    expect(secondButton.disabled).toBe(false);

    await act(async () => {
      resolveSync?.();
      await flushPromises();
    });
  });

  it('runs the initial selected-text query automatically', async () => {
    const onSearch = vi.fn().mockResolvedValue([makeResult({ note_id: 'selected' })]);
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      render(h(SearchPanel, {
        initialQuery: '选中文本',
        autoSearchKey: 1,
        onSearch,
        resolveLocalFile: () => null,
        onOpenLocal: vi.fn(),
        onSyncNote: vi.fn(),
      }), container);
      await flushPromises();
    });
    await act(async () => {
      await flushPromises();
    });

    expect(onSearch).toHaveBeenCalledWith('选中文本', expect.any(AbortSignal));
    expect(container.textContent).toContain('搜索结果');
  });

  it('shows clear empty and error states', async () => {
    const onSearch = vi.fn().mockRejectedValue(new Error('quota exceeded'));
    const container = document.createElement('div');
    document.body.appendChild(container);

    render(h(SearchPanel, {
      initialQuery: '',
      onSearch,
      resolveLocalFile: () => null,
      onOpenLocal: vi.fn(),
      onSyncNote: vi.fn(),
    }), container);

    await act(async () => {
      (container.querySelector('.getnote-search-submit') as HTMLButtonElement).click();
      await flushPromises();
    });
    expect(onSearch).not.toHaveBeenCalled();
    expect(container.textContent).toContain('一键搜索您的得到大脑，一键同步到本地');

    const input = container.querySelector('input') as HTMLInputElement;
    await act(() => {
      input.value = '失败';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await act(async () => {
      (container.querySelector('.getnote-search-submit') as HTMLButtonElement).click();
      await flushPromises();
    });

    expect(container.textContent).toContain('quota exceeded');
  });
});

describe('findSyncedNoteFile', () => {
  it('returns the local Markdown file whose frontmatter uid matches the note id', () => {
    const matching = new TFile('得到大脑/链接笔记/命中.md');
    const other = new TFile('得到大脑/纯文本/其他.md');
    const app: Pick<App, 'vault' | 'metadataCache'> = {
      vault: {
        getMarkdownFiles: () => [other, matching, new TFile('其他/命中.md')],
      },
      metadataCache: {
        getFileCache: (file: TFile) => ({
          frontmatter: file === matching ? { uid: '1909193892067130512' } : { uid: 'other' },
        }),
      },
    };

    expect(findSyncedNoteFile(app, '得到大脑', '1909193892067130512')).toBe(matching);
  });
  it('ignores archived and local-only copies when resolving a synced note', () => {
    const archived = new TFile('得到大脑/纯文本/旧副本.md');
    const active = new TFile('得到大脑/纯文本/当前笔记.md');
    const app: Pick<App, 'vault' | 'metadataCache'> = {
      vault: { getMarkdownFiles: () => [archived, active] },
      metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: {
        uid: '1909193892067130512', ...(file === archived ? { dedao_sync_archived: true } : {}),
      } }) },
    };
    expect(findSyncedNoteFile(app, '得到大脑', '1909193892067130512')).toBe(active);
    app.vault.getMarkdownFiles = () => [archived];
    expect(findSyncedNoteFile(app, '得到大脑', '1909193892067130512')).toBeNull();
  });
});
