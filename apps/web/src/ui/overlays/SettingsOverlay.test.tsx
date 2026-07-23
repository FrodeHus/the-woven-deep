import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { emptyRunMetrics } from '@woven-deep/engine';
import { GUEST_ACCOUNT, type AccountState } from '../../session/account.js';
import { DEFAULT_SETTINGS } from '../../session/settings.js';
import { UiProviders } from '../providers.js';
import { SettingsOverlay } from './SettingsOverlay.js';

function renderSettings(account?: AccountState) {
  return render(
    <UiProviders pack={{} as never} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}}>
      <SettingsOverlay onClearGuestSession={() => {}} account={account} />
    </UiProviders>,
  );
}

describe('SettingsOverlay -- Lifetime & achievements', () => {
  it('does not render the section for a guest (no account prop)', () => {
    renderSettings();
    expect(screen.queryByText('Lifetime & achievements')).not.toBeInTheDocument();
  });

  it('does not render the section for a guest account', () => {
    renderSettings(GUEST_ACCOUNT);
    expect(screen.queryByText('Lifetime & achievements')).not.toBeInTheDocument();
  });

  it('renders lifetime totals and granted achievements for a signed-in account', () => {
    const account: AccountState = {
      status: 'signed-in',
      email: 'player@example.com',
      csrfToken: 'tok',
      unlockedClassIds: [],
      lifetime: {
        conqueredChampionRecordIds: [],
        grantedAchievementIds: ['achievement.first-blood'],
        discoveryProtection: [],
        totals: { ...emptyRunMetrics(), kills: 42, deepestDepth: 7 },
      },
      achievements: [
        {
          achievementId: 'achievement.first-blood',
          criteriaId: 'first-champion-defeat',
          name: 'First Blood',
        },
      ],
    };
    renderSettings(account);

    expect(screen.getByText('Lifetime & achievements')).toBeInTheDocument();
    expect(screen.getByText('Kills')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Deepest depth')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();

    const achievements = screen.getByRole('list', { name: 'Granted achievements' });
    expect(within(achievements).getByText('First Blood')).toBeInTheDocument();
  });

  it('shows a fallback message when the signed-in profile has no achievements yet', () => {
    const account: AccountState = { ...GUEST_ACCOUNT, status: 'signed-in', email: 'p@example.com' };
    renderSettings(account);
    expect(screen.getByText('No achievements granted yet.')).toBeInTheDocument();
  });
});
