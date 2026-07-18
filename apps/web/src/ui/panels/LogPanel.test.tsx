import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { LogPanel } from './LogPanel.js';

function snapshotOf(log: SessionSnapshot['log']): SessionSnapshot {
  return {
    projection: {} as SessionSnapshot['projection'],
    log,
    lastEvents: [],
    pendingDecision: null,
    notice: null,
    houseOpen: false,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
  };
}

describe('LogPanel', () => {
  it('renders the newest lines last inside a polite live region, colored by tone', () => {
    const log = [
      { id: 1, text: 'You enter the room.', tone: 'info' as const },
      { id: 2, text: 'A rat bites you.', tone: 'combat' as const },
      { id: 3, text: 'Your light is running low.', tone: 'warning' as const },
    ];
    render(<LogPanel snapshot={snapshotOf(log)} />);
    const region = screen.getByRole('log');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveClass('font-mono');
    const lines = within(region).getAllByText(/./);
    expect(lines[lines.length - 1]).toHaveTextContent('Your light is running low.');
    expect(screen.getByText('A rat bites you.')).toHaveClass('text-danger');
    expect(screen.getByText('Your light is running low.')).toHaveClass('text-warn');
  });

  it('never unmounts the log region even when empty', () => {
    render(<LogPanel snapshot={snapshotOf([])} />);
    expect(screen.getByRole('log')).toBeInTheDocument();
  });
});
