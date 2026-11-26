import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSubscribedTopics, fetchTopicContentPreviewPage, type TopicContentPreviewCursor } from '../src/api';
import { SyncEngine } from '../src/sync';
import type { Settings } from '../src/types';
import { TopicPickerModal, type TopicPickerSelection } from '../src/ui/topic-picker-modal';

const token = process.env.DEDAO_OPENAPI_TOKEN ?? '';
const clientId = process.env.DEDAO_OPENAPI_CLIENT_ID ?? '';
const testTopicId = process.env.DEDAO_OPENAPI_TEST_TOPIC_ID;
const runE2E = token.length > 0 && clientId.length > 0;

function makeApp() {
  const files = new Map<string, { path: string; content: string }>();
  const folders = new Set<string>();

  return {
    files,
    app: {
      vault: {
        getAllFolders: () => [...folders].map((path) => ({ path })),
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        getMarkdownFiles: () => [...files.values()].map(({ path }) => ({ path })),
        read: async ({ path }: { path: string }) => files.get(path)?.content ?? '',
        createFolder: vi.fn(async (path: string) => {
          folders.add(path);
        }),
        create: vi.fn(async (path: string, content: string) => {
          const file = { path, content };
          files.set(path, file);
          return file;
        }),
        createBinary: vi.fn(async (path: string) => {
          const file = { path, content: '' };
          files.set(path, file);
          return file;
        }),
        modify: vi.fn(async (file: { path: string }, content: string) => {
          files.set(file.path, { path: file.path, content });
        }),
        rename: vi.fn(async (file: { path: string }, path: string) => {
          const existing = files.get(file.path);
          files.delete(file.path);
          if (existing) files.set(path, { ...existing, path });
        }),
      },
      metadataCache: {
        getFileCache: () => null,
      },
    },
  };
}

function makeSettings(): Settings {
  return {
    authMode: 'openapi',
    openApiToken: token,
    openApiClientId: clientId,
    webApiToken: '',
    apiToken: token,
    clientId,
    webCsrfToken: '',
    folderName: 'E2E Knowledge Sync',
    maxDays: 30,
    syncStartDate: '',
    lastSyncEndTimestamp: '',
    filenamePrefix: '',
    templateFilePath: '',
    scheduledSync: { enabled: false, intervalMinutes: 30, syncOnStart: false },
    syncHistory: [],
  };
}

describe.skipIf(!runE2E)('OpenAPI knowledge-base sync E2E', () => {
  afterEach(() => {
    render(null, document.body);
  });

  it('selects one live article and syncs exactly that article into the vault', async () => {
    const topics = (await fetchSubscribedTopics({ token, clientId, authMode: 'openapi' }))
      .filter(topic => !testTopicId || topic.topic_id === testTopicId);
    expect(topics.length).toBeGreaterThan(0);

    let selection:
      | { selectedNoteIds: string[]; topicIds?: string[]; createdTopicIds?: string[]; bloggerIds: string[]; knowledgeBaseNames: Record<string, string> }
      | undefined;
    for (const topic of topics) {
      let cursor: TopicContentPreviewCursor | undefined;
      do {
        const page = await fetchTopicContentPreviewPage(
          topic.topic_id,
          topic.name,
          token,
          clientId,
          'openapi',
          undefined,
          cursor,
          topic.source,
        );
        cursor = page.nextCursor;
        const article = page.items.find(item => item.blogger_id);
        if (!article?.blogger_id) continue;
        selection = {
          selectedNoteIds: [article.note_id],
          ...(topic.source === 'created' ? { createdTopicIds: [topic.topic_id] } : { topicIds: [topic.topic_id] }),
          bloggerIds: [article.blogger_id],
          knowledgeBaseNames: {
            [article.note_id]: topic.name,
          },
        };
        break;
      } while (cursor && (topic.source === 'created' || cursor.source !== 'notes'));
      if (selection) break;
    }
    expect(selection).toBeDefined();

    const { app, files } = makeApp();
    const engine = new SyncEngine(app as never, makeSettings());
    const result = await engine.syncSubscribedKnowledge(undefined, selection);

    expect(result).toMatchObject({
      total: 1,
      created: 1,
      failed: 0,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.noteId).toBe(selection?.selectedNoteIds[0]);
    expect(files.size).toBeGreaterThan(0);
    expect([...files.keys()].some(path => path.startsWith('E2E Knowledge Sync/知识库/'))).toBe(true);
    if (testTopicId && selection) {
      const params = new URLSearchParams({
        topic_id: testTopicId,
        post_id: selection.selectedNoteIds[0].slice('blogger_'.length),
      });
      const response = await fetch('https://openapi.biji.com/open/api/v1/resource/knowledge/blogger/content/detail?' + params, {
        headers: { Authorization: token.startsWith('Bearer ') ? token : 'Bearer ' + token, 'X-Client-ID': clientId },
      });
      const detail = (await response.json() as { data?: { post_media_text?: string } }).data;
      const original = detail?.post_media_text?.trim();
      expect(Boolean(original)).toBe(true);
      expect([...files.values()].some(file => file.content.includes(original ?? ''))).toBe(true);
    }
    const paths = [...files.keys()];
    await expect(engine.syncSubscribedKnowledge(undefined, selection)).resolves.toMatchObject({
      created: 0, skipped: 1, failed: 0,
    });
    expect([...files.keys()]).toEqual(paths);
  }, 60_000);

  it('downloads an ordinary subscribed note filtered by its knowledge-base tag', async () => {
    const topics = await fetchSubscribedTopics({ token, clientId, authMode: 'openapi' });
    let picked: { noteId: string; topicId: string; topicName: string } | undefined;
    for (const topic of topics.filter(item => item.source === 'subscribed' && item.name)) {
      const page = await fetchTopicContentPreviewPage(
        topic.topic_id, topic.name, token, clientId, 'openapi', undefined,
        { bloggerIndex: 0, page: 1, source: 'notes' }, 'subscribed',
      );
      const note = page.items.find(item => item.content);
      if (!note) continue;
      picked = { noteId: note.note_id, topicId: topic.topic_id, topicName: topic.name };
      break;
    }
    expect(picked).toBeDefined();
    if (!picked) return;

    const { app, files } = makeApp();
    const result = await new SyncEngine(app as never, makeSettings()).syncSubscribedKnowledge(undefined, {
      topicIds: [picked.topicId], selectedNoteIds: [picked.noteId], syncTags: [picked.topicName],
    });
    expect(result).toMatchObject({ total: 1, created: 1, failed: 0 });
    expect(result.items[0]?.noteId).toBe(picked.noteId);
    expect([...files.keys()].some(path => path.startsWith('E2E Knowledge Sync/知识库/'))).toBe(true);
  }, 60_000);

  it('syncs exactly one article selected through the live topic picker UI', async () => {
    let selection: TopicPickerSelection | undefined;
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      render(
        h(TopicPickerModal, {
          token,
          clientId,
          authMode: 'openapi',
          onConfirm: (value) => {
            selection = value;
          },
          onCancel: vi.fn(),
        }),
        container
      );
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-topic-source="subscribed"]')).not.toBeNull();
    }, { timeout: 20_000 });

    const subscribedButtons = Array.from(container.querySelectorAll('[data-topic-source="subscribed"]')) as HTMLButtonElement[];
    for (const button of subscribedButtons) {
      await act(async () => {
        button.click();
      });
      try {
        await vi.waitFor(() => {
          expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
        }, { timeout: 20_000 });
        break;
      } catch {
        await act(async () => {
          (container.querySelector('[data-topic-back]') as HTMLButtonElement).click();
        });
      }
    }
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    });
    await vi.waitFor(() => {
      expect((container.querySelector('.mod-cta') as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      (container.querySelector('.mod-cta') as HTMLButtonElement).click();
    });
    expect(selection?.selectedNoteIds).toHaveLength(1);

    const { app, files } = makeApp();
    const result = await new SyncEngine(app as never, makeSettings())
      .syncSubscribedKnowledge(undefined, selection);

    expect(result).toMatchObject({
      total: 1,
      created: 1,
      failed: 0,
    });
    expect(result.items[0]?.noteId).toBe(selection?.selectedNoteIds[0]);
    expect(files.size).toBeGreaterThan(0);
    expect([...files.keys()].some(path => path.startsWith('E2E Knowledge Sync/知识库/'))).toBe(true);
  }, 60_000);
});
