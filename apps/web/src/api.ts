import {
  CONTENT_KIND_IDS,
  validateCompiledContentPack,
  type CompiledContentPack,
  type ContentKind,
} from '@woven-deep/content';
import type { AchievementGrant, LifetimeState } from '@woven-deep/engine';

export interface ContentSummary {
  readonly hash: string;
  readonly entries: number;
  readonly counts: Readonly<Record<ContentKind, number>>;
}

async function fetchContentPack(fetcher: typeof fetch): Promise<CompiledContentPack> {
  const response = await fetcher('/api/content/guest');
  if (!response.ok) throw new Error('The content service is unavailable.');
  return validateCompiledContentPack(await response.json());
}

export async function loadContentSummary(fetcher: typeof fetch = fetch): Promise<ContentSummary> {
  const [healthResponse, pack] = await Promise.all([
    fetcher('/api/health'),
    fetchContentPack(fetcher),
  ]);
  if (!healthResponse.ok) throw new Error('The content service is unavailable.');
  const health = (await healthResponse.json()) as { contentHash: string; entries: number };
  if (pack.hash !== health.contentHash)
    throw new Error('The content service returned mismatched versions.');
  const counts = Object.fromEntries(CONTENT_KIND_IDS.map((kind) => [kind, 0])) as Record<
    ContentKind,
    number
  >;
  for (const entry of pack.entries) counts[entry.kind] += 1;
  return { hash: pack.hash, entries: health.entries, counts };
}

export async function loadContentPack(fetcher: typeof fetch = fetch): Promise<CompiledContentPack> {
  return fetchContentPack(fetcher);
}

export async function requestLogin(email: string, fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export interface SessionInfo {
  authenticated: boolean;
  email?: string;
  csrfToken?: string;
  unlockedClassIds?: readonly string[];
  /** The profile's server-persisted lifetime totals (`hall_state.lifetime_json`, replayed and
   * serialized by `GET /api/auth/session` -- see `ServerRunRecordRepository.lifetime()`).
   * Undefined only if the session route itself predates this field; `loadAccount` falls back to
   * the same zeroed shape the server sends for a fresh profile. */
  lifetime?: LifetimeState;
  /** The profile's server-persisted granted achievements (`hall_state.achievements_json`). */
  achievements?: readonly AchievementGrant[];
}

export async function fetchSession(fetcher: typeof fetch = fetch): Promise<SessionInfo> {
  const response = await fetcher('/api/auth/session', { credentials: 'same-origin' });
  if (!response.ok) return { authenticated: false };
  return (await response.json()) as SessionInfo;
}

export async function logout(csrfToken: string, fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-csrf-token': csrfToken },
  });
}

/** Permanently deletes the signed-in profile and every row that belongs to it (Hall records,
 * lifetime totals, unlocks, achievements, settings, the active run) -- `DELETE /api/profile`,
 * gated server-side on the same auth+origin+CSRF trio as every other state-changing profile
 * route, plus an explicit `confirm` flag since there is no undo. */
export async function deleteAccount(
  csrfToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await fetcher('/api/profile', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ confirm: true }),
  });
}

export async function fetchProfileSettings(
  fetcher: typeof fetch = fetch,
): Promise<{ settingsJson: string | null; settingsVersion: number }> {
  const response = await fetcher('/api/profile/settings', { credentials: 'same-origin' });
  // A non-200 (e.g. the session lapsed) means "no server settings" — fall back to the empty
  // marker so roaming treats it as an unset profile rather than parsing an error body.
  if (!response.ok) return { settingsJson: null, settingsVersion: 0 };
  const body = (await response.json()) as { settings: string | null; settingsVersion: number };
  return { settingsJson: body.settings, settingsVersion: body.settingsVersion };
}

/** Derives the `/ws/play` WebSocket URL from the current page's own origin -- same-origin by
 * construction, matching the CSWSH `requireOrigin` check `registerWsPlayRoute` enforces on the
 * upgrade (see `apps/server/src/routes/ws-play.ts`). `location` defaults to the browser's global
 * `window.location`; injectable so a test can derive the URL without a DOM. */
export function playWsUrl(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${location.host}/ws/play`;
}

export async function putProfileSettings(
  input: { settingsJson: string; settingsVersion: number; csrfToken: string },
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean }> {
  const response = await fetcher('/api/profile/settings', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': input.csrfToken,
    },
    body: JSON.stringify({
      settingsJson: input.settingsJson,
      settingsVersion: input.settingsVersion,
    }),
  });
  return { ok: response.ok };
}
