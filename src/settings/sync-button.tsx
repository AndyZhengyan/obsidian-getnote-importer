import { t } from '../i18n';

interface SyncButtonProps {
  hasCredentials: boolean;
  isSyncing: boolean;
  onClick: () => void;
}

export function SyncButton({ hasCredentials, isSyncing, onClick }: SyncButtonProps) {
  return (
    <button
      className="mod-secondary getnote-sync-action-button"
      disabled={!hasCredentials || isSyncing}
      onClick={onClick}
    >
      {t('sync.start')}
    </button>
  );
}
