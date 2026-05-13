import { useState, useCallback, useEffect } from 'preact/hooks';
import { fetchOAuthDeviceCode, pollOAuthToken } from '../api';
import { t } from '../i18n';

interface OAuthButtonProps {
  onAuthorize: (apiToken: string, clientId: string) => void;
}

type OAuthStep = 'idle' | 'opening' | 'code' | 'polling' | 'success' | 'error';

type ElectronWindow = Window & {
  require?: (moduleName: 'electron') => {
    shell?: {
      openExternal: (uri: string) => void;
    };
  };
};

function openVerificationPage(uri: string) {
  try {
    const electron = (window as ElectronWindow).require?.('electron');
    if (electron?.shell) {
      electron.shell.openExternal(uri);
      return;
    }
  } catch {
    // Fall back to window.open below.
  }
  window.open(uri, '_blank');
}

export function OAuthButton({ onAuthorize }: OAuthButtonProps) {
  const [step, setStep] = useState<OAuthStep>('idle');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const showCopiedFeedback = (setter: (v: boolean) => void) => {
    setter(true);
    window.setTimeout(() => setter(false), 3000);
  };

  const copyWithFeedback = (value: string, setter: (v: boolean) => void) => {
    void navigator.clipboard.writeText(value).then(
      () => {
        showCopiedFeedback(setter);
      },
      () => {
        setErrorMsg(t('oauth.error'));
        setStep('error');
      }
    );
  };

  const cancel = useCallback(() => {
    abortController?.abort();
    setStep('idle');
    setUserCode('');
    setVerificationUri('');
    setErrorMsg('');
    setIsPolling(false);
  }, [abortController]);

  useEffect(() => () => { abortController?.abort(); }, [abortController]);

  const handleAuthorize = async () => {
    const controller = new AbortController();
    setAbortController(controller);
    setErrorMsg('');

    try {
      // Step 1: get device code
      setStep('opening');
      const dc = await fetchOAuthDeviceCode(controller.signal);
      setUserCode(dc.user_code);
      setVerificationUri(dc.verification_uri);
      setStep('code');

      // Let Obsidian render the user code first, then open the verification page.
      await new Promise(resolve => window.setTimeout(resolve, 0));
      openVerificationPage(dc.verification_uri);

      // Step 2: poll for token
      setIsPolling(true);
      const token = await pollOAuthToken(dc.code, dc.interval, controller.signal);
      setIsPolling(false);
      setStep('success');
      // Save credentials immediately
      onAuthorize(token.api_key, token.client_id);
      window.setTimeout(() => setStep('idle'), 3000);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStep('idle');
        return;
      }
      setIsPolling(false);
      setStep('error');
      setErrorMsg(err instanceof Error ? err.message : t('oauth.error'));
    }
  };

  if (step === 'idle') {
    return (
      <button
        className="mod-cta getnote-credential-action-button"
        onClick={() => {
          void handleAuthorize();
        }}
      >
        {t('oauth.start')}
      </button>
    );
  }

  if (step === 'opening') {
    return (
      <div className="getnote-oauth-section getnote-oauth-loading">
        <span className="getnote-credentials-message">{t('oauth.pollWaiting')}</span>
        <button className="mod-cancel" onClick={cancel}>{t('picker.cancel')}</button>
      </div>
    );
  }

  if (step === 'code') {
    const openBrowser = () => {
      openVerificationPage(verificationUri);
    };
    return (
      <div className="getnote-oauth-code-section">
        <div className="getnote-credentials-message">
          {t('oauth.linkHint')}
        </div>
        <div className="getnote-oauth-code-box">
          <span className="getnote-oauth-code-label">{t('oauth.code')}</span>
          <span className="getnote-oauth-code-value">{userCode}</span>
          <button
            className="getnote-oauth-copy-btn"
            onClick={() => copyWithFeedback(userCode, setCodeCopied)}
          >
            {codeCopied ? t('oauth.copied') : t('oauth.copyCode')}
          </button>
        </div>
        {isPolling && (
          <div className="getnote-credentials-message">
            {t('oauth.pollWaiting')}
          </div>
        )}
        <div className="getnote-oauth-actions">
          <button className="mod-secondary getnote-credential-action-button" onClick={openBrowser}>{t('oauth.openBrowser')}</button>
          <button
            className="getnote-oauth-copy-btn"
            onClick={() => copyWithFeedback(verificationUri, setLinkCopied)}
          >
            {linkCopied ? t('oauth.copied') : t('oauth.copyLink')}
          </button>
          <button className="mod-cancel" onClick={cancel}>{t('picker.cancel')}</button>
        </div>
      </div>
    );
  }

  if (step === 'polling') {
    return (
      <div className="getnote-oauth-section getnote-oauth-loading">
        <span className="getnote-credentials-message">{t('oauth.pollWaiting')}</span>
        <button className="mod-cancel" onClick={cancel}>{t('picker.cancel')}</button>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="getnote-oauth-section getnote-oauth-success">
        <span className="getnote-credentials-message getnote-credentials-message-success">✓ {t('oauth.success')}</span>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="getnote-oauth-section getnote-oauth-error">
        <span className="getnote-credentials-message getnote-credentials-message-error">
          {t('oauth.error')}: {errorMsg}
        </span>
        <button className="mod-cancel" onClick={cancel}>{t('picker.cancel')}</button>
      </div>
    );
  }

  return null;
}
