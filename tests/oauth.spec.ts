import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as obsidian from 'obsidian';
import { fetchOAuthDeviceCode, pollOAuthToken } from '../src/api';

const BASE_URL = 'https://openapi.biji.com/open/api/v1';

function response(status: number, data: unknown, text = JSON.stringify(data)) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    text,
    json: data,
    arrayBuffer: new ArrayBuffer(0),
  };
}

describe('fetchOAuthDeviceCode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to /oauth/device/code with correct body', async () => {
    const requestSpy = vi.spyOn(obsidian, 'requestUrl').mockResolvedValueOnce(response(200, {
        success: true,
        data: {
          verification_uri: 'https://biji.com/verify',
          user_code: 'ABCD-1234',
          code: 'dev_abc',
          interval: 5,
        },
      }));

    const result = await fetchOAuthDeviceCode();

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${BASE_URL}/oauth/device/code`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: 'cli_a1b2c3d4e5f6789012345678abcdef90' }),
        throw: false,
      })
    );
    expect(result).toEqual({
      verification_uri: 'https://biji.com/verify',
      user_code: 'ABCD-1234',
      code: 'dev_abc',
      interval: 5,
    });
  });

  it('throws when success=false from API', async () => {
    vi.spyOn(obsidian, 'requestUrl').mockResolvedValueOnce(response(200, { success: false, message: 'invalid client' }));

    await expect(fetchOAuthDeviceCode()).rejects.toThrow('invalid client');
  });

  it('throws on non-ok response', async () => {
    vi.spyOn(obsidian, 'requestUrl').mockResolvedValueOnce(response(500, {}, 'Internal Error'));

    await expect(fetchOAuthDeviceCode()).rejects.toThrow('OAuth 设备码请求失败 500: Internal Error');
  });

  it('throws on abort before request', async () => {
    const requestSpy = vi.spyOn(obsidian, 'requestUrl');
    const controller = new AbortController();
    controller.abort();

    await expect(fetchOAuthDeviceCode(controller.signal)).rejects.toThrow('Aborted');
    expect(requestSpy).not.toHaveBeenCalled();
  });
});

describe('pollOAuthToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Stub setTimeout/clearTimeout so polls don't actually wait 5s each
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: () => void) => {
      fn();
      return 0;
    });
    vi.spyOn(globalThis, 'clearTimeout').mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns api_key and client_id on success (status 0)', async () => {
    vi.spyOn(obsidian, 'requestUrl').mockResolvedValueOnce(response(200, {
        success: true,
        data: { api_key: 'gk_live_abc', client_id: 'cli_123' },
        status: 0,
      }));

    const result = await pollOAuthToken('dev_abc', 5);

    expect(result).toEqual({ api_key: 'gk_live_abc', client_id: 'cli_123' });
  });

  it('polls again on pending status 10012 and returns on success', async () => {
    let callCount = 0;
    vi.spyOn(obsidian, 'requestUrl').mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(response(200, { status: 10012 }));
      }
      return Promise.resolve(response(200, {
          success: true,
          data: { api_key: 'gk_live_ok', client_id: 'cli_ok' },
          status: 0,
        }));
    });

    const result = await pollOAuthToken('dev_abc', 5);

    expect(callCount).toBe(2);
    expect(result).toEqual({ api_key: 'gk_live_ok', client_id: 'cli_ok' });
  });

  it('throws on expired status 10013', async () => {
    vi.spyOn(obsidian, 'requestUrl').mockResolvedValueOnce(response(200, { status: 10013, message: 'code expired' }));

    await expect(pollOAuthToken('dev_abc', 5)).rejects.toThrow('OAuth 授权已过期，请重试');
  });

  it('throws with raw JSON on unknown status', async () => {
    vi.spyOn(obsidian, 'requestUrl').mockResolvedValueOnce(response(200, { status: 999, message: 'weird response' }));

    const err = await pollOAuthToken('dev_abc', 5).catch(e => e.message);
    expect(err).toContain('999');
    expect(err).toContain('weird response');
  });

  it('throws on timeout after max attempts', async () => {
    vi.spyOn(obsidian, 'requestUrl').mockResolvedValue(response(200, { status: 10012 }));

    await expect(pollOAuthToken('dev_abc', 5)).rejects.toThrow('OAuth 授权超时，请重试');
  });

  it('throws on abort before first fetch', async () => {
    const requestSpy = vi.spyOn(obsidian, 'requestUrl');

    const controller = new AbortController();
    controller.abort();

    await expect(pollOAuthToken('dev_abc', 5, controller.signal)).rejects.toThrow('Aborted');
    expect(requestSpy).not.toHaveBeenCalled();
  });
});
