import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { OAuthButton } from '../src/settings/oauth-button';
import { fetchOAuthDeviceCode, pollOAuthToken } from '../src/api';
import { initI18n } from '../src/i18n';

vi.mock('../src/api', () => ({
  fetchOAuthDeviceCode: vi.fn(),
  pollOAuthToken: vi.fn(),
}));

vi.mock('../src/settings/external-link', () => ({
  openExternalUrl: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  render(null, document.body);
  document.body.innerHTML = '';
  initI18n('zh-CN');
});

describe('OAuthButton lifecycle cleanup', () => {
  it('clears the pending success timeout when unmounted', async () => {
    initI18n('zh-CN');
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    vi.mocked(fetchOAuthDeviceCode).mockResolvedValue({
      verification_uri: 'https://biji.com/verify',
      user_code: 'ABCD-1234',
      code: 'dev_abc',
      interval: 5,
    });
    vi.mocked(pollOAuthToken).mockResolvedValue({
      api_key: 'gk_live_abc',
      client_id: 'cli_123',
    });
    const container = document.createElement('div');
    document.body.appendChild(container);

    render(
      h(OAuthButton, {
        onAuthorize: vi.fn(),
        onTestConnection: vi.fn().mockResolvedValue({ isMemberError: false, message: '' }),
      }),
      container
    );

    await act(async () => {
      container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('授权成功');

    await act(async () => {
      render(null, container);
    });

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
