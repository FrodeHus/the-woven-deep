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

  it('applies the colorblind reinforcement class alongside the token color class for each colored tone', () => {
    const log = [
      { id: 1, text: 'You enter the room.', tone: 'info' as const },
      { id: 2, text: 'A rat bites you.', tone: 'combat' as const },
      { id: 3, text: 'Your light is running low.', tone: 'warning' as const },
      { id: 4, text: 'The mechanism clicks.', tone: 'system' as const },
    ];
    render(<LogPanel snapshot={snapshotOf(log)} />);

    // The `::before` glyph in `styles.css` only ever renders on these classes -- so the class
    // must land on the actual rendered element, not merely exist as a rule in the stylesheet.
    expect(screen.getByText('A rat bites you.')).toHaveClass('log-line--combat', 'text-danger');
    expect(screen.getByText('Your light is running low.')).toHaveClass('log-line--warning', 'text-warn');
    expect(screen.getByText('The mechanism clicks.')).toHaveClass('log-line--system', 'text-muted');
    // `info` has no reinforcement glyph in the stylesheet -- no `.log-line--info` class to apply.
    expect(screen.getByText('You enter the room.')).not.toHaveClass('log-line--info');
  });
});
