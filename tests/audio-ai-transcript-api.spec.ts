import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAudioAiTranscript, setWebTokenRefreshHandler } from '../src/api';
import { initI18n } from '../src/i18n';

const originalUrl = 'https://get-notes.luojilab.com/voicenotes/web/notes/1908723638246504120/original';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  initI18n('zh-CN');
  setWebTokenRefreshHandler(null);
  vi.restoreAllMocks();
});

describe('fetchAudioAiTranscript', () => {
  it('localizes an unnamed speaker while preserving Chinese source text in English locale', async () => {
    initI18n('en');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ c: { has_optimized_asr: true } }))
      .mockResolvedValueOnce(response({ c: { content: { sentence_list: [{ text: '原文不翻译。', speaker_id: 2 }] } } }));
    expect(await fetchAudioAiTranscript('123', 'web-token')).toBe('Speaker 2\n原文不翻译。');
  });

  it('reads the existing optimized version with an exact string ID and Web token', async () => {
    setWebTokenRefreshHandler({ getToken: () => 'saved-web-token', refresh: vi.fn() });
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ c: { has_optimized_asr: true, content: '原始转写，不能返回' } }))
      .mockResolvedValueOnce(response({ c: { content: 'AI 整理后的转写', optimized_asr_version: 1 } }));

    expect(await fetchAudioAiTranscript('1908723638246504120', 'openapi-token')).toBe('AI 整理后的转写');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([originalUrl, `${originalUrl}?show_opt_asr=true`]);
    for (const [, options] of fetch.mock.calls) {
      expect(options?.method).toBe('GET');
      expect(options?.headers).toMatchObject({ Authorization: 'Bearer saved-web-token' });
    }
  });

  it.each([false, undefined])('returns null without generating or using original content when optimized flag is %s', async flag => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ c: { has_optimized_asr: flag, content: '原始内容' } }));
    expect(await fetchAudioAiTranscript('123', 'web-token')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { content: JSON.stringify({ sentence_list: [{ start_time: 1000, end_time: 3200, text: '第一句。', speaker_id: 1, speaker_name: '小王', resources: [] }, { text: '第二句。', speaker_id: 2 }] }), want: '小王 [00:00:01 - 00:00:03]\n第一句。\n\n说话人 2\n第二句。' },
    { content: { sentence_list: [{ text: '结构对象' }] }, want: '结构对象' },
    { content: '[00:00:01] 已整理的纯文本', want: '[00:00:01] 已整理的纯文本' },
    { content: { sentences: [{ start_ms: 61500, end_ms: 64000, text: '毫秒时间', speaker_name: '主持人' }] }, want: '主持人 [00:01:01 - 00:01:04]\n毫秒时间' },
    { content: { sentence_list: [{ text: '时间字符串', start_time: '00:00:05', speaker_name: '甲' }] }, want: '甲 [00:00:05]\n时间字符串' },
    { content: '', want: null },
    { content: { sentence_list: [] }, want: null },
    { content: { sentence_list: [{ text: '  ' }] }, want: null },
  ])('renders readable optimized content: $want', async ({ content, want }) => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ data: { has_optimized_asr: true } }))
      .mockResolvedValueOnce(response({ data: { content, optimized_asr_version: 2 } }));
    expect(await fetchAudioAiTranscript('123', 'web-token')).toBe(want);
  });

  it.each([
    {},
    { c: null },
    { c: { content: '原文', has_optimized_asr: 'true' } },
  ])('rejects malformed original metadata instead of treating it as no optimized version: %j', async body => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(body));
    await expect(fetchAudioAiTranscript('123', 'web-token')).rejects.toThrow();
  });

  it.each([
    {},
    { content: '{"sentence_list":' },
    { content: '{"unexpected":"raw JSON"}' },
    { content: { sentence_list: [{ wrong: 'missing text' }] } },
    { content: { sentence_list: [{ text: '正常' }, null] } },
    { content: { sentence_list: 'wrong shape' } },
    { content: { sentence_list: [{ text: '错误时间', start_time: -1 }] } },
  ])('rejects malformed optimized payload without leaking JSON or falling back: %j', async optimized => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ c: { has_optimized_asr: true, content: '禁止回退' } }))
      .mockResolvedValueOnce(response({ c: optimized }));
    await expect(fetchAudioAiTranscript('123', 'web-token')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes expired Web authentication and repeats the read with the renewed token', async () => {
    const refresh = vi.fn().mockResolvedValue('renewed-web-token');
    setWebTokenRefreshHandler({ getToken: () => 'expired-web-token', refresh });
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ message: 'LoginRequired' }, 401))
      .mockResolvedValueOnce(response({ c: { has_optimized_asr: true } }))
      .mockResolvedValueOnce(response({ c: { content: '已整理' } }));
    expect(await fetchAudioAiTranscript('123', 'openapi-token')).toBe('已整理');
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer renewed-web-token' });
    expect(fetch.mock.calls[2][1]?.headers).toMatchObject({ Authorization: 'Bearer renewed-web-token' });
  });

  it('propagates HTTP errors without using the raw transcript', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ c: { has_optimized_asr: true, content: '原文' } }))
      .mockResolvedValueOnce(response({ message: 'unavailable' }, 400));
    await expect(fetchAudioAiTranscript('123', 'web-token')).rejects.toThrow();
  });

  it('does not return raw content when the optimized version disappears between requests', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ c: { has_optimized_asr: true } }))
      .mockResolvedValueOnce(response({ c: { has_optimized_asr: false, content: '原始转写' } }));
    expect(await fetchAudioAiTranscript('123', 'web-token')).toBeNull();
  });

  it('handles Web API business authentication errors in successful HTTP responses', async () => {
    const refresh = vi.fn().mockResolvedValue('renewed-web-token');
    setWebTokenRefreshHandler({ getToken: () => 'expired-web-token', refresh });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ message: 'LoginRequired' }))
      .mockResolvedValueOnce(response({ c: { has_optimized_asr: false } }));
    expect(await fetchAudioAiTranscript('123', 'web-token')).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not fetch or refresh when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const refresh = vi.fn();
    setWebTokenRefreshHandler({ getToken: () => 'web-token', refresh });
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(fetchAudioAiTranscript('123', 'web-token', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not start the optimized request after cancellation during metadata read', async () => {
    const controller = new AbortController();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      controller.abort();
      return response({ c: { has_optimized_asr: true } });
    });
    await expect(fetchAudioAiTranscript('123', 'web-token', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry after cancellation while refreshing an expired Web token', async () => {
    const controller = new AbortController();
    const refresh = vi.fn().mockImplementation(async () => {
      controller.abort();
      return 'renewed-web-token';
    });
    setWebTokenRefreshHandler({ getToken: () => 'expired-web-token', refresh });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ message: 'LoginRequired' }, 401));
    await expect(fetchAudioAiTranscript('123', 'web-token', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['metadata', 'optimized'])('rejects cancellation while reading the %s response body', async stage => {
    const controller = new AbortController();
    const cancelledResponse = response({});
    vi.spyOn(cancelledResponse, 'text').mockImplementation(async () => {
      controller.abort();
      return JSON.stringify({ c: stage === 'metadata' ? { has_optimized_asr: false } : { content: '不应写入' } });
    });
    const fetch = vi.spyOn(globalThis, 'fetch');
    if (stage === 'optimized') fetch.mockResolvedValueOnce(response({ c: { has_optimized_asr: true } }));
    fetch.mockResolvedValueOnce(cancelledResponse);
    await expect(fetchAudioAiTranscript('123', 'web-token', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
