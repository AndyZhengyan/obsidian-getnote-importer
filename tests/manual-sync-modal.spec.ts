import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ManualSyncModal } from '../src/ui/manual-sync-modal';

function renderModal(initialOptions: { syncStartDate: string; maxDays: number; enabledNoteTypes?: string[] }, onConfirm = vi.fn()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(
    h(ManualSyncModal, {
      initialOptions,
      onConfirm,
      onCancel: vi.fn(),
    }),
    container
  );
  return { container, onConfirm };
}

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

describe('ManualSyncModal filters', () => {
  it('defaults to days mode and submits maxDays >= 1', async () => {
    const { container, onConfirm } = renderModal({ syncStartDate: '', maxDays: 0 });

    const daysInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(daysInput).toBeTruthy();
    expect(daysInput.value).toBe('0');

    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith({ syncStartDate: '', maxDays: 1 });
  });

  it('submits configured maxDays in days mode', async () => {
    const { container, onConfirm } = renderModal({ syncStartDate: '', maxDays: 30 });

    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith({ syncStartDate: '', maxDays: 30 });
  });

  it('uses date mode when syncStartDate exists and disables maxDays', async () => {
    const { container, onConfirm } = renderModal({ syncStartDate: '2026-05-09', maxDays: 0 });

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    expect(dateInput.value).toBe('2026-05-09');

    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith({ syncStartDate: '2026-05-09', maxDays: 0 });
  });

  it('prefers the stricter filter when both date and days are present: days', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-19T00:00:00Z').getTime());
    const { container, onConfirm } = renderModal({ syncStartDate: '2026-05-09', maxDays: 7 });

    const daysInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(daysInput).toBeTruthy();
    expect(daysInput.value).toBe('7');

    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith({ syncStartDate: '', maxDays: 7 });
  });

  it('prefers the stricter filter when both date and days are present: date', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-19T00:00:00Z').getTime());
    const { container, onConfirm } = renderModal({ syncStartDate: '2026-05-18', maxDays: 7 });

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    expect(dateInput.value).toBe('2026-05-18');

    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith({ syncStartDate: '2026-05-18', maxDays: 0 });
  });

  it('submits its own note type filter without relying on global settings', async () => {
    const { container, onConfirm } = renderModal({ syncStartDate: '', maxDays: 30 });

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

    await act(() => {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith({
      syncStartDate: '',
      maxDays: 30,
      enabledNoteTypes: ['link', 'immediate_audio', 'recorder_audio', 'recorder_flash_audio', 'audio_long', 'local_audio'],
    });
  });

  it('unchecking all types clears every type selection', async () => {
    const { container, onConfirm } = renderModal({ syncStartDate: '', maxDays: 30 });

    const trigger = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '全部类型');
    expect(trigger).toBeTruthy();

    await act(() => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const allOption = Array.from(container.querySelectorAll('label'))
      .find(label => label.textContent === '全部类型');
    expect(allOption).toBeTruthy();
    const allCheckbox = allOption!.querySelector('input[type="checkbox"]') as HTMLInputElement;

    await act(() => {
      allCheckbox.checked = false;
      allCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const typeCheckboxes = Array.from(container.querySelectorAll('.getnote-note-type-select-option input[type="checkbox"]')) as HTMLInputElement[];
    expect(typeCheckboxes.every(checkbox => checkbox.checked === false)).toBe(true);

    await act(() => {
      container.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith({
      syncStartDate: '',
      maxDays: 30,
      enabledNoteTypes: [],
    });
  });
});
