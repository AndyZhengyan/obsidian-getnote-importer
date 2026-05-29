import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from 'obsidian';
import { fetchNotes } from '../src/api';
import { initI18n } from '../src/i18n';
import { SettingsComponent } from '../src/settings';
import { DEFAULT_SETTINGS, type Settings } from '../src/types';

vi.mock('../src/api', () => ({
  fetchNotes: vi.fn().mockResolvedValue({ notes: [], hasMore: false }),
  fetchOAuthDeviceCode: vi.fn(),
  pollOAuthToken: vi.fn(),
}));

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync },
    syncHistory: [],
    ...overrides,
  };
}

function renderSettings(
  settings: Settings,
  updateSetting = vi.fn(),
  openLocalUpload = vi.fn(),
  options: { isSyncing?: boolean } = {}
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(
    h(SettingsComponent, {
      settings,
      updateSetting,
      startSync: vi.fn(),
      startSubscribedKnowledgeSync: vi.fn(),
      isSyncing: options.isSyncing ?? false,
      openNotePicker: vi.fn(),
      openLocalUpload,
      startAutoSync: vi.fn(),
      stopAutoSync: vi.fn(),
      cancelSync: vi.fn(),
      app: new App(),
    }),
    container
  );
  return { container, updateSetting, openLocalUpload };
}

function inputValue(input: Element, value: string) {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
}

function getTestConnectionButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((item): item is HTMLButtonElement => item.textContent === '测试连接');
  expect(button).toBeTruthy();
  return button;
}

afterEach(() => {
  vi.mocked(fetchNotes).mockClear();
  initI18n('zh-CN');
  render(null, document.body);
  document.body.innerHTML = '';
});

describe('SettingsComponent auth credentials', () => {
  it('does not render a separate upload permission switch', () => {
    const { container } = renderSettings(makeSettings({
      reverseSync: { enabled: false },
    }));

    expect(container.textContent).not.toContain('允许上传本地笔记到 得到大脑');
    expect(container.textContent).not.toContain('启用上传');
  });

  it('opens the local upload picker from the manual sync upload button', async () => {
    const openLocalUpload = vi.fn();
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
      apiToken: 'web-token',
      reverseSync: { enabled: false },
    }), vi.fn(), openLocalUpload);

    expect(container.textContent).toContain('从 得到大脑同步到 Obsidian');
    expect(container.textContent).toContain('从 Obsidian 上传到 得到大脑');
    expect(container.textContent).not.toContain('选择笔记上传');
    const uploadButton = Array.from(container.querySelectorAll('button'))
      .find((button): button is HTMLButtonElement => button.textContent === '按笔记上传');
    expect(uploadButton).toBeTruthy();
    expect(uploadButton!.disabled).toBe(false);
    expect(uploadButton!.classList.contains('mod-secondary')).toBe(true);

    await act(() => {
      uploadButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(openLocalUpload).toHaveBeenCalledTimes(1);
  });

  it('disables the local upload button until credentials are configured', () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: '',
      apiToken: '',
      reverseSync: { enabled: true },
    }));

    const uploadButton = Array.from(container.querySelectorAll('button'))
      .find((button): button is HTMLButtonElement => button.textContent === '按笔记上传');
    expect(uploadButton).toBeTruthy();
    expect(uploadButton!.disabled).toBe(true);
  });

  it('disables the local upload button while syncing', () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
      apiToken: 'web-token',
    }), vi.fn(), vi.fn(), { isSyncing: true });

    const uploadButton = Array.from(container.querySelectorAll('button'))
      .find((button): button is HTMLButtonElement => button.textContent === '按笔记上传');
    expect(uploadButton).toBeTruthy();
    expect(uploadButton!.disabled).toBe(true);
  });

  it('writes the visible mode token back when switching auth modes', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      authMode: 'openapi',
      apiToken: '',
      clientId: 'cli-openapi',
      openApiToken: '',
      openApiClientId: 'cli-openapi',
      webApiToken: '',
    }));

    const tokenInput = container.querySelector('input[type="password"]');
    expect(tokenInput).not.toBeNull();
    await act(() => {
      inputValue(tokenInput!, 'gk-openapi-token');
    });
    expect(updateSetting).toHaveBeenCalledWith('openApiToken', 'gk-openapi-token');

    const webRadio = container.querySelector('input[value="web"]');
    expect(webRadio).not.toBeNull();
    await act(() => {
      webRadio!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const webTokenInput = container.querySelector('input[type="password"]');
    expect(webTokenInput).not.toBeNull();
    await act(() => {
      inputValue(webTokenInput!, 'web-session-token');
    });
    expect(updateSetting).toHaveBeenCalledWith('webApiToken', 'web-session-token');

    const openapiRadio = container.querySelector('input[value="openapi"]');
    expect(openapiRadio).not.toBeNull();
    await act(() => {
      openapiRadio!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('apiToken', 'gk-openapi-token');
    expect(updateSetting).toHaveBeenCalledWith('clientId', 'cli-openapi');
  });

  it('runs the OpenAPI test-connection chain with OpenAPI credentials', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      authMode: 'openapi',
      apiToken: '',
      clientId: '',
      openApiToken: '',
      openApiClientId: '',
      webApiToken: 'web-token',
    }));

    const clientIdInput = container.querySelector('input[placeholder="Client ID：cli_xxx"]');
    const tokenInput = container.querySelector('input[type="password"]');
    expect(clientIdInput).not.toBeNull();
    expect(tokenInput).not.toBeNull();

    await act(() => {
      inputValue(clientIdInput!, 'cli-openapi');
      inputValue(tokenInput!, 'gk-openapi-token');
    });

    expect(updateSetting).toHaveBeenCalledWith('openApiClientId', 'cli-openapi');
    expect(updateSetting).toHaveBeenCalledWith('openApiToken', 'gk-openapi-token');

    await act(async () => {
      getTestConnectionButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchNotes).toHaveBeenCalledWith(expect.objectContaining({
      token: 'gk-openapi-token',
      clientId: 'cli-openapi',
      authMode: 'openapi',
      sinceId: '0',
      limit: 1,
    }));
  });

  it('runs the Web Token test-connection chain with Web credentials', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      authMode: 'web',
      apiToken: '',
      clientId: 'cli-openapi',
      openApiToken: 'gk-openapi-token',
      openApiClientId: 'cli-openapi',
      webApiToken: '',
    }));

    const tokenInput = container.querySelector('input[type="password"]');
    expect(tokenInput).not.toBeNull();

    await act(() => {
      inputValue(tokenInput!, 'web-session-token');
    });

    expect(updateSetting).toHaveBeenCalledWith('webApiToken', 'web-session-token');

    await act(async () => {
      getTestConnectionButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchNotes).toHaveBeenCalledWith(expect.objectContaining({
      token: 'web-session-token',
      clientId: '',
      authMode: 'web',
      sinceId: '0',
      limit: 1,
    }));
  });

  it('shows concise temporary-auth guidance in Web auth mode', () => {
    initI18n('en-US');
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: '',
    }));

    expect(container.textContent).toContain('Temporary Auth');
    expect(container.textContent).toContain('about 30 minutes');
    expect(container.textContent).toContain('PRO');
    expect(container.textContent).toContain('OpenAPI');
    expect(container.textContent).not.toContain('DevTools');
    expect(container.textContent).not.toContain('Network');
    expect(container.textContent).not.toContain('Fetch/XHR');
  });

  it('uses Chinese README links in Chinese locale', () => {
    initI18n('zh-CN');
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
    }));

    const links = Array.from(container.querySelectorAll('a')).map((link) => link.href);
    expect(links.some((href) => href.includes('README_zh.md#%E5%85%B3%E4%BA%8E%E4%BD%9C%E8%80%85') || href.includes('README_zh.md#关于作者'))).toBe(true);
    expect(links.some((href) => href.includes('docs/web-mode-manual-token_zh.md'))).toBe(true);
  });

  it('uses English README links in English locale', () => {
    initI18n('en-US');
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
    }));

    const links = Array.from(container.querySelectorAll('a')).map((link) => link.href);
    expect(links.some((href) => href.includes('README.md#about-the-author'))).toBe(true);
    expect(links.some((href) => href.includes('docs/web-mode-manual-token.md'))).toBe(true);
  });

  it('stores note type filters inside scheduled sync settings', async () => {
    const scheduledSync = {
      ...DEFAULT_SETTINGS.scheduledSync,
      enabled: true,
    };
    const { container, updateSetting } = renderSettings(makeSettings({
      scheduledSync,
    }));

    const trigger = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '全部类型');
    expect(trigger).toBeTruthy();
    await act(() => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const plainTextOption = Array.from(container.querySelectorAll('label'))
      .find(label => label.textContent === '纯文本');
    expect(plainTextOption).toBeTruthy();
    const checkbox = plainTextOption!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    await act(() => {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSetting).not.toHaveBeenCalledWith('enabledNoteTypes', expect.anything());
    expect(updateSetting).toHaveBeenCalledWith('scheduledSync', {
      ...scheduledSync,
      enabledNoteTypes: ['link', 'immediate_audio', 'recorder_audio', 'recorder_flash_audio', 'audio_long', 'local_audio'],
    });
  });
});
