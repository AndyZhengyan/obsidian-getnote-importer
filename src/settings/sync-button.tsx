import { t } from '../i18n';

interface SyncButtonProps {
  hasCredentials: boolean;
  isSyncing: boolean;
  onClick: () => void;
}

export function SyncButton({ hasCredentials, isSyncing, onClick }: SyncButtonProps) {
  if (isSyncing) {
    return (
      <button className="mod-secondary getnote-sync-action-button" disabled>
        {t('sync.syncing')}
      </button>
    );
  }

  if (!hasCredentials) {
    return (
      <button className="mod-secondary getnote-sync-action-button" disabled>
        {t('sync.noCredentials')}
      </button>
    );
  }

  return (
    <button
      className="mod-secondary getnote-sync-action-button"
      onClick={onClick}
    >
      {t('sync.start')}
    </button>
  );
}
