import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopicPickerModal } from '../src/ui/topic-picker-modal';
import { fetchSubscribedTopics, fetchTopicContentPreviewPage } from '../src/api';

vi.mock('../src/api', () => ({
  fetchSubscribedTopics: vi.fn(),
  fetchTopicContentPreviewPage: vi.fn(),
}));

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

describe('TopicPickerModal', () => {
  afterEach(() => {
    render(null, document.body);
    vi.clearAllMocks();
  });

  it('keeps subscribed topics and topic contents in separate levels', async () => {
    vi.mocked(fetchSubscribedTopics).mockResolvedValue([
      { topic_id: 'luo', name: '罗振宇学习笔记' },
      { topic_id: 'guide', name: 'Get 笔记使用指南' },
    ]);
    vi.mocked(fetchTopicContentPreviewPage).mockResolvedValue({
      items: [
        {
          note_id: 'note-1',
          title: '第一篇内容',
          updated_at: '2026-06-01T10:00:00+08:00',
          blogger_name: '罗振宇',
        },
      ],
      nextCursor: { bloggerIndex: 0, page: 2 },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(
        h(TopicPickerModal, {
          token: 'token',
          clientId: 'client',
          authMode: 'openapi',
          onConfirm: vi.fn(),
          onCancel: vi.fn(),
        }),
        container
      );
      await Promise.resolve();
    });
    await flush();

    expect(container.textContent).toContain('罗振宇学习笔记');
    expect(container.textContent).toContain('Get 笔记使用指南');
    expect(container.textContent).not.toContain('第一篇内容');
    expect(fetchTopicContentPreviewPage).not.toHaveBeenCalled();

    await act(async () => {
      (container.querySelector('[data-topic-id="luo"]') as HTMLButtonElement).click();
    });
    await flush();

    expect(fetchTopicContentPreviewPage).toHaveBeenCalledTimes(1);
    expect(fetchTopicContentPreviewPage).toHaveBeenCalledWith(
      'luo',
      '罗振宇学习笔记',
      'token',
      'client',
      'openapi',
      undefined,
      undefined
    );
    expect(container.textContent).toContain('罗振宇学习笔记');
    expect(container.textContent).toContain('第一篇内容');
    expect(container.textContent).not.toContain('Get 笔记使用指南');
    expect(container.textContent).toContain('加载更多');
    expect(container.textContent).toContain('同步');
    expect(container.textContent).not.toContain('同步专题');

    await act(async () => {
      (container.querySelector('[data-topic-back]') as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain('Get 笔记使用指南');
    expect(container.textContent).not.toContain('第一篇内容');
  });

  it('loads more topic contents one page at a time', async () => {
    vi.mocked(fetchSubscribedTopics).mockResolvedValue([
      { topic_id: 'luo', name: '罗振宇学习笔记' },
    ]);
    vi.mocked(fetchTopicContentPreviewPage)
      .mockResolvedValueOnce({
        items: [
          { note_id: 'note-1', title: '第一页内容', updated_at: '2026-06-01T10:00:00+08:00' },
        ],
        nextCursor: { bloggerIndex: 0, page: 2 },
      })
      .mockResolvedValueOnce({
        items: [
          { note_id: 'note-2', title: '第二页内容', updated_at: '2026-06-01T11:00:00+08:00' },
        ],
      });

    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(
        h(TopicPickerModal, {
          token: 'token',
          clientId: 'client',
          authMode: 'openapi',
          onConfirm: vi.fn(),
          onCancel: vi.fn(),
        }),
        container
      );
      await Promise.resolve();
    });
    await flush();

    await act(async () => {
      (container.querySelector('[data-topic-id="luo"]') as HTMLButtonElement).click();
    });
    await flush();

    expect(container.textContent).toContain('第一页内容');
    expect(container.textContent).toContain('加载更多');

    await act(async () => {
      (container.querySelector('[data-topic-load-more]') as HTMLButtonElement).click();
    });
    await flush();

    expect(fetchTopicContentPreviewPage).toHaveBeenLastCalledWith(
      'luo',
      '罗振宇学习笔记',
      'token',
      'client',
      'openapi',
      undefined,
      { bloggerIndex: 0, page: 2 }
    );
    expect(container.textContent).toContain('第一页内容');
    expect(container.textContent).toContain('第二页内容');
    expect(container.textContent).not.toContain('加载更多');
  });
});
