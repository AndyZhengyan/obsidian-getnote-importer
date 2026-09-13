import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from 'obsidian';
import { abstractInputSuggestInstances, TFile, TFolder } from './mocks/obsidian';
import { fetchNotes } from '../src/api';
import { initI18n } from '../src/i18n';
import * as SettingsModule from '../src/settings';
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

function makeSyncHistoryEntry(
  type: 'full' | 'auto',
  status: Settings['syncHistory'][number]['status'] = 'success',
  timestamp = 2
): Settings['syncHistory'][number] {
  return {
    id: `${type}-${timestamp}`,
    startedAt: timestamp - 1,
    finishedAt: timestamp,
    durationMs: 1,
    timestamp,
    result: { created: 1, updated: 0, skipped: 0, failed: status === 'failed' ? 1 : 0, total: 1, items: [] },
    type,
    mode: type === 'auto' ? 'auto' : 'time',
    status,
  };
}

describe('computeOnboardingState (#242)', () => {
  const computeOnboardingState = (SettingsModule as unknown as {
    computeOnboardingState?: (settings: Settings) => string;
  }).computeOnboardingState;

  it('exposes the state computation contract', () => {
    expect(computeOnboardingState).toBeTypeOf('function');
  });

  const makeHistoryEntry = (type: 'full' | 'auto'): Settings['syncHistory'][number] => ({
    id: `${type}-1`,
    startedAt: 1,
    finishedAt: 2,
    durationMs: 1,
    timestamp: 2,
    result: { created: 1, updated: 0, skipped: 0, failed: 0, total: 1, items: [] },
    type,
    mode: type === 'auto' ? 'auto' : 'time',
    status: 'success',
  });

  it('guides users from credentials to scheduled auto sync', () => {
    expect(computeOnboardingState?.(makeSettings())).toBe('first-run');
    expect(computeOnboardingState?.(makeSettings({
      syncHistory: [makeHistoryEntry('full')],
    }))).toBe('needs-credentials');
    expect(computeOnboardingState?.(makeSettings({ apiToken: 'token', clientId: 'client' }))).toBe('needs-auto-sync');
    expect(computeOnboardingState?.(makeSettings({
      apiToken: 'token',
      clientId: 'client',
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true },
    }))).toBe('ready');
  });

  it('only completes onboarding after an automatic sync and reopens it when auto sync is disabled', () => {
    const credentials = { apiToken: 'token', clientId: 'client' };
    expect(computeOnboardingState?.(makeSettings({
      ...credentials,
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true },
      syncHistory: [makeHistoryEntry('full')],
    }))).toBe('ready');
    expect(computeOnboardingState?.(makeSettings({
      ...credentials,
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true },
      syncHistory: [makeHistoryEntry('auto')],
    }))).toBe('configured');
    expect(computeOnboardingState?.(makeSettings({
      ...credentials,
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: false },
      syncHistory: [makeHistoryEntry('auto')],
    }))).toBe('needs-auto-sync');
  });
});

function makeFolder(path: string): TFolder {
  const folder = new TFolder();
  folder.path = path;
  folder.name = path.split('/').pop() ?? path;
  return folder;
}

function renderSettings(
  settings: Settings,
  updateSetting = vi.fn(),
  openLocalUpload = vi.fn(),
  options: {
    isSyncing?: boolean;
    syncProgress?: { message: string; count: string; percent?: number; phase?: 'active' | 'success' | 'failed' | 'cancelled' };
    startSubscribedKnowledgeSync?: () => void;
    initialKnowledgeBaseCache?: { entries: Array<{ topicId: string; name: string }>; cacheUpdatedAt?: number };
    app?: App;
    previewDatePathSettings?: (target: { enabled: boolean; format: string }) => Promise<{
      scanned: number;
      planned?: number;
      moved: number;
      unchanged: number;
      skipped: number;
      failed: number;
      issues: Array<{ code: string; path: string; message: string }>;
    }>;
    applyDatePathSettings?: (target: { enabled: boolean; format: string }) => Promise<{
      scanned: number;
      moved: number;
      unchanged: number;
      skipped: number;
      failed: number;
      issues: Array<{ code: string; path: string; message: string }>;
    }>;
    confirmDatePathMigration?: (request: {
      mode: 'apply' | 'reconcile';
      current: { enabled: boolean; format: string };
      target: { enabled: boolean; format: string };
    }) => Promise<boolean>;
    desktopWebAuthAvailable?: boolean;
    startDesktopWebAuth?: () => Promise<string>;
    clearDesktopWebAuth?: () => Promise<void>;
  } = {}
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(
    h(SettingsComponent, {
      settings,
      updateSetting,
      startSync: vi.fn(),
      isSyncing: options.isSyncing ?? false,
      openNotePicker: vi.fn(),
      startSubscribedKnowledgeSync: options.startSubscribedKnowledgeSync ?? vi.fn(),
      openLocalUpload,
      startAutoSync: vi.fn(),
      stopAutoSync: vi.fn(),
      cancelSync: vi.fn(),
      app: options.app ?? new App(),
      syncProgress: options.syncProgress,
      initialKnowledgeBaseCache: options.initialKnowledgeBaseCache,
      applyDatePathSettings: options.applyDatePathSettings,
      previewDatePathSettings: options.previewDatePathSettings,
      confirmDatePathMigration: options.confirmDatePathMigration,
      desktopWebAuthAvailable: options.desktopWebAuthAvailable,
      startDesktopWebAuth: options.startDesktopWebAuth,
      clearDesktopWebAuth: options.clearDesktopWebAuth,
    }),
    container
  );
  return { container, updateSetting, openLocalUpload };
}

/**
 * Stateful renderSettings variant for tests that exercise the attachment
 * master toggle. With the declarative Toggle pattern, the visual child state
 * is derived from `settings.attachmentImport` on every render — so a no-op
 * vi.fn() updateSetting would leave the DOM out of sync. This helper holds
 * the settings object in a closure-level mutable ref, mutates it in response
 * to updateSetting calls, and re-renders so children pick up the new value.
 */
function renderStatefulSettings(
  initial: Settings,
  options: Parameters<typeof renderSettings>[3] = {}
): { container: HTMLElement; settings: Settings; updateSetting: ReturnType<typeof vi.fn> } {
  const settings: Settings = JSON.parse(JSON.stringify(initial));
  const container = document.createElement('div');
  document.body.appendChild(container);

  const rerender = () => {
    render(
      h(SettingsComponent, {
        settings,
        updateSetting: updateSetting as unknown as <K extends keyof Settings>(key: K, value: Settings[K]) => void,
        startSync: vi.fn(),
        isSyncing: options.isSyncing ?? false,
        openNotePicker: vi.fn(),
        startSubscribedKnowledgeSync: options.startSubscribedKnowledgeSync ?? vi.fn(),
        openLocalUpload: vi.fn(),
        startAutoSync: vi.fn(),
        stopAutoSync: vi.fn(),
        cancelSync: vi.fn(),
        app: new App(),
        syncProgress: options.syncProgress,
        initialKnowledgeBaseCache: options.initialKnowledgeBaseCache,
        applyDatePathSettings: options.applyDatePathSettings,
        confirmDatePathMigration: options.confirmDatePathMigration,
      }),
      container
    );
  };

  const updateSetting = vi.fn(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    (settings as unknown as Record<string, unknown>)[key] = value as unknown;
    rerender();
  });

  rerender();
  return { container, settings, updateSetting };
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

function mockOpenExternal() {
  const openExternal = vi.fn();
  (window as Window & {
    require?: (moduleName: 'electron') => { shell: { openExternal: typeof openExternal } };
  }).require = vi.fn(() => ({ shell: { openExternal } }));
  return openExternal;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(fetchNotes).mockClear();
  abstractInputSuggestInstances.length = 0;
  initI18n('zh-CN');
  render(null, document.body);
  document.body.innerHTML = '';
  delete (window as Window & { require?: unknown }).require;
});

describe('SettingsComponent information architecture (#257)', () => {
  it('labels scheduled and manual sync clearly', () => {
    const { container } = renderSettings(makeSettings());

    expect(container.textContent).toContain('自动同步');
    expect(container.textContent).not.toContain('自动同步（单向：得到 → OB）');
    expect(container.textContent).toContain('手动同步');
    expect(container.textContent).not.toContain('手动同步（双向：得到 ↔ OB）');
  });

  it('groups automatic sync, manual sync, and history before the final advanced settings section', async () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'token',
      openApiClientId: 'client-id',
      scheduledSync: {
        ...DEFAULT_SETTINGS.scheduledSync,
        enabled: true,
        intervalMinutes: 30,
        syncOnStart: true,
      },
    }));

    const status = container.querySelector<HTMLElement>('[data-settings-status]');
    expect(status).toBeTruthy();
    expect(status!.textContent).toContain('OpenAPI');
    expect(status!.textContent).toContain('当前状态');
    expect(status!.textContent).not.toContain('按时间同步');

    const sections = Array.from(container.querySelectorAll<HTMLElement>('[data-settings-section]'))
      .map(section => section.dataset.settingsSection);
    expect(sections).toEqual(['sync', 'advanced']);

    const syncSection = container.querySelector('[data-settings-section="sync"]')!;
    const syncDisclosure = container.querySelector<HTMLButtonElement>('[data-sync-disclosure]')!;
    const syncDetails = container.querySelector<HTMLElement>('[data-sync-settings]')!;
    const scheduled = container.querySelector('[data-scheduled-settings]')!;
    const advanced = container.querySelector('[data-settings-section="advanced"]')!;
    expect(syncSection.contains(scheduled)).toBe(true);
    expect(syncDisclosure.getAttribute('aria-expanded')).toBe('true');
    expect(syncDisclosure.getAttribute('aria-controls')).toBe(syncDetails.id);
    expect(syncDetails.classList.contains('getnote-hidden')).toBe(false);
    expect(syncSection.textContent!.indexOf('目标文件夹')).toBeLessThan(syncSection.textContent!.indexOf('自动同步'));
    expect(syncSection.textContent).toContain('手动同步');
    expect(syncSection.textContent).toContain('同步日志');
    expect(syncSection.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(() => {
      syncDisclosure.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(syncDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(syncDetails.classList.contains('getnote-hidden')).toBe(true);
  });

  it('keeps low-frequency settings behind one accessible advanced disclosure', async () => {
    const { container } = renderSettings(makeSettings({
      lastSyncEndTimestamp: '2026-06-12T15:30:00Z',
    }));
    const disclosure = container.querySelector<HTMLButtonElement>('[data-advanced-disclosure]');
    const details = container.querySelector<HTMLElement>('[data-advanced-settings]');

    expect(disclosure).toBeTruthy();
    expect(details).toBeTruthy();
    expect(disclosure!.getAttribute('aria-controls')).toBe(details!.id);
    expect(disclosure!.getAttribute('aria-expanded')).toBe('false');
    expect(details!.classList.contains('getnote-hidden')).toBe(true);
    expect(details!.textContent).toContain('文件名前缀');
    expect(details!.textContent).toContain('按创建日期整理路径');
    expect(details!.textContent).toContain('模板文件路径');
    expect(details!.textContent).toContain('侧栏入口');
    expect(details!.textContent).not.toContain('上次同步断点');
    expect(details!.textContent).toContain('附件下载配置');
    expect(details!.querySelector('[data-attachment-settings]')).toBeTruthy();

    await act(() => {
      disclosure!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(disclosure!.getAttribute('aria-expanded')).toBe('true');
    expect(details!.classList.contains('getnote-hidden')).toBe(false);
  });

  it('turns the advanced-settings caret upward when the section expands', async () => {
    const { container } = renderSettings(makeSettings());
    const disclosure = container.querySelector<HTMLButtonElement>('[data-advanced-disclosure]')!;
    const caret = disclosure.querySelector<HTMLElement>('.getnote-disclosure-caret')!;

    expect(caret.classList.contains('is-open')).toBe(false);
    expect(caret.textContent).toBe('');

    await act(() => {
      disclosure.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(caret.classList.contains('is-open')).toBe(true);
  });

  it('keeps the initial sync date inside expandable scheduled details while scheduled sync is disabled', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      syncStartDate: '2026-01-01',
      lastSyncEndTimestamp: '',
    }));
    const scheduledDetails = container.querySelector<HTMLElement>('#getnote-scheduled-details');
    const checkpoint = container.querySelector<HTMLElement>('[data-scheduled-checkpoint]');
    const disclosure = container.querySelector<HTMLButtonElement>('.getnote-scheduled-master-row .getnote-inline-disclosure');

    expect(scheduledDetails?.classList.contains('getnote-hidden')).toBe(true);
    expect(checkpoint).toBeTruthy();
    expect(scheduledDetails?.contains(checkpoint!)).toBe(true);
    expect(disclosure).toBeTruthy();

    await act(() => disclosure!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const dateInput = checkpoint?.querySelector<HTMLInputElement>('input[type="date"]');
    expect(scheduledDetails?.classList.contains('getnote-hidden')).toBe(false);
    expect(checkpoint?.textContent).toContain('同步起始日期');
    expect(dateInput?.value).toBe('2026-01-01');

    await act(() => {
      dateInput!.value = '2025-08-01';
      dateInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('syncStartDate', '2025-08-01');
  });

  it('keeps the last sync checkpoint in the scheduled-sync section', () => {
    const { container } = renderSettings(makeSettings({
      lastSyncEndTimestamp: '2026-06-12T15:30:00Z',
    }));

    const syncSection = container.querySelector<HTMLElement>('[data-settings-section="sync"]');
    const scheduledDetails = container.querySelector<HTMLElement>('#getnote-scheduled-details');
    const advancedDetails = container.querySelector<HTMLElement>('[data-advanced-settings]');
    const checkpoint = container.querySelector<HTMLElement>('[data-scheduled-checkpoint]');

    expect(syncSection?.contains(checkpoint!)).toBe(true);
    expect(checkpoint?.textContent).toContain('上次同步断点');
    expect(scheduledDetails?.contains(checkpoint!)).toBe(true);
    expect(advancedDetails?.textContent).not.toContain('上次同步断点');
  });

  it('keeps connection-test feedback visible while credentials stay collapsed', async () => {
    vi.mocked(fetchNotes).mockResolvedValue({ notes: [], hasMore: false });
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'token',
      openApiClientId: 'client-id',
    }));

    await act(async () => {
      getTestConnectionButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('[data-credential-details]')?.classList.contains('getnote-hidden')).toBe(true);
    expect(container.querySelector('[data-settings-status]')?.textContent).toContain('连接成功');
  });

  it('uses an aligned local-change auto-upload toggle inside automatic sync details', async () => {
    const updateSetting = vi.fn();
    const { container } = renderSettings(makeSettings(), updateSetting);
    expect(container.querySelector('[data-auto-upload-settings]')).toBeNull();
    expect(container.querySelector('#getnote-sync-direction')).toBeNull();

    const details = container.querySelector<HTMLElement>('#getnote-scheduled-details')!;
    const toggle = details.querySelector<HTMLInputElement>('input[aria-label="本地修改自动上传"]')!;
    const row = toggle.closest('.getnote-scheduled-row');
    expect(row?.parentElement).toBe(details);
    expect(row?.querySelector('.getnote-scheduled-row-label')?.textContent).toBe('本地修改自动上传');
    expect(row?.querySelector('.getnote-scheduled-row-control')).not.toBeNull();
    expect(toggle.checked).toBe(false);

    await act(() => {
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(updateSetting).toHaveBeenCalledWith('reverseSync', expect.objectContaining({ enabled: true, autoUpload: undefined }));
    expect(details.textContent).toContain('仅上传同步目录中新增或修改的文字笔记');
  });

  it('replaces configured copy with an unverified connection indicator', () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'token',
      openApiClientId: 'client-id',
    }));

    const indicator = container.querySelector<HTMLElement>('[data-connection-health]');
    expect(indicator?.dataset.connectionHealth).toBe('unverified');
    expect(indicator?.textContent).toContain('未验证');
    expect(container.querySelector('[data-settings-status]')?.textContent).not.toContain('已配置');
  });

  it('restores a healthy connection only from the latest successful automatic sync', () => {
    const credentials = { authMode: 'openapi' as const, openApiToken: 'token', openApiClientId: 'client-id' };
    const manual = renderSettings(makeSettings({
      ...credentials,
      syncHistory: [makeSyncHistoryEntry('full')],
    })).container.querySelector<HTMLElement>('[data-connection-health]');
    expect(manual?.dataset.connectionHealth).toBe('unverified');

    const automatic = renderSettings(makeSettings({
      ...credentials,
      syncHistory: [makeSyncHistoryEntry('auto')],
    })).container.querySelector<HTMLElement>('[data-connection-health]');
    expect(automatic?.dataset.connectionHealth).toBe('healthy');
    expect(automatic?.textContent).toContain('连接正常');

    const latestFailed = renderSettings(makeSettings({
      ...credentials,
      syncHistory: [makeSyncHistoryEntry('auto', 'success', 2), makeSyncHistoryEntry('auto', 'failed', 3)],
    })).container.querySelector<HTMLElement>('[data-connection-health]');
    expect(latestFailed?.dataset.connectionHealth).toBe('error');
    expect(latestFailed?.textContent).toContain('连接异常');
  });

  it('shows the latest sync failure instead of idle when no sync is running', () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'token',
      openApiClientId: 'client-id',
      syncHistory: [makeSyncHistoryEntry('auto', 'failed')],
    }));

    const status = container.querySelector<HTMLElement>('[data-settings-status]');
    expect(status?.textContent).toContain('当前状态: 上次同步失败');
    expect(status?.textContent).not.toContain('当前状态: 空闲');
  });

  it('turns the indicator green and collapses open credentials after a successful test', async () => {
    vi.mocked(fetchNotes).mockResolvedValue({ notes: [], hasMore: false });
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'token',
      openApiClientId: 'client-id',
    }));
    const details = container.querySelector<HTMLElement>('[data-credential-details]')!;
    const changeButton = container.querySelector<HTMLButtonElement>('[data-change-credentials]')!;
    await act(() => changeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(details.classList.contains('getnote-hidden')).toBe(false);

    await act(async () => {
      getTestConnectionButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector<HTMLElement>('[data-connection-health]')?.dataset.connectionHealth).toBe('healthy');
    expect(details.classList.contains('getnote-hidden')).toBe(true);
  });

  it('turns the indicator red and keeps credentials open after a failed test', async () => {
    vi.mocked(fetchNotes).mockRejectedValue(new Error('Unauthorized'));
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'token',
      openApiClientId: 'client-id',
      tagCache: { tags: ['existing'], lastUpdated: 1 },
    }));
    const details = container.querySelector<HTMLElement>('[data-credential-details]')!;
    const changeButton = container.querySelector<HTMLButtonElement>('[data-change-credentials]')!;
    await act(() => changeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    await act(async () => {
      getTestConnectionButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const indicator = container.querySelector<HTMLElement>('[data-connection-health]');
    expect(indicator?.dataset.connectionHealth).toBe('error');
    expect(indicator?.textContent).toContain('连接异常');
    expect(details.classList.contains('getnote-hidden')).toBe(false);
  });

  it('resets a healthy indicator when credentials change', async () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'token',
      openApiClientId: 'client-id',
      syncHistory: [makeSyncHistoryEntry('auto')],
    }));
    const changeButton = container.querySelector<HTMLButtonElement>('[data-change-credentials]')!;
    await act(() => changeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const tokenInput = container.querySelector<HTMLInputElement>('[data-credential-details] input[type="password"]')!;

    await act(() => inputValue(tokenInput, 'replacement-token'));

    expect(container.querySelector<HTMLElement>('[data-connection-health]')?.dataset.connectionHealth).toBe('unverified');
    expect(container.querySelector('[data-credential-details]')?.classList.contains('getnote-hidden')).toBe(false);
  });

  it('keeps the scheduled disclosure available when scheduled sync is disabled', async () => {
    const { container } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true },
    }));
    const disclosure = container.querySelector<HTMLButtonElement>('.getnote-scheduled-master-row .getnote-inline-disclosure')!;
    const details = container.querySelector<HTMLElement>('#getnote-scheduled-details')!;

    await act(() => disclosure.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(details.classList.contains('getnote-hidden')).toBe(false);

    const enabledToggle = container.querySelector<HTMLInputElement>('input[aria-label="启用自动同步"]')!;
    await act(() => enabledToggle.closest('.checkbox-container')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const retainedDisclosure = container.querySelector<HTMLButtonElement>('.getnote-scheduled-master-row .getnote-inline-disclosure');
    expect(container.querySelector('#getnote-scheduled-details')?.classList.contains('getnote-hidden')).toBe(true);
    expect(retainedDisclosure).not.toBeNull();

    await act(() => retainedDisclosure!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('#getnote-scheduled-details')?.classList.contains('getnote-hidden')).toBe(false);
  });

  it('shows collapsed summaries and accessible names for setting toggles', () => {
    const { container } = renderSettings(makeSettings({
      scheduledSync: {
        ...DEFAULT_SETTINGS.scheduledSync,
        enabled: true,
        intervalMinutes: 30,
        syncOnStart: true,
      },
      attachmentImport: { image: true, audio: true, video: true, document: true },
    }));

    const scheduled = container.querySelector<HTMLElement>('[data-scheduled-settings]');
    const attachments = container.querySelector<HTMLElement>('[data-attachment-settings]');
    expect(scheduled?.textContent).toContain('每 30 分钟');
    expect(scheduled?.textContent).toContain('启动时');
    expect(scheduled?.textContent).toContain('全部笔记');
    expect(attachments?.textContent).toContain('全部附件');

    expect(scheduled?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.getAttribute('aria-label'))
      .toBe('启用自动同步');
    expect(attachments?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.getAttribute('aria-label'))
      .toBe('下载附件');
  });

  it('collapses configured credentials and reveals them through the status actions', async () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'token',
      openApiClientId: 'client-id',
    }));
    const details = container.querySelector<HTMLElement>('[data-credential-details]');
    const changeButton = container.querySelector<HTMLButtonElement>('[data-change-credentials]');

    expect(details).toBeTruthy();
    expect(changeButton).toBeTruthy();
    expect(details!.classList.contains('getnote-hidden')).toBe(true);
    expect(changeButton!.getAttribute('aria-expanded')).toBe('false');
    expect(changeButton!.getAttribute('aria-controls')).toBe(details!.id);
    expect(changeButton!.textContent).toBe('更改凭证');

    const status = container.querySelector('[data-settings-status]')!;
    const sync = container.querySelector('[data-settings-section="sync"]')!;
    expect(status.compareDocumentPosition(details!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details!.compareDocumentPosition(sync) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(() => {
      changeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(details!.classList.contains('getnote-hidden')).toBe(false);
    expect(changeButton!.getAttribute('aria-expanded')).toBe('true');
    expect(changeButton!.textContent).toBe('收起凭证');
  });

  it('opens credential guidance by default before credentials are configured', () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: '',
      openApiClientId: '',
      apiToken: '',
      clientId: '',
    }));

    expect(container.querySelector('[data-credential-details]')?.classList.contains('getnote-hidden')).toBe(false);
    expect(container.querySelector('[data-credential-guidance]')?.textContent).toContain('首次使用');
  });

  it('uses scheduled auto sync as the primary onboarding path', () => {
    const credentials = { apiToken: 'token', clientId: 'client' };
    const disabled = renderSettings(makeSettings(credentials)).container
      .querySelector<HTMLElement>('[data-credential-guidance]');
    expect(disabled?.textContent).toContain('开启「自动同步」');
    expect(disabled?.classList.contains('getnote-onboarding--needs-auto-sync')).toBe(true);

    const enabled = renderSettings(makeSettings({
      ...credentials,
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true, intervalMinutes: 30 },
    })).container.querySelector<HTMLElement>('[data-credential-guidance]');
    expect(enabled?.textContent).toContain('每 30 分钟');
    expect(enabled?.classList.contains('getnote-onboarding--ready')).toBe(true);
  });

  it('keeps manual sync secondary and hides onboarding only after automatic sync', () => {
    const credentials = { apiToken: 'token', clientId: 'client' };
    const scheduledSync = { ...DEFAULT_SETTINGS.scheduledSync, enabled: true };
    const manualHistory = renderSettings(makeSettings({
      ...credentials,
      scheduledSync,
      syncHistory: [{
        id: 'manual-1', startedAt: 1, finishedAt: 2, durationMs: 1, timestamp: 2,
        result: { created: 1, updated: 0, skipped: 0, failed: 0, total: 1, items: [] },
        type: 'full', mode: 'time', status: 'success',
      }],
    })).container;
    expect(manualHistory.querySelector('[data-credential-guidance]')?.textContent).toContain('自动同步已开启');

    const autoHistory = renderSettings(makeSettings({
      ...credentials,
      scheduledSync,
      syncHistory: [{
        id: 'auto-1', startedAt: 1, finishedAt: 2, durationMs: 1, timestamp: 2,
        result: { created: 1, updated: 0, skipped: 0, failed: 0, total: 1, items: [] },
        type: 'auto', mode: 'auto', status: 'success',
      }],
    })).container;
    expect(autoHistory.querySelector('[data-credential-guidance]')).toBeNull();
  });
});

describe('created-date path settings', () => {
  function settingItem(container: HTMLElement, label: string): HTMLElement {
    const item = Array.from(container.querySelectorAll<HTMLElement>('.setting-item'))
      .find(element => element.querySelector('.setting-item-name')?.textContent === label);
    expect(item).toBeTruthy();
    return item!;
  }

  function clickButton(container: HTMLElement, label: string): void {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(element => element.textContent?.trim() === label);
    expect(button).toBeTruthy();
    button!.click();
  }

  it('keeps date-path edits local and shows token guidance beside the filename prefix', async () => {
    const updateSetting = vi.fn();
    const { container } = renderSettings(makeSettings(), updateSetting);

    expect(settingItem(container, '文件名前缀').textContent).toContain('YYYY / MM / DD / HH / mm / ss');
    const dateItem = settingItem(container, '按创建日期整理路径');
    expect(dateItem.textContent).toContain('YYYY / MM / DD');

    const toggle = dateItem.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(() => {
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const formatInput = dateItem.querySelector<HTMLInputElement>('input[type="text"]');
    expect(formatInput?.value).toBe('YYYY/MM');
    inputValue(formatInput!, 'YYYY-MM');

    expect(updateSetting).not.toHaveBeenCalledWith('datePathEnabled', expect.anything());
    expect(updateSetting).not.toHaveBeenCalledWith('datePathFormat', expect.anything());
  });

  it('cancels an enable confirmation without saving or migrating', async () => {
    const updateSetting = vi.fn();
    const applyDatePathSettings = vi.fn();
    const previewDatePathSettings = vi.fn().mockResolvedValue({
      scanned: 3, planned: 2, moved: 0, unchanged: 1, skipped: 0, failed: 0, issues: [],
    });
    const confirmDatePathMigration = vi.fn().mockResolvedValue(false);
    const { container } = renderSettings(makeSettings(), updateSetting, vi.fn(), {
      applyDatePathSettings,
      previewDatePathSettings,
      confirmDatePathMigration,
    });
    const dateItem = settingItem(container, '按创建日期整理路径');
    const toggle = dateItem.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(() => {
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      clickButton(dateItem, '应用');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmDatePathMigration).toHaveBeenCalledWith({
      mode: 'apply',
      current: { enabled: false, format: 'YYYY/MM' },
      target: { enabled: true, format: 'YYYY/MM' },
      preview: expect.objectContaining({ scanned: 3, planned: 2 }),
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(applyDatePathSettings).not.toHaveBeenCalled();
    expect(updateSetting).not.toHaveBeenCalledWith('datePathEnabled', expect.anything());
  });

  it('confirms a format change, reports the result, and supports an unchanged reconcile', async () => {
    const previewDatePathSettings = vi.fn().mockResolvedValue({
      scanned: 5, planned: 2, moved: 0, unchanged: 1, skipped: 1, failed: 1, issues: [],
    });
    const applyDatePathSettings = vi.fn().mockResolvedValue({
      scanned: 5,
      moved: 2,
      unchanged: 1,
      skipped: 1,
      failed: 1,
      issues: [{ code: 'target-conflict', path: '得到大脑/2026/07/纯文本/a.md', message: 'Target exists' }],
    });
    const confirmDatePathMigration = vi.fn().mockResolvedValue(true);
    const { container } = renderSettings(makeSettings({
      datePathEnabled: true,
      datePathFormat: 'YYYY/MM',
    }), vi.fn(), vi.fn(), { applyDatePathSettings, previewDatePathSettings, confirmDatePathMigration });
    const dateItem = settingItem(container, '按创建日期整理路径');
    await act(() => inputValue(dateItem.querySelector<HTMLInputElement>('input[type="text"]')!, 'YYYY/MM/DD'));

    await act(async () => {
      clickButton(dateItem, '应用');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmDatePathMigration).toHaveBeenLastCalledWith({
      mode: 'apply',
      current: { enabled: true, format: 'YYYY/MM' },
      target: { enabled: true, format: 'YYYY/MM/DD' },
      preview: expect.objectContaining({ scanned: 5, planned: 2 }),
    });
    expect(applyDatePathSettings).toHaveBeenLastCalledWith({ enabled: true, format: 'YYYY/MM/DD' }, undefined);
    const result = dateItem.querySelector<HTMLElement>('[data-date-path-result]');
    expect(result?.textContent).toContain('扫描 5');
    expect(result?.textContent).toContain('移动 2');
    expect(result?.textContent).toContain('未变化 1');
    expect(result?.textContent).toContain('跳过 1');
    expect(result?.textContent).toContain('失败 1');
    expect(result?.textContent).toContain('目标路径已存在');
    expect(result?.textContent).not.toContain('Target exists');
    expect(result?.textContent).toContain('查看日志');
    expect(result?.textContent).not.toContain('得到大脑/2026/07/纯文本/a.md');

    await act(async () => {
      clickButton(dateItem, '重新整理现有文件');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(confirmDatePathMigration).toHaveBeenLastCalledWith({
      mode: 'reconcile',
      current: { enabled: true, format: 'YYYY/MM/DD' },
      target: { enabled: true, format: 'YYYY/MM/DD' },
      preview: expect.objectContaining({ scanned: 5, planned: 2 }),
    });
    expect(applyDatePathSettings).toHaveBeenLastCalledWith(
      { enabled: true, format: 'YYYY/MM/DD' },
      { rebuildCategories: true },
    );
  });

  it('localizes migration failures and keeps detailed issue paths out of the settings page', async () => {
    const rawIssues = Array.from({ length: 22 }, (_, index) => ({
      code: 'invalid-metadata',
      path: `得到大脑/纯文本/${index}.md`,
      message: `raw error ${index}`,
    }));
    const applyDatePathSettings = vi.fn()
      .mockRejectedValueOnce(new Error('raw vault exception'))
      .mockResolvedValueOnce({
        scanned: 22, moved: 0, unchanged: 0, skipped: 22, failed: 0, issues: rawIssues,
      });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = renderSettings(makeSettings(), vi.fn(), vi.fn(), {
      applyDatePathSettings,
      previewDatePathSettings: vi.fn().mockResolvedValue({
        scanned: 22, planned: 0, moved: 0, unchanged: 0, skipped: 22, failed: 0, issues: rawIssues,
      }),
      confirmDatePathMigration: vi.fn().mockResolvedValue(true),
    });
    const dateItem = settingItem(container, '按创建日期整理路径');
    const toggle = dateItem.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(() => {
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      clickButton(dateItem, '应用');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dateItem.querySelector('[role="alert"]')?.textContent).toContain('整理未完成，请重试');
    expect(dateItem.textContent).not.toContain('raw vault exception');
    expect(consoleError).toHaveBeenCalled();

    await act(async () => {
      clickButton(dateItem, '应用');
      await Promise.resolve();
      await Promise.resolve();
    });
    const result = dateItem.querySelector<HTMLElement>('[data-date-path-result]')!;
    expect(result.textContent).toContain('缺少有效的笔记元数据');
    expect(result.textContent).not.toContain('raw error 0');
    expect(result.textContent).toContain('查看日志');
    expect(result.textContent).not.toContain('19.md');
  });
});

describe('SettingsComponent auth credentials', () => {
  it('keeps the tag whitelist editable when scheduled sync is disabled', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: false },
      tagCache: { tags: ['AI', '管理'], cacheUpdatedAt: Date.now() },
    }));

    expect(container.textContent).toContain('同步范围');
    const trigger = container.querySelector('.getnote-tag-select-trigger') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    await act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const option = Array.from(container.querySelectorAll('.getnote-tag-select-option'))
      .find(label => label.textContent === 'AI') as HTMLLabelElement;
    expect(option).toBeTruthy();
    const checkbox = option.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(() => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('syncTags', ['AI']);
  });

  it('renders the exhausted quota warning inside the scheduled sync controls', () => {
    const { container } = renderSettings(makeSettings({
      lastQuotaState: { exhausted: true, reason: 'quota_day', checkedAt: Date.now() },
    }));

    const banner = container.querySelector('.getnote-quota-banner');
    expect(banner).not.toBeNull();
    expect(banner!.closest('.setting-item-control')).not.toBeNull();
  });

  it('opens knowledge-base sync from the OpenAPI manual download actions', async () => {
    const startSubscribedKnowledgeSync = vi.fn();
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'openapi-token',
      openApiClientId: 'openapi-client',
      apiToken: 'openapi-token',
      clientId: 'openapi-client',
    }), vi.fn(), vi.fn(), { startSubscribedKnowledgeSync });

    const button = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '按知识库同步');
    expect(button).toBeTruthy();
    expect(button!.disabled).toBe(false);

    await act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(startSubscribedKnowledgeSync).toHaveBeenCalledTimes(1);
  });

  it('saves the template file path from settings', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      templateFilePath: 'Templates/default.md',
    }));

    expect(container.textContent).toContain('模板文件路径');
    const input = Array.from(container.querySelectorAll('input'))
      .find((item): item is HTMLInputElement => item.value === 'Templates/default.md');
    expect(input).toBeTruthy();

    await act(() => {
      inputValue(input!, 'Templates/reading-note.md');
    });

    expect(updateSetting).toHaveBeenCalledWith('templateFilePath', 'Templates/reading-note.md');
  });

  it('suggests vault folders for the target folder path', async () => {
    const app = new App();
    vi.spyOn(app.vault, 'getAllFolders').mockReturnValue([
      makeFolder('Templates'),
      makeFolder('得到大脑'),
      makeFolder('Projects/Archive'),
    ]);

    let rendered!: ReturnType<typeof renderSettings>;
    await act(async () => {
      rendered = renderSettings(makeSettings(), vi.fn(), vi.fn(), { app });
      await Promise.resolve();
    });

    const { container } = rendered;
    const input = Array.from(container.querySelectorAll('input'))
      .find((item): item is HTMLInputElement => item.placeholder === '得到大脑');
    expect(input).toBeTruthy();

    const folderSuggest = abstractInputSuggestInstances.find(instance => instance.inputEl === input);
    expect(folderSuggest).toBeTruthy();
    expect(folderSuggest!.getSuggestions('')).toEqual([
      'Templates',
      '得到大脑',
      'Projects/Archive',
    ]);
    expect(folderSuggest!.getSuggestions('arch')).toEqual([
      'Projects/Archive',
    ]);

    const inputListener = vi.fn();
    input!.addEventListener('input', inputListener);
    await act(() => {
      folderSuggest!.selectSuggestion('Projects/Archive', new KeyboardEvent('keydown'));
    });

    expect(input!.value).toBe('Projects/Archive');
    expect(inputListener).toHaveBeenCalledTimes(1);
    expect(rendered.updateSetting).toHaveBeenCalledWith('folderName', 'Projects/Archive');
  });

  it('suggests vault Markdown files for the template file path', async () => {
    const app = new App();
    vi.spyOn(app.vault, 'getMarkdownFiles').mockReturnValue([
      new TFile('Templates/default.md'),
      new TFile('Templates/reading-note.md'),
      new TFile('Templates/reading-note'),
      new TFile('得到大脑/纯文本/已有同步笔记.md'),
    ]);
    vi.spyOn(app.vault, 'getAllFolders').mockReturnValue([
      makeFolder('Templates'),
      makeFolder('得到大脑'),
    ]);

    let rendered!: ReturnType<typeof renderSettings>;
    await act(async () => {
      rendered = renderSettings(makeSettings(), vi.fn(), vi.fn(), { app });
      await Promise.resolve();
    });
    const { container } = rendered;
    const input = Array.from(container.querySelectorAll('input'))
      .find((item): item is HTMLInputElement => item.placeholder === '例如 Templates/得到大脑模板.md');
    expect(input).toBeTruthy();
    const templateSuggest = abstractInputSuggestInstances.find(instance => instance.inputEl === input);
    expect(templateSuggest).toBeTruthy();

    expect(templateSuggest!.getSuggestions(undefined as unknown as string)).toEqual([
      'Templates/default.md',
      'Templates/reading-note',
      'Templates/reading-note.md',
      '得到大脑/纯文本/已有同步笔记.md',
    ]);
    expect(templateSuggest!.getSuggestions('read')).toEqual([
      'Templates/reading-note',
      'Templates/reading-note.md',
    ]);

    const inputListener = vi.fn();
    input!.addEventListener('input', inputListener);
    await act(() => {
      templateSuggest!.selectSuggestion('Templates/reading-note', new KeyboardEvent('keydown'));
    });

    expect(input!.value).toBe('Templates/reading-note');
    expect(inputListener).toHaveBeenCalledTimes(1);
    expect(rendered.updateSetting).toHaveBeenCalledWith('templateFilePath', 'Templates/reading-note');
  });

  it('keeps knowledge-base sync visible but unavailable in Web API mode', () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
      apiToken: 'web-token',
    }));

    const button = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '按知识库同步');
    expect(button).toBeTruthy();
    expect(button!.disabled).toBe(true);
    expect(container.textContent).toContain('需 OpenAPI 鉴权（会员）');
  });

  it('does not render a separate upload permission switch', () => {
    const { container } = renderSettings(makeSettings({
      reverseSync: { enabled: false },
    }));

    expect(container.textContent).not.toContain('允许上传本地笔记到得到大脑');
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

    expect(container.textContent).toContain('从得到大脑下载至 Obsidian');
    expect(container.textContent).toContain('从 Obsidian 上传至得到大脑');
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

  it('updates syncing progress without forcing the settings page to scroll', async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const settings = makeSettings({
        authMode: 'web',
        webApiToken: 'web-token',
        apiToken: 'web-token',
      });
      const { container } = renderSettings(settings, vi.fn(), vi.fn(), {
        isSyncing: true,
        syncProgress: { message: '正在上传到得到大脑...', count: '处理中 1 条...', percent: 50 },
      });

      await act(async () => {
        render(
          h(SettingsComponent, {
            settings,
            updateSetting: vi.fn(),
            startSync: vi.fn(),
            isSyncing: true,
            openNotePicker: vi.fn(),
            startSubscribedKnowledgeSync: vi.fn(),
            openLocalUpload: vi.fn(),
            startAutoSync: vi.fn(),
            stopAutoSync: vi.fn(),
            cancelSync: vi.fn(),
            app: new App(),
            syncProgress: { message: '正在上传到得到大脑...', count: '处理中 2 条...', percent: 100 },
          }),
          container
        );
      });

      expect(container.textContent).toContain('处理中 2 条...');
      expect(container.textContent).toContain('100%');
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('shows an indeterminate progress track while the download total is unknown', () => {
    const { container } = renderSettings(makeSettings(), vi.fn(), vi.fn(), {
      isSyncing: true,
      syncProgress: { message: '正在获取第 3 页...', count: '', percent: undefined, phase: 'active' },
    });

    const track = container.querySelector<HTMLElement>('[data-sync-progress-track]');
    expect(track?.classList.contains('is-indeterminate')).toBe(true);
    expect(container.textContent).not.toContain('0%');
  });

  it('keeps a completed sync result visible after active syncing ends', () => {
    const { container } = renderSettings(makeSettings(), vi.fn(), vi.fn(), {
      isSyncing: false,
      syncProgress: { message: '同步完成', count: '已处理 62 / 100', percent: 100, phase: 'success' },
    });

    const status = container.querySelector<HTMLElement>('[data-sync-progress]');
    expect(status).toBeTruthy();
    expect(status?.dataset.syncProgressPhase).toBe('success');
    expect(status?.textContent).toContain('同步完成');
    expect(status?.textContent).toContain('100%');
    expect(status?.querySelector('button')).toBeNull();
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

  it('clears pending connection-status timeout when settings unmounts', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const { container } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'gk-openapi-token',
      openApiClientId: 'cli-openapi',
    }));

    await act(async () => {
      getTestConnectionButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    render(null, container);

    expect(clearTimeoutSpy).toHaveBeenCalled();
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

  it('automatically saves a validated desktop Web token without requiring DevTools', async () => {
    const startDesktopWebAuth = vi.fn().mockResolvedValue('Bearer desktop-token');
    const { container, updateSetting } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: 'Bearer old-token',
    }), vi.fn(), vi.fn(), {
      desktopWebAuthAvailable: true,
      startDesktopWebAuth,
    });

    const loginButton = Array.from(container.querySelectorAll('button'))
      .find((button): button is HTMLButtonElement => button.textContent === '网页登录并自动获取 Token');
    expect(loginButton).toBeTruthy();

    await act(async () => {
      loginButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startDesktopWebAuth).toHaveBeenCalledOnce();
    expect(updateSetting).toHaveBeenCalledWith('webApiToken', 'Bearer desktop-token');
    expect(updateSetting).toHaveBeenCalledWith('apiToken', 'Bearer desktop-token');
    expect((container.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('Bearer desktop-token');
  });

  it('keeps the manual Web Token flow unchanged when desktop auth is unavailable', () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: '',
    }), vi.fn(), vi.fn(), {
      desktopWebAuthAvailable: false,
    });

    expect(container.querySelector('input[placeholder*="Authorization header"]')).not.toBeNull();
    expect(container.textContent).not.toContain('网页登录并自动获取 Token');
  });

  it('clears the saved token even when clearing the desktop login session fails', async () => {
    const clearDesktopWebAuth = vi.fn().mockRejectedValue(new Error('session cleanup failed'));
    const { container, updateSetting } = renderSettings(makeSettings({
      authMode: 'web',
      apiToken: 'Bearer saved-token',
      webApiToken: 'Bearer saved-token',
    }), vi.fn(), vi.fn(), {
      desktopWebAuthAvailable: true,
      clearDesktopWebAuth,
    });

    const logoutButton = Array.from(container.querySelectorAll('button'))
      .find((button): button is HTMLButtonElement => button.textContent === '退出并清除登录');
    expect(logoutButton).toBeTruthy();

    await act(async () => {
      logoutButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateSetting).toHaveBeenCalledWith('webApiToken', '');
    expect(updateSetting).toHaveBeenCalledWith('apiToken', '');
    expect(clearDesktopWebAuth).toHaveBeenCalledOnce();
  });

  it('allows clearing an isolated desktop session even when no token was captured', () => {
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      apiToken: '',
      webApiToken: '',
    }), vi.fn(), vi.fn(), {
      desktopWebAuthAvailable: true,
      clearDesktopWebAuth: vi.fn().mockResolvedValue(undefined),
    });

    const logoutButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '退出并清除登录');
    expect(logoutButton).toBeTruthy();
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
    expect(links.some((href) => href.includes('README.md#%E5%85%B3%E4%BA%8E%E4%BD%9C%E8%80%85') || href.includes('README.md#关于作者'))).toBe(true);
    expect(links.some((href) => href.includes('docs/web-mode-manual-token_zh.md'))).toBe(true);
  });

  it('opens settings documentation links in the external browser', async () => {
    initI18n('zh-CN');
    const openExternal = mockOpenExternal();
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
    }));

    const communityLink = Array.from(container.querySelectorAll('a'))
      .find((link): link is HTMLAnchorElement => link.textContent === '欢迎交流、留下star');
    const helpLink = Array.from(container.querySelectorAll('a'))
      .find((link): link is HTMLAnchorElement => link.textContent === '查看图文步骤');
    expect(communityLink).toBeTruthy();
    expect(helpLink).toBeTruthy();

    await act(() => {
      communityLink!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      helpLink!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('README.md'));
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('docs/web-mode-manual-token_zh.md'));
  });

  it('uses English README links in English locale', () => {
    initI18n('en-US');
    const { container } = renderSettings(makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
    }));

    const links = Array.from(container.querySelectorAll('a')).map((link) => link.href);
    expect(links.some((href) => href.includes('README_EN.md#about-the-author'))).toBe(true);
    expect(links.some((href) => href.includes('docs/web-mode-manual-token.md'))).toBe(true);
  });

  it('renders a reset button next to the last sync checkpoint', () => {
    const { container } = renderSettings(makeSettings({
      syncStartDate: '2026-01-01',
      lastSyncEndTimestamp: '2026-06-12T15:30:00+08:00',
    }));

    const row = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(node => node.textContent?.includes('上次同步断点'));
    expect(row).toBeTruthy();
    // The checkpoint is rendered in the viewer's local timezone via toLocaleString.
    // The original +08:00 input is converted to local time; we compare against the
    // same conversion so the test is timezone-independent.
    const expectedLocal = new Date('2026-06-12T15:30:00+08:00').toLocaleString();
    expect(row!.textContent).toContain(expectedLocal);

    const resetButton = Array.from(row!.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '重置');
    expect(resetButton).toBeTruthy();
  });

  it('renders a UTC checkpoint in the local timezone and includes the timezone abbreviation', () => {
    // 2026-06-12T15:30:00Z (UTC) — toLocaleString should convert to local time
    // and include a timezone abbreviation (e.g. "GMT+8" for zh-CN, "PDT" for en-US, etc.).
    // The original bug stripped the timezone info entirely, so any output containing a
    // timezone abbreviation is the contract under test.
    const utcIso = '2026-06-12T15:30:00Z';
    const expectedLocal = new Date(utcIso).toLocaleString();

    const { container } = renderSettings(makeSettings({
      syncStartDate: '2026-01-01',
      lastSyncEndTimestamp: utcIso,
    }));

    const row = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(node => node.textContent?.includes('上次同步断点'));
    expect(row).toBeTruthy();
    // The displayed text must equal the local-time conversion of the UTC ISO.
    expect(row!.textContent).toContain(expectedLocal);
    // Must NOT silently strip the timezone — the rendered text must include a
    // timezone abbreviation produced by toLocaleString (e.g. "GMT+8", "UTC",
    // "CST", "JST" depending on the test environment's locale).
    const tzAbbrevPattern = /(GMT[+\-]\d+|UTC|CST|JST|EST|EDT|PST|PDT|UTC[+\-]\d+)/;
    expect(row!.textContent).toMatch(tzAbbrevPattern);
  });

  it('reveals the inline start date editor when the reset button is clicked', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 27, 8, 30));
    const { container } = renderSettings(makeSettings({
      syncStartDate: '2026-01-01',
      lastSyncEndTimestamp: '2026-06-12T15:30:00+08:00',
    }));

    const resetButton = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '重置');
    expect(resetButton).toBeTruthy();

    await act(() => {
      resetButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Label switches to "同步起始日期", date input becomes editable, and Save/Cancel buttons appear
    const editorRow = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(node => node.textContent?.includes('同步起始日期'));
    expect(editorRow).toBeTruthy();
    const dateInput = editorRow!.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    expect(dateInput.value).toBe('2026-06-27');
    expect(dateInput.readOnly).toBe(false);

    const saveButton = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '保存');
    const cancelButton = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '取消');
    expect(saveButton).toBeTruthy();
    expect(cancelButton).toBeTruthy();
  });

  it('clears lastSyncEndTimestamp and updates syncStartDate when the reset editor saves', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      syncStartDate: '2026-01-01',
      lastSyncEndTimestamp: '2026-06-12T15:30:00+08:00',
    }));

    const resetButton = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '重置');
    await act(() => {
      resetButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const editorRow = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(node => node.textContent?.includes('同步起始日期'));
    const dateInput = editorRow!.querySelector('input[type="date"]') as HTMLInputElement;
    await act(() => {
      dateInput.value = '2025-08-01';
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '保存');
    await act(() => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('lastSyncEndTimestamp', '');
    expect(updateSetting).toHaveBeenCalledWith('syncStartDate', '2025-08-01');
  });

  it('rejects an empty start date in the reset editor and keeps the previous syncStartDate', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      syncStartDate: '2026-01-01',
      lastSyncEndTimestamp: '2026-06-12T15:30:00+08:00',
    }));

    const resetButton = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '重置');
    await act(() => {
      resetButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const editorRow = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(node => node.textContent?.includes('同步起始日期'));
    const dateInput = editorRow!.querySelector('input[type="date"]') as HTMLInputElement;
    await act(() => {
      // User clears the date input — pendingStartDate is now ''.
      dateInput.value = '';
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '保存');
    await act(() => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // The previous syncStartDate ('2026-01-01') must NOT be overwritten with an
    // empty string — the original bug silently fell back to maxDays (default 30
    // days). The fix is to refuse the save when the input is empty so the
    // existing value remains intact.
    expect(updateSetting).not.toHaveBeenCalledWith('syncStartDate', '');
    expect(updateSetting).not.toHaveBeenCalledWith('syncStartDate', '2026-01-01');
  });

  it('discards changes when the reset editor is cancelled', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      syncStartDate: '2026-01-01',
      lastSyncEndTimestamp: '2026-06-12T15:30:00+08:00',
    }));

    const resetButton = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '重置');
    await act(() => {
      resetButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const editorRow = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(node => node.textContent?.includes('同步起始日期'));
    const dateInput = editorRow!.querySelector('input[type="date"]') as HTMLInputElement;
    await act(() => {
      dateInput.value = '2025-08-01';
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const cancelButton = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '取消');
    await act(() => {
      cancelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(updateSetting).not.toHaveBeenCalledWith('lastSyncEndTimestamp', '');
    expect(updateSetting).not.toHaveBeenCalledWith('syncStartDate', '2025-08-01');

    // UI returns to state A
    const checkpointRow = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(node => node.textContent?.includes('上次同步断点'));
    expect(checkpointRow).toBeTruthy();
    const expectedLocal = new Date('2026-06-12T15:30:00+08:00').toLocaleString();
    expect(checkpointRow!.textContent).toContain(expectedLocal);
  });

  it('uses local today as the default value when reset is clicked', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 27, 8, 30));
    const { container } = renderSettings(makeSettings({
      syncStartDate: '2025-12-15',
      lastSyncEndTimestamp: '2026-06-12T15:30:00+08:00',
    }));

    const resetButton = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '重置');
    await act(() => {
      resetButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const editorRow = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(node => node.textContent?.includes('同步起始日期'));
    const dateInput = editorRow!.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-06-27');
  });

  it('renders the attachment controls flat in the clarified order', async () => {
    const settings = makeSettings();
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(
        h(SettingsComponent, {
          settings,
          updateSetting: vi.fn(),
          startSync: vi.fn(),
          isSyncing: false,
          openNotePicker: vi.fn(),
          startSubscribedKnowledgeSync: vi.fn(),
          openLocalUpload: vi.fn(),
          startAutoSync: vi.fn(),
          stopAutoSync: vi.fn(),
          cancelSync: vi.fn(),
          app: new App(),
        }),
        container
      );
    });
    await new Promise(r => setTimeout(r, 50));

    const labels = Array.from(container.querySelectorAll('[data-attachment-settings] .getnote-scheduled-row-label'))
      .map(node => node.firstChild?.textContent?.trim() || node.textContent?.trim());
    expect(labels).toEqual([
      '下载附件',
      '图片文件',
      '音频文件',
      '音频口水稿',
      '视频文件',
      '文档文件',
    ]);
    expect(container.querySelector('[data-attachment-settings] .getnote-inline-disclosure')).toBeNull();
    expect(container.querySelector('[data-attachment-settings] .getnote-hidden')).toBeNull();
  });

  it('flips all five child toggles when the master attachment toggle is clicked', async () => {
    const { container, updateSetting } = renderStatefulSettings(makeSettings({
      attachmentImport: { image: true, audio: true, video: true, document: true },
    }));
    await new Promise(r => setTimeout(r, 50));

    const masterRow = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(row => row.textContent?.includes('下载附件'));
    expect(masterRow).toBeTruthy();

    const masterToggle = masterRow!.querySelector('.checkbox-container');
    expect(masterToggle).toBeTruthy();

    await act(() => {
      masterToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('attachmentImport', {
      image: false,
      audio: false,
      audioTranscript: false,
      video: false,
      document: false,
    });
    const childToggles = Array.from(container.querySelectorAll('.getnote-attachment-options .checkbox-container'));
    expect(childToggles.every(toggle => !toggle.classList.contains('is-enabled'))).toBe(true);
  });

  it('updates all attachment toggles without requiring the settings page to rerender', async () => {
    const settings = makeSettings({
      attachmentImport: { image: true, audio: true, audioTranscript: true, video: true, document: true },
    });
    const updateSetting = vi.fn(<K extends keyof Settings>(key: K, value: Settings[K]) => {
      (settings as unknown as Record<string, unknown>)[key] = value as unknown;
    });
    const { container } = renderSettings(settings, updateSetting);
    const masterRow = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(row => row.textContent?.includes('下载附件'))!;
    const masterToggle = masterRow.querySelector('.checkbox-container')!;

    await act(() => {
      masterToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    let childToggles = Array.from(container.querySelectorAll('.getnote-attachment-options .checkbox-container'));
    expect(childToggles.every(toggle => !toggle.classList.contains('is-enabled'))).toBe(true);

    await act(() => {
      masterToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    childToggles = Array.from(container.querySelectorAll('.getnote-attachment-options .checkbox-container'));
    expect(childToggles.every(toggle => toggle.classList.contains('is-enabled'))).toBe(true);
    const attachmentUpdates = updateSetting.mock.calls.filter(([key]) => key === 'attachmentImport');
    expect(attachmentUpdates).toEqual([['attachmentImport', {
      image: false,
      audio: false,
      audioTranscript: false,
      video: false,
      document: false,
    }], ['attachmentImport', {
      image: true,
      audio: true,
      audioTranscript: true,
      video: true,
      document: true,
    }]]);
  });

  it('enables all child toggles when a mixed attachment master is clicked', async () => {
    const { container, updateSetting } = renderStatefulSettings(makeSettings({
      attachmentImport: { image: true, audio: false, video: true, document: false },
    }));

    await new Promise(r => setTimeout(r, 50));
    const masterRow = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(row => row.textContent?.includes('下载附件'));
    const masterToggle = masterRow!.querySelector('.checkbox-container')!;

    await act(() => {
      masterToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('attachmentImport', {
      image: true,
      audio: true,
      audioTranscript: true,
      video: true,
      document: true,
    });
    const childToggles = Array.from(container.querySelectorAll('.getnote-attachment-options .checkbox-container'));
    expect(childToggles.every(toggle => toggle.classList.contains('is-enabled'))).toBe(true);
  });

  it('disables child attachment toggles when the master is off', async () => {
    const updateSetting = vi.fn();
    const settings = makeSettings({
      attachmentImport: { image: false, audio: false, audioTranscript: false, video: false, document: false },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(
        h(SettingsComponent, {
          settings,
          updateSetting,
          startSync: vi.fn(),
          isSyncing: false,
          openNotePicker: vi.fn(),
          startSubscribedKnowledgeSync: vi.fn(),
          openLocalUpload: vi.fn(),
          startAutoSync: vi.fn(),
          stopAutoSync: vi.fn(),
          cancelSync: vi.fn(),
          app: new App(),
        }),
        container
      );
    });
    await new Promise(r => setTimeout(r, 50));

    const audioRow = Array.from(container.querySelectorAll('.getnote-scheduled-row'))
      .find(row => row.textContent?.includes('音频'));
    expect(audioRow).toBeTruthy();
    const audioToggle = audioRow!.querySelector('.checkbox-container');
    expect(audioToggle).toBeTruthy();
    expect(audioToggle!.classList.contains('is-enabled')).toBe(false);
    expect(audioToggle!.classList.contains('is-disabled')).toBe(true);

    await act(() => {
      audioToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(updateSetting).not.toHaveBeenCalledWith('attachmentImport', expect.anything());
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
      .find(button => button.textContent === '全部笔记');
    expect(trigger).toBeTruthy();
    await act(() => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const plainTextOption = Array.from(container.querySelectorAll('label'))
      .find(label => label.textContent === '文字笔记');
    expect(plainTextOption).toBeTruthy();
    const checkbox = plainTextOption!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    await act(() => {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSetting).not.toHaveBeenCalledWith('enabledNoteTypes', expect.anything());
    expect(updateSetting).toHaveBeenCalledWith('scheduledSync', expect.objectContaining({
      ...scheduledSync,
      enabledNoteTypes: expect.arrayContaining(['immediate_audio', 'recorder_audio', 'audio_long', 'local_audio', 'audio', 'class_audio', 'recorder_flash_audio', 'internal_record', 'meeting', 'link', 'img_text', 'blogger_post']),
    }));
  });

  it('renders note type and tag filters inside scheduled sync controls', () => {
    const { container } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true },
      maxDays: 14,
    }));

    const noteTypeLabel = Array.from(container.querySelectorAll('.getnote-scheduled-row-label'))
      .find(node => node.textContent === '同步笔记类型');
    const tagLabel = Array.from(container.querySelectorAll('.getnote-scheduled-row-label'))
      .find(node => node.textContent === '同步范围');

    expect(noteTypeLabel).toBeTruthy();
    expect(noteTypeLabel!.closest('.getnote-scheduled-rows')).not.toBeNull();
    expect(tagLabel).toBeTruthy();
    expect(tagLabel!.closest('.getnote-scheduled-rows')).not.toBeNull();
  });

  it('keeps scheduled sync details collapsed and does not render auto sync range there', async () => {
    const { container } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true },
      maxDays: 30,
    }));

    const disclosure = container.querySelector('.getnote-scheduled-row .getnote-inline-disclosure') as HTMLButtonElement;
    expect(disclosure).toBeTruthy();
    const details = container.querySelector('.getnote-scheduled-rows');
    expect(details).toBeTruthy();
    expect(details!.classList.contains('getnote-hidden')).toBe(true);
    await act(() => {
      disclosure.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(details!.classList.contains('getnote-hidden')).toBe(false);
    expect(container.textContent).not.toContain('自动同步范围');
  });

  it('renders the knowledge-base dropdown inside scheduled sync controls', () => {
    const { container } = renderSettings(makeSettings({
      scheduledSync: {
        ...DEFAULT_SETTINGS.scheduledSync,
        enabled: true,
        syncKnowledgeBases: ['kb-1'],
      },
    }));

    const labelNode = Array.from(container.querySelectorAll('span'))
      .find(node => node.textContent === '允许同步知识库');
    expect(labelNode).toBeTruthy();
    expect(labelNode!.closest('.getnote-scheduled-row')).not.toBeNull();
  });

  it('stores the selected knowledge bases inside scheduled sync settings', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true },
    }), vi.fn(), vi.fn(), {
      initialKnowledgeBaseCache: {
        entries: [{ topicId: 'kb-test', name: '测试知识库' }],
      },
    });

    const trigger = Array.from(container.querySelectorAll('.getnote-knowledge-base-select-trigger'))[0] as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    await act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const kbOption = Array.from(container.querySelectorAll('label'))
      .find(label => label.textContent === '测试知识库');
    expect(kbOption).toBeTruthy();
    const checkbox = kbOption!.querySelector('input[type="checkbox"]') as HTMLInputElement;

    await act(() => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('scheduledSync', expect.objectContaining({
      syncKnowledgeBases: ['kb-test'],
    }));
  });

  it('keeps the sync history button compact', () => {
    const { container } = renderSettings(makeSettings());
    const button = Array.from(container.querySelectorAll('button'))
      .find((item): item is HTMLButtonElement => item.textContent === '查看日志');
    expect(button).toBeTruthy();
    expect(button!.classList.contains('getnote-view-history-btn')).toBe(true);
  });

  it('keeps sync history as a lightweight entry without repeating the top status summary', () => {
    const { container } = renderSettings(makeSettings());
    const history = container.querySelector<HTMLElement>('.getnote-sync-log-section');

    expect(history?.textContent).toContain('查看日志');
    expect(history?.textContent).not.toContain('上次同步');
    expect(history?.textContent).not.toContain('当前状态');
    expect(container.textContent).toContain('保留最近 30 天同步记录');
  });
});

describe('SettingsComponent — tag cache lazy seed (#238)', () => {
  beforeEach(() => {
    vi.mocked(fetchNotes).mockClear();
    vi.mocked(fetchNotes).mockResolvedValue({ notes: [], hasMore: false });
  });

  it('seeds the tag cache once credentials are configured after the first render', async () => {
    const initialNotes = [
      { note_id: 'n1', tags: [{ name: 'AI' }] },
      { note_id: 'n2', tags: [{ name: '管理' }] },
    ];
    vi.mocked(fetchNotes).mockResolvedValueOnce({ notes: initialNotes, hasMore: false });

    const { container, updateSetting } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: '',
      openApiClientId: '',
      apiToken: '',
      clientId: '',
      tagCache: { tags: [], lastUpdated: 0 },
    }));

    // The first run sees no token and returns early; no fetch issued yet.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchNotes).not.toHaveBeenCalled();

    // Configure credentials in the inputs (the way the user actually does).
    const clientIdInput = container.querySelector('input[placeholder="Client ID：cli_xxx"]') as HTMLInputElement;
    const tokenInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(clientIdInput).not.toBeNull();
    expect(tokenInput).not.toBeNull();
    await act(() => {
      inputValue(clientIdInput!, 'cli-openapi');
      inputValue(tokenInput!, 'gk-openapi-token');
    });

    // Wait for the lazy-seed effect to re-run and call fetchNotes.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateSetting).toHaveBeenCalledWith('openApiClientId', 'cli-openapi');
    expect(updateSetting).toHaveBeenCalledWith('openApiToken', 'gk-openapi-token');
    expect(fetchNotes).toHaveBeenCalledWith(expect.objectContaining({
      authMode: 'openapi',
      token: 'gk-openapi-token',
      clientId: 'cli-openapi',
      sinceId: '0',
    }));
  });

  it('does not refetch the tag cache when credentials change after the cache is already seeded', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      authMode: 'openapi',
      openApiToken: 'gk-openapi-token',
      openApiClientId: 'cli-openapi',
      apiToken: 'gk-openapi-token',
      clientId: 'cli-openapi',
      tagCache: { tags: ['AI', '管理'], lastUpdated: Date.now() },
    }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchNotes).not.toHaveBeenCalled();

    // Switch credentials — guard on cache.lastUpdated > 0 should still skip.
    const tokenInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(tokenInput).not.toBeNull();
    await act(() => {
      inputValue(tokenInput!, 'gk-other-token');
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateSetting).toHaveBeenCalledWith('openApiToken', 'gk-other-token');
    expect(fetchNotes).not.toHaveBeenCalled();
  });
});

describe('SettingsComponent scheduled sync toggles (#136)', () => {
  function findScheduledEnabledRow(container: HTMLElement): HTMLElement {
    const rows = container.querySelectorAll('.getnote-scheduled-row');
    const row = Array.from(rows).find((el) => el.textContent?.includes('启用自动同步'));
    expect(row).toBeTruthy();
    return row!;
  }

  function findSyncOnStartRow(container: HTMLElement): HTMLElement {
    const rows = container.querySelectorAll('.getnote-scheduled-row');
    const row = Array.from(rows).find((el) => el.textContent?.includes('启动时同步'));
    expect(row).toBeTruthy();
    return row!;
  }

  it('renders scheduledEnabled as an Obsidian toggle (not a plain checkbox)', () => {
    const { container } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: false },
    }));

    const row = findScheduledEnabledRow(container);
    const toggleContainers = row.querySelectorAll('.checkbox-container');
    const plainCheckboxes = row.querySelectorAll(':scope > input[type="checkbox"]');

    expect(toggleContainers.length).toBe(1);
    expect(plainCheckboxes.length).toBe(0);
    const innerCheckbox = toggleContainers[0].querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(innerCheckbox).toBeTruthy();
    expect(innerCheckbox.checked).toBe(false);
  });

  it('renders the scheduledEnabled label with the scheduled row label styling', () => {
    const { container } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: false },
    }));

    const row = findScheduledEnabledRow(container);
    const label = row.querySelector(':scope > span:first-child');

    expect(row.classList.contains('getnote-scheduled-master-row')).toBe(true);
    expect(label?.classList.contains('getnote-scheduled-row-label')).toBe(true);
  });

  it('renders syncOnStart as an Obsidian toggle inside the scheduled sync options', () => {
    const { container } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true, syncOnStart: true },
    }));

    const row = findSyncOnStartRow(container);
    const toggleContainers = row.querySelectorAll('.checkbox-container');
    const plainCheckboxes = row.querySelectorAll(':scope > input[type="checkbox"]');

    expect(toggleContainers.length).toBe(1);
    expect(plainCheckboxes.length).toBe(0);
    const innerCheckbox = toggleContainers[0].querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(innerCheckbox).toBeTruthy();
    expect(innerCheckbox.checked).toBe(true);
    expect(toggleContainers[0].classList.contains('is-enabled')).toBe(true);
  });

  it('preserves onChange behavior for scheduledEnabled toggle', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: false },
    }));

    const row = findScheduledEnabledRow(container);
    const innerCheckbox = row.querySelector('.checkbox-container input[type="checkbox"]') as HTMLInputElement;
    expect(innerCheckbox).toBeTruthy();

    await act(() => {
      innerCheckbox.checked = true;
      innerCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('scheduledSync', expect.objectContaining({
      enabled: true,
    }));
    expect(row.querySelector('.checkbox-container')?.classList.contains('is-enabled')).toBe(true);
  });

  it('toggles scheduled sync when clicking the Obsidian switch container', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: false },
    }));

    const row = findScheduledEnabledRow(container);
    const switchContainer = row.querySelector('.checkbox-container') as HTMLElement;
    expect(switchContainer).toBeTruthy();

    await act(() => {
      switchContainer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('scheduledSync', expect.objectContaining({
      enabled: true,
    }));
    expect(switchContainer.classList.contains('is-enabled')).toBe(true);
  });

  it('preserves onChange behavior for syncOnStart toggle', async () => {
    const { container, updateSetting } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true, syncOnStart: false },
    }));

    const row = findSyncOnStartRow(container);
    const innerCheckbox = row.querySelector('.checkbox-container input[type="checkbox"]') as HTMLInputElement;
    expect(innerCheckbox).toBeTruthy();

    await act(() => {
      innerCheckbox.checked = true;
      innerCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('scheduledSync', expect.objectContaining({
      enabled: true,
      syncOnStart: true,
    }));
  });
});

describe('SettingsComponent ribbon actions', () => {
  it('renders separately enabled sync and search ribbon toggles by default', async () => {
    const { container, updateSetting } = renderSettings(makeSettings());

    const section = Array.from(container.querySelectorAll('.setting-item'))
      .find(item => item.textContent?.includes('侧栏入口'));

    expect(section).toBeTruthy();
    expect(section!.textContent).toContain('同步侧栏入口');
    expect(section!.textContent).toContain('搜索侧栏入口');
    const toggles = section!.querySelectorAll('.checkbox-container');
    expect(toggles).toHaveLength(2);
    expect(Array.from(toggles).every(toggle => toggle.classList.contains('is-enabled'))).toBe(true);

    await act(() => {
      toggles[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('ribbonActions', { sync: false, search: true });
  });

  it('applies two rapid clicks as two opposite ribbon setting changes', async () => {
    const { container, updateSetting } = renderStatefulSettings(makeSettings());
    const section = Array.from(container.querySelectorAll('.setting-item'))
      .find(item => item.textContent?.includes('侧栏入口'))!;
    const syncToggle = section.querySelector('.checkbox-container')!;

    await act(() => {
      syncToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      syncToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const ribbonUpdates = updateSetting.mock.calls.filter(([key]) => key === 'ribbonActions');
    expect(ribbonUpdates).toEqual([
      ['ribbonActions', { sync: false, search: true }],
      ['ribbonActions', { sync: true, search: true }],
    ]);
    expect(syncToggle.classList.contains('is-enabled')).toBe(true);
  });
});

describe('SettingsComponent — syncTags (tag whitelist) dropdown', () => {
  it('renders the sync range setting with the tag whitelist dropdown', () => {
    const { container } = renderSettings(makeSettings({
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, enabled: true },
      syncTags: ['work', 'project'],
      tagCache: { tags: ['work', 'project', 'daily'], lastUpdated: Date.now() },
    }));

    const syncRangeLabel = Array.from(container.querySelectorAll('.getnote-scheduled-row-label'))
      .find(node => node.textContent === '同步范围');
    expect(syncRangeLabel).toBeTruthy();
    expect(syncRangeLabel!.closest('.getnote-scheduled-rows')).not.toBeNull();
    const tagTrigger = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '已选 2 项');
    expect(tagTrigger).toBeTruthy();
  });

  it('shows "All tags" label when syncTags is empty', () => {
    const { container } = renderSettings(makeSettings({
      syncTags: [],
      tagCache: { tags: ['work', 'daily'], lastUpdated: Date.now() },
    }));

    const tagTrigger = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '全部标签');
    expect(tagTrigger).toBeTruthy();
  });

  it('calls updateSetting with syncTags when the dropdown selection changes', async () => {
    const updateSetting = vi.fn();
    const { container } = renderSettings(makeSettings({
      syncTags: [],
      tagCache: { tags: ['work', 'daily'], lastUpdated: Date.now() },
    }), updateSetting);

    const tagTrigger = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '全部标签');
    expect(tagTrigger).toBeTruthy();
    await act(() => {
      tagTrigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const workOption = Array.from(container.querySelectorAll('label'))
      .find(label => label.textContent === 'work');
    expect(workOption).toBeTruthy();
    const workCheckbox = workOption!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(() => {
      workCheckbox.checked = true;
      workCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('syncTags', ['work']);
  });

  it('supports fuzzy search in the dropdown to filter options', async () => {
    const { container } = renderSettings(makeSettings({
      syncTags: [],
      tagCache: { tags: ['work', 'project', 'personal', 'health'], lastUpdated: Date.now() },
    }));

    const tagTrigger = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '全部标签');
    expect(tagTrigger).toBeTruthy();
    await act(() => {
      tagTrigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const searchInput = container.querySelector('.getnote-tag-select-search input') as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    await act(() => {
      searchInput.value = 'wo';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container.textContent).toContain('work');
    expect(container.textContent).not.toContain('project');
    expect(container.textContent).not.toContain('personal');
    expect(container.textContent).not.toContain('health');
  });
});
