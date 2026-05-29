import { Notice } from 'obsidian';

const PREFIX = '[得到大脑]';

export function showNotice(message: string, timeout = 5000): void {
  new Notice(`${PREFIX} ${message}`, timeout);
}

export function showError(message: string, timeout = 7000): void {
  const n = new Notice(`❌ ${PREFIX} ${message}`, timeout);
  const el = n.noticeEl;
  if (el) {
    el.style.color = '#e55353';
    el.style.fontWeight = '500';
  }
}

export function showSuccess(message: string, timeout = 5000): void {
  const n = new Notice(`✅ ${PREFIX} ${message}`, timeout);
  const el = n.noticeEl;
  if (el) {
    el.style.color = '#5fb05f';
    el.style.fontWeight = '500';
  }
}

export function showInfo(message: string, timeout = 4000): void {
  new Notice(`${PREFIX} ${message}`, timeout);
}
