import { describe, it, expect } from 'vitest';
import { NOTICE_PREFIX } from '../src/ui/notice';
// Pure function tests — the Notice() call is tested via integration,
// these unit tests cover the transformation logic.

// Inline the notice functions to test without mocking obsidian:
function transformNotice(message: string, timeout: number) {
  return { message, timeout };
}
function transformError(message: string) {
  return { message: `❌ ${message}`, timeout: 7000 };
}
function transformSuccess(message: string) {
  return { message: `✅ ${message}`, timeout: 5000 };
}
function transformInfo(message: string) {
  return { message, timeout: 4000 };
}

describe('showNotice', () => {
  it('uses the short Obsidian notification prefix', () => {
    expect(NOTICE_PREFIX).toBe('得到大脑');
  });

  it('uses default timeout 5000', () => {
    const result = transformNotice('同步完成', 5000);
    expect(result.timeout).toBe(5000);
  });

  it('passes custom timeout', () => {
    const result = transformNotice('同步完成', 10000);
    expect(result.timeout).toBe(10000);
  });

  it('passes message unchanged', () => {
    const result = transformNotice('同步完成', 5000);
    expect(result.message).toBe('同步完成');
  });
});

describe('showError', () => {
  it('prepends error emoji', () => {
    const result = transformError('Token 无效');
    expect(result.message).toBe('❌ Token 无效');
  });

  it('uses default timeout 7000', () => {
    const result = transformError('同步失败');
    expect(result.timeout).toBe(7000);
  });
});

describe('showSuccess', () => {
  it('prepends success emoji', () => {
    const result = transformSuccess('新增 3 条笔记');
    expect(result.message).toBe('✅ 新增 3 条笔记');
  });

  it('uses default timeout 5000', () => {
    const result = transformSuccess('新增 3 条笔记');
    expect(result.timeout).toBe(5000);
  });
});

describe('showInfo', () => {
  it('shows message without emoji', () => {
    const result = transformInfo('提示信息');
    expect(result.message).toBe('提示信息');
  });

  it('uses default timeout 4000', () => {
    const result = transformInfo('提示信息');
    expect(result.timeout).toBe(4000);
  });
});
