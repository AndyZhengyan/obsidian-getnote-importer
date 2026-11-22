import { afterEach, describe, expect, it, vi } from 'vitest';
import { addNotesToKnowledgeBase, createNote, fetchNoteDetail, fetchNotes, fetchSubscribedKnowledgeNotes, fetchSubscribedTopics, fetchTopicContentPreviewPage, fetchWritableTopics, uploadImage } from '../src/api';

const auth = { token: 'test-token', clientId: 'test-client', authMode: 'openapi' as const };
const webAuth = { token: 'web-token', clientId: '', authMode: 'web' as const };
const largeId = '1911000000000000001';
const imageURL = 'https://image.example/note.png';
const credential = {
  host: 'https://oss.example',
  object_key: 'notes/image.png',
  accessid: 'access-key',
  policy: 'policy',
  signature: 'signature',
  callback: 'callback',
  oss_content_type: 'image/png',
  access_url: imageURL,
};

afterEach(() => vi.restoreAllMocks());

describe('knowledge base and Markdown uploads', () => {
  it('does not repeat Web note creation after an ambiguous server error', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(Response.json({ h: { c: 0 }, c: { note_id: 'new' } }));

    await expect(createNote({ ...webAuth, title: 'Example', content: 'Body', noteType: 'plain_text', topicId: 'target' }))
      .rejects.toThrow('500');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('saves an exact Markdown body and target topic in the same note creation request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(`{"success":true,"data":{"note_id":${largeId}}}`),
    );
    const markdown = `# Heading\n\n**Bold**\n\n![Diagram](${imageURL})`;

    const result = await createNote({ ...auth, title: 'Example', content: markdown, noteType: 'plain_text', topicId: 'target' });

    expect(result.noteId).toBe(largeId);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
      note_type: 'plain_text', content: markdown, topic_id: 'target',
    });
  });

  it('lists writable knowledge bases from the owned topics endpoint', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      success: true, data: { topics: [{ topic_id: 'owned', name: 'Workspace' }], has_more: false },
    }));

    await expect(fetchWritableTopics(auth)).resolves.toEqual([{ topic_id: 'owned', name: 'Workspace', source: 'created' }]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://openapi.biji.com/open/api/v1/resource/knowledge/list?page=1']);
  });

  it('uses the precise Web owned topic id for a single atomic create request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(`{"h":{"c":0},"c":{"list":[{"id":${largeId},"id_alias":"alias","name":"Workspace"}],"has_next":false}}`))
      .mockResolvedValueOnce(Response.json({ h: { c: 0 }, c: { note_id: 'new', prime_id: 'detail' } }));

    const topics = await fetchWritableTopics(webAuth);
    expect(topics).toEqual([{ topic_id: largeId, name: 'Workspace', source: 'created' }]);
    await expect(createNote({ ...webAuth, title: 'Example', content: 'Body', noteType: 'plain_text', topicId: topics[0].topic_id }))
      .resolves.toEqual({ noteId: 'new', detailId: 'detail' });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://knowledge-api.trytalks.com/v1/web/topic/mine/list?page=1&size=20',
      'https://get-notes.luojilab.com/voicenotes/web/topics/notes',
    ]);
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({ topic_id: largeId });
  });

  it('lists both Web download topic sources and reads an owned topic with its alias', async () => {
    const ownedList = { c: [{ id: largeId, id_alias: 'owned-alias', name: 'Workspace', root_dir: { id: 'root' } }] };
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ c: { list: [{ id_alias: 'subscribed-alias', name: 'Reference' }] } }))
      .mockResolvedValueOnce(Response.json(ownedList))
      .mockResolvedValueOnce(Response.json(ownedList))
      .mockResolvedValueOnce(Response.json({ c: { resources: [{ resource_type: 'NOTE', resource_note_meta_data: { note_id: 'note-id' } }] } }));

    await expect(fetchSubscribedTopics(webAuth)).resolves.toEqual([
      { topic_id: largeId, name: 'Workspace', source: 'created' },
      { topic_id: 'subscribed-alias', name: 'Reference', source: 'subscribed' },
    ]);
    await expect(fetchSubscribedKnowledgeNotes({ ...webAuth, createdTopicIds: [largeId], selectedNoteIds: ['note-id'] })).resolves.toEqual([
      expect.objectContaining({ note_id: 'note-id', topic_id: largeId, topic_directory_path: [] }),
    ]);
    expect(fetch.mock.calls[3][0]).toEqual(expect.stringContaining('topic_id_alias=owned-alias'));
  });

  it.each([auth, webAuth])('normalizes a direct $authMode note membership without losing id precision', async credentials => {
    const note = `{"note_id":"note-id","topics":[{"id":${largeId},"name":"Workspace"},{"id":null,"name":"bad"}]}`;
    const fetch = vi.spyOn(globalThis, 'fetch');
    if (credentials.authMode === 'web') {
      fetch.mockResolvedValueOnce(new Response(`{"c":{"list":[${note}]}}`));
      fetch.mockResolvedValueOnce(new Response(`{"c":${note}}`));
    } else {
      fetch.mockResolvedValueOnce(new Response(`{"success":true,"data":{"notes":[${note}]}}`));
      fetch.mockResolvedValueOnce(new Response(`{"success":true,"data":{"note":${note}}}`));
    }

    const memberships = [{ id: largeId, name: 'Workspace' }];
    await expect(fetchNotes(credentials)).resolves.toMatchObject({ notes: [{ topics: memberships }] });
    await expect(fetchNoteDetail('note-id', credentials.token, credentials.clientId, undefined, credentials.authMode))
      .resolves.toMatchObject({ topics: memberships });
  });

  it('keeps large note ids as strings when attaching a note to a knowledge base', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true }));

    await addNotesToKnowledgeBase({ ...auth, topicId: 'target', noteIds: [largeId] });

    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({
      topic_id: 'target', note_ids: [largeId],
    });
  });

  it('signs the image through OpenAPI and sends ordered multipart fields without GetNote credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ success: true, data: credential }))
      .mockResolvedValueOnce(Response.json({ h: { c: 0 }, c: { image: { id: largeId } } }));

    await expect(uploadImage({ ...auth, filename: 'picture.PNG', data: new Uint8Array([1, 2, 3]).buffer })).resolves.toBe(imageURL);

    expect(fetch.mock.calls[0]).toEqual([
      'https://openapi.biji.com/open/api/v1/resource/image/upload_token?mime_type=png&count=1',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token', 'X-Client-ID': 'test-client' } }),
    ]);
    expect(fetch.mock.calls[1]).toEqual([
      credential.host,
      expect.objectContaining({ method: 'POST', redirect: 'error', credentials: 'omit' }),
    ]);
    expect(fetch.mock.calls[1][1]?.headers).toBeUndefined();
    const body = fetch.mock.calls[1][1]?.body as FormData;
    expect([...body.keys()]).toEqual(['key', 'OSSAccessKeyId', 'policy', 'signature', 'callback', 'Content-Type', 'file']);
    expect(body.get('Content-Type')).toBe('image/png');
    expect((body.get('file') as Blob).type).toBe('image/png');
  });

  it('rejects unsupported image formats before requesting credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');

    await expect(uploadImage({ ...auth, filename: 'diagram.svg', data: new ArrayBuffer(0) })).rejects.toThrow();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('signs a Web image and sends the distinct Web multipart form', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ h: { c: 0 }, c: [credential] }))
      .mockResolvedValueOnce(Response.json({ h: { c: 0 }, c: { image: { id: largeId } } }, { status: 201 }));

    await expect(uploadImage({ ...webAuth, filename: 'picture.jpg', data: new ArrayBuffer(0) })).resolves.toBe(imageURL);

    expect(fetch.mock.calls[0]).toEqual([
      'https://get-notes.luojilab.com/voicenotes/web/token/image',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ source: 'web', type: 'jpeg' }) }),
    ]);
    const body = fetch.mock.calls[1][1]?.body as FormData;
    expect([...body.keys()]).toEqual(['OSSAccessKeyId', 'policy', 'Signature', 'key', 'callback', 'success_action_status', 'file']);
    expect((body.get('file') as Blob).type).toBe('image/jpeg');
    expect(body.get('success_action_status')).toBe('201');
    expect(fetch.mock.calls[1][1]?.headers).toBeUndefined();
  });

  it('rejects a failed OSS callback even with HTTP success', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ success: true, data: credential }))
      .mockResolvedValueOnce(Response.json({ h: { c: 1 } }));

    await expect(uploadImage({ ...auth, filename: 'picture.png', data: new ArrayBuffer(0) })).rejects.toThrow();
  });

  it('joins the downloaded note to its nested knowledge-base directory', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ success: true, data: { topics: [{ topic_id: 'workspace', name: 'Workspace' }] } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { notes: [{ note_id: largeId, title: 'Example' }] } }))
      .mockResolvedValueOnce(new Response('{"success":true,"data":{"directories":[{"id":2000000000000000001,"name":"Docs"}]}}'))
      .mockResolvedValueOnce(Response.json({ success: true, data: { directories: [{ id: 'child', name: 'Design' }] } }))
      .mockResolvedValueOnce(new Response(`{"success":true,"data":{"resources":[{"note_id":${largeId}}]}}`));

    await expect(fetchSubscribedKnowledgeNotes({ ...auth, createdTopicIds: ['workspace'] })).resolves.toEqual([
      expect.objectContaining({ note_id: largeId, topic_id: 'workspace', topic_name: 'Workspace', topic_directory_path: ['Docs', 'Design'], tags: [] }),
    ]);
    expect(fetch.mock.calls.map(([url]) => url)).toContain('https://openapi.biji.com/open/api/v1/resource/knowledge/directories?topic_id=workspace&directory_id=2000000000000000001');
  });

  it('traverses a nested Web knowledge-base directory when filtering by note id', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ c: { list: [{ id_alias: 'workspace', name: 'Workspace', root_dir: { id: 'root' } }] } }))
      .mockResolvedValueOnce(new Response('{"c":{"directories":[{"id":2000000000000000001,"name":"Docs","type":"DEFAULT"}],"resources":[]}}'))
      .mockResolvedValueOnce(Response.json({ c: { resources: [{ resource_type: 'NOTE', resource_note_meta_data: { note_id: largeId, title: 'Example' } }] } }));

    await expect(fetchSubscribedKnowledgeNotes({ ...webAuth, selectedNoteIds: [largeId] })).resolves.toEqual([
      expect.objectContaining({ note_id: largeId, topic_id: 'workspace', topic_name: 'Workspace', topic_directory_path: ['Docs'] }),
    ]);
    expect(fetch.mock.calls[2][0]).toEqual(expect.stringContaining('directory_id=2000000000000000001'));
  });

  it('offers nested Web library notes in the paginated selection preview', async () => {
    const list = { c: { list: [{ id_alias: 'workspace', name: 'Workspace', root_dir: { id: 'root' } }] } };
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(list))
      .mockResolvedValueOnce(Response.json({ c: { directories: [{ id: 'docs', name: 'Docs', type: 'DEFAULT' }], resources: [] } }))
      .mockResolvedValueOnce(Response.json({ c: { resources: [{ resource_type: 'NOTE', resource_note_meta_data: { note_id: largeId, title: 'Example' } }] } }));

    const page = await fetchTopicContentPreviewPage('workspace', 'Workspace', webAuth.token, '', 'web');

    expect(page.items).toEqual([expect.objectContaining({ note_id: largeId, title: 'Example' })]);
    expect(fetch.mock.calls[2][0]).toEqual(expect.stringContaining('directory_id=docs'));
  });
});
