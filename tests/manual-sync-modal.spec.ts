import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ManualSyncModal } from '../src/ui/manual-sync-modal';

function renderModal(initialOptions: { syncStartDate: string; maxDays: number }, onConfirm = vi.fn()) {
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
});
