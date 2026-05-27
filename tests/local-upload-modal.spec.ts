import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { TFile } from 'obsidian';
import { LocalUploadModal } from '../src/ui/local-upload-modal';

function renderModal(onConfirm = vi.fn()) {
  const files = [
    new TFile('Get笔记/a.md'),
    new TFile('Get笔记/nested/b.md'),
    new TFile('Inbox/c.md'),
    new TFile('Archive/d.md'),
  ];
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(
    h(LocalUploadModal, {
      files,
      initialFolder: 'Get笔记',
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
      expect.objectContaining({ path: 'Get笔记/nested/b.md' }),
    ]);
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
    ]);
  });

  it('includes root-level markdown files in the folder picker', async () => {
    const onConfirm = vi.fn();
    const files = [
      new TFile('root.md'),
      new TFile('Get笔记/a.md'),
    ];
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(
      h(LocalUploadModal, {
        files,
        initialFolder: '',
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
