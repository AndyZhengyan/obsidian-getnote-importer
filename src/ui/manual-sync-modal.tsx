import { useState } from 'preact/hooks';
import type { SyncScopeOptions } from '../types';
import { t } from '../i18n';

type SyncMode = 'date' | 'days';

interface ManualSyncModalProps {
  initialOptions: SyncScopeOptions;
  onConfirm: (options: SyncScopeOptions) => void;
  onCancel: () => void;
}

export function ManualSyncModal({ initialOptions, onConfirm, onCancel }: ManualSyncModalProps) {
  const [syncMode, setSyncMode] = useState<SyncMode>('date');
  const [syncStartDate, setSyncStartDate] = useState(initialOptions.syncStartDate);
  const [maxDays, setMaxDays] = useState(String(initialOptions.maxDays));

  const handleConfirm = () => {
    if (syncMode === 'date') {
      onConfirm({ syncStartDate, maxDays: 0 });
    } else {
      const parsedMaxDays = parseInt(maxDays, 10);
      onConfirm({
        syncStartDate: '',
        maxDays: Number.isNaN(parsedMaxDays) || parsedMaxDays < 0 ? 0 : parsedMaxDays,
      });
    }
  };

  return (
    <div className="getnote-manual-sync-modal">
      <div className="getnote-manual-sync-body">
        <div className="getnote-sync-mode-selector">
          <label className="getnote-sync-mode-option">
            <input
              type="radio"
              name="syncMode"
              checked={syncMode === 'date'}
              onChange={() => setSyncMode('date')}
            />
            <span>{t('manualSync.mode.date')}</span>
          </label>
          <label className="getnote-sync-mode-option">
            <input
              type="radio"
              name="syncMode"
              checked={syncMode === 'days'}
              onChange={() => setSyncMode('days')}
            />
            <span>{t('manualSync.mode.days')}</span>
          </label>
        </div>

        {syncMode === 'date' ? (
          <label className="getnote-manual-sync-field">
            <span>{t('manualSync.startDate')}</span>
            <input
              type="date"
              className="getnote-input getnote-date-input"
              value={syncStartDate}
              onChange={(e) => setSyncStartDate((e.target as HTMLInputElement).value)}
            />
          </label>
        ) : (
          <label className="getnote-manual-sync-field">
            <span>{t('manualSync.maxDays')}</span>
            <input
              type="number"
              min="1"
              className="getnote-input getnote-date-input"
              value={maxDays}
              onInput={(e) => setMaxDays((e.target as HTMLInputElement).value)}
            />
          </label>
        )}
        <div className="getnote-input-hint">{t('manualSync.hint')}</div>
      </div>
      <div className="getnote-picker-footer">
        <span className="getnote-picker-count">{t('manualSync.once')}</span>
        <div className="getnote-picker-btns">
          <button className="mod-cancel" onClick={onCancel}>{t('picker.cancel')}</button>
          <button className="mod-cta" onClick={handleConfirm}>{t('picker.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
