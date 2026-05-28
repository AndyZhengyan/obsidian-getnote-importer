import { describe, expect, it, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { NoteTypeSelect } from '../src/ui/note-type-select';

function renderSelect(value: string[] | undefined = undefined, onChange = vi.fn()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(h(NoteTypeSelect, { value, onChange }), container);
  return { container, onChange };
}

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

describe('NoteTypeSelect', () => {
  it('按官方筛选项展示笔记类型，不展开底层录音类型', async () => {
    const { container } = renderSelect();

    await act(() => {
      container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const labels = Array.from(container.querySelectorAll('label')).map(label => label.textContent);

    expect(labels).toEqual([
      '全部笔记',
      '录音笔记',
      '文字笔记',
      '链接笔记',
      '图片笔记',
      '录音卡笔记',
    ]);
  });

  it('取消录音笔记时移除该组包含的所有底层录音类型', async () => {
    const { container, onChange } = renderSelect();

    await act(() => {
      container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const audioOption = Array.from(container.querySelectorAll('label'))
      .find(label => label.textContent === '录音笔记');
    expect(audioOption).toBeTruthy();
    const checkbox = audioOption!.querySelector('input[type="checkbox"]') as HTMLInputElement;

    await act(() => {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(['plain_text', 'link', 'img_text', 'recorder_flash_audio']);
  });
});
