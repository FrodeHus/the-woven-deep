import type { JSX } from 'react';
import type { SessionNotice } from '../session/guest-session.js';

type DismissibleNotice = Exclude<SessionNotice, { kind: 'storage' }>;
type StorageNotice = Extract<SessionNotice, { kind: 'storage' }>;

export function isStorageNotice(notice: SessionNotice): notice is StorageNotice {
  return notice.kind === 'storage';
}

/** Wording for the dismissible fresh/restored/save-discarded/data-reset banner. Storage notices
 * never reach this — they get their own persistent, non-dismissible warning (see
 * `storageWarningMessage`). */
export function noticeMessage(notice: DismissibleNotice): string {
  if (notice.kind === 'fresh') return 'A new run has begun.';
  if (notice.kind === 'restored') return 'Welcome back — your run was restored.';
  if (notice.kind === 'data-reset') {
    return notice.source === 'sightings'
      ? 'Your discovery log was unreadable and has been reset.'
      : 'Your guidance progress was unreadable and has been reset.';
  }
  return `Your previous save could not be loaded (${notice.reason}) — a new run has begun.`;
}

/**
 * Wording for storage-unavailable vs storage-full, per the design spec's requirement that the two
 * failures produce distinct, actionable messages.
 */
export function storageWarningMessage(notice: StorageNotice): string {
  return notice.failure === 'full'
    ? 'Your browser storage is full, so this run cannot be saved — play continues unsaved.'
    : 'Saving is unavailable in this browser — play continues, but your progress will not persist.';
}

export interface AppBannersProps {
  readonly hallNotice: string | null;
  readonly finalizeWarning: string | undefined;
  readonly settingsWriteWarning: string | undefined;
  readonly showSettingsCorrupted: boolean;
  readonly onDismissSettingsCorrupted: () => void;
  readonly children: JSX.Element;
}

/** Wraps every post-boot screen with any persistent, non-dismissible warnings pending —
 * Hall-corruption-on-boot, finalize-write, and settings-write failures alike — plus the one
 * dismissible settings-corrupted notice. The active run survives regardless of any of these: only
 * the affected write (or, on boot, the Hall itself) was affected. */
export function AppBanners({
  hallNotice, finalizeWarning, settingsWriteWarning, showSettingsCorrupted, onDismissSettingsCorrupted, children,
}: AppBannersProps): JSX.Element {
  if (!hallNotice && !finalizeWarning && !settingsWriteWarning && !showSettingsCorrupted) return children;
  return (
    <>
      {showSettingsCorrupted && (
        <div role="status" aria-label="Settings notice" className="session-banner" data-kind="settings-corrupted">
          <p>Stored settings were unreadable and have been reset.</p>
          <button type="button" onClick={onDismissSettingsCorrupted}>Dismiss</button>
        </div>
      )}
      {hallNotice && (
        <div role="alert" aria-label="Hall notice" className="storage-warning-banner" data-kind="hall-corrupt">
          <p>Your Hall of Records could not be read and has been reset. ({hallNotice})</p>
        </div>
      )}
      {finalizeWarning && (
        <div role="alert" aria-label="Storage warning" className="storage-warning-banner" data-kind="finalize-failed">
          <p>{finalizeWarning}</p>
        </div>
      )}
      {settingsWriteWarning && (
        <div role="alert" aria-label="Storage warning" className="storage-warning-banner" data-kind="settings-write-failed">
          <p>{settingsWriteWarning}</p>
        </div>
      )}
      {children}
    </>
  );
}
