import type { ProfileRepository } from '../db/profile-repository.js';
import type { Clock } from './rate-limiter.js';

export const SETTINGS_MAX_BYTES = 8192;

export interface ProfileSettings {
  settingsJson: string | null;
  settingsVersion: number;
}

export interface SettingsService {
  read(profileId: string): ProfileSettings;
  write(
    input: Readonly<{ profileId: string; settingsJson: string; settingsVersion: number }>,
  ): { ok: true } | { ok: false; reason: 'too-large' | 'not-json-object' };
}

export function createSettingsService(
  deps: Readonly<{ clock: Clock; profiles: ProfileRepository }>,
): SettingsService {
  const { clock, profiles } = deps;

  return {
    read(profileId) {
      const row = profiles.findById(profileId);
      return {
        settingsJson: row?.settingsJson ?? null,
        settingsVersion: row?.settingsVersion ?? 0,
      };
    },

    write({ profileId, settingsJson, settingsVersion }) {
      if (Buffer.byteLength(settingsJson, 'utf8') > SETTINGS_MAX_BYTES) {
        return { ok: false, reason: 'too-large' };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(settingsJson);
      } catch {
        return { ok: false, reason: 'not-json-object' };
      }

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, reason: 'not-json-object' };
      }

      profiles.updateSettings({
        id: profileId,
        settingsJson,
        settingsVersion,
        nowIso: clock.now().toISOString(),
      });

      return { ok: true };
    },
  };
}
