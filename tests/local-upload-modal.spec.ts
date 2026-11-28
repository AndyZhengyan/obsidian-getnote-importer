import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { TFile } from 'obsidian';
import { LocalUploadModal } from '../src/ui/local-upload-modal';

function renderModal(onConfirm = vi.fn(), loadTopics = vi.fn().mockResolvedValue([])) {
  const files = [
    new TFile('得到大脑/a.md'),
    new TFile('得到大脑/nested/b.md'),
    new TFile('Inbox/c.md'),
    new TFile('Archive/d.md'),
  ];
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(
    h(LocalUploadModal, {
      files,
      initialFolder: '得到大脑',
      loadTopics,
      onConfirm,
      onCancel: vi.fn(),
    }),
    container
  );
  return { container, files, onConfirm };
}

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

describe('LocalUploadModal', () => {
  it('warns when uploading from outside the download folder', async () => {
    const { container } = renderModal();
    expect(container.querySelector('[role="note"]')).toBeNull();
    await act(() => {
      const select = container.querySelector('select')!;
      select.value = 'Inbox'; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('[role="note"]')?.textContent).toContain('得到大脑');
    expect(container.querySelector('[role="note"]')?.textContent).toContain('不会更新此处原笔记');
    await act(() => {
      const select = container.querySelector('select')!;
      select.value = '得到大脑/nested'; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('[role="note"]')).toBeNull();
  });

  it('filters markdown files by directory and confirms only selected files', async () => {
    const { container, onConfirm } = renderModal();

    expect(container.textContent).toContain('a.md');
    expect(container.textContent).toContain('nested/b.md');
    expect(container.textContent).not.toContain('c.md');

    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    await act(() => {
      checkboxes[1].checked = true;
      checkboxes[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ path: '得到大脑/nested/b.md' }),
    ], undefined);
  });

  it('lets the user switch directory before selecting notes', async () => {
    const { container, onConfirm } = renderModal();

    const folderSelect = container.querySelector('select') as HTMLSelectElement;
    await act(() => {
      folderSelect.value = 'Inbox';
      folderSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).toContain('c.md');
    expect(container.textContent).not.toContain('a.md');

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(() => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ path: 'Inbox/c.md' }),
    ], undefined);
  });

  it('offers only writable knowledge bases and confirms the selected destination', async () => {
    const loadTopics = vi.fn().mockResolvedValue([
      { topic_id: 'mine', name: '我的知识库', source: 'created' },
      { topic_id: 'other', name: '订阅知识库', source: 'subscribed' },
    ]);
    const { container, onConfirm } = renderModal(vi.fn(), loadTopics);
    const destination = container.querySelectorAll('select')[1];
    await vi.waitFor(() => {
      expect(Array.from(destination.options, option => option.value)).toEqual(['', 'mine']);
      expect(destination.disabled).toBe(false);
    });

    await act(() => {
      destination.value = 'mine';
      destination.dispatchEvent(new Event('change', { bubbles: true }));
      const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ path: '得到大脑/a.md' })], {
      topicId: 'mine', topicName: '我的知识库',
    });
  });

  it('can retry loading destinations after a request fails', async () => {
    const loadTopics = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([
      { topic_id: 'mine', name: '我的知识库', source: 'created' },
    ]);
    const { container } = renderModal(vi.fn(), loadTopics);
    await vi.waitFor(() => {
      expect(container.querySelector('[role="status"]')?.textContent).toContain('offline');
    });
    await act(async () => {
      container.querySelector('[role="status"] button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(container.querySelectorAll('select')[1]?.querySelector('option[value="mine"]')).toBeTruthy();
    });
  });

  it('includes root-level markdown files in the folder picker', async () => {
    const onConfirm = vi.fn();
    const files = [
      new TFile('root.md'),
      new TFile('得到大脑/a.md'),
    ];
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(
      h(LocalUploadModal, {
        files,
        initialFolder: '',
        loadTopics: vi.fn().mockResolvedValue([]),
        onConfirm,
        onCancel: vi.fn(),
      }),
      container
    );

    const folderSelect = container.querySelector('select') as HTMLSelectElement;
    expect(Array.from(folderSelect.options).map(option => option.value)).toContain('');
    expect(container.textContent).toContain('root.md');
  });
});
