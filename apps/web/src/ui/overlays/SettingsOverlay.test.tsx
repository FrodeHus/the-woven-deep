import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { emptyRunMetrics } from '@woven-deep/engine';
import { GUEST_ACCOUNT, type AccountState } from '../../session/account.js';
import { DEFAULT_SETTINGS } from '../../session/settings.js';
import { UiProviders } from '../providers.js';
import { SettingsOverlay } from './SettingsOverlay.js';

function renderSettings(
  account?: AccountState,
  extra?: { onDeleteAccount?: () => void; onSignOut?: () => void },
) {
  return render(
    <UiProviders pack={{} as never} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}}>
      <SettingsOverlay
        onClearGuestSession={() => {}}
        onSignOut={extra?.onSignOut}
        onDeleteAccount={extra?.onDeleteAccount}
        account={account}
      />
    </UiProviders>,
  );
}

const SIGNED_IN_ACCOUNT: AccountState = {
  ...GUEST_ACCOUNT,
  status: 'signed-in',
  email: 'player@example.com',
  csrfToken: 'tok',
};

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

describe('SettingsOverlay -- Delete account', () => {
  it('does not render for a guest (no account, no onDeleteAccount)', () => {
    renderSettings();
    expect(screen.queryByText('Delete account')).not.toBeInTheDocument();
  });

  it('does not render for a guest account, even if onDeleteAccount were somehow provided', () => {
    renderSettings(GUEST_ACCOUNT);
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
  });

  it('does not render for a signed-in account when onDeleteAccount is not provided', () => {
    renderSettings(SIGNED_IN_ACCOUNT);
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
  });

  it('renders for a signed-in account with the button disabled until "delete" is typed', async () => {
    const user = userEvent.setup();
    const onDeleteAccount = vi.fn();
    renderSettings(SIGNED_IN_ACCOUNT, { onDeleteAccount });

    const heading = screen.getByText('Delete account', { selector: 'h3' });
    expect(heading).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Delete account' });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Type "delete" to confirm'), 'delete');
    expect(button).toBeEnabled();

    await user.click(button);
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
  });

  it('stays disabled for a near-miss confirmation string', async () => {
    const user = userEvent.setup();
    const onDeleteAccount = vi.fn();
    renderSettings(SIGNED_IN_ACCOUNT, { onDeleteAccount });

    await user.type(screen.getByLabelText('Type "delete" to confirm'), 'deletee');
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  });
});
