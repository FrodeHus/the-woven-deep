import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { HintStrip } from '../src/ui/HintStrip.js';
import type { HintDefinition } from '../src/session/onboarding.js';
import { DEFAULT_SETTINGS, resolveKeymap } from '../src/session/settings.js';

const defaultKeymap = resolveKeymap(DEFAULT_SETTINGS.bindings);

const hint: HintDefinition = {
  id: 'inspection',
  priority: 1,
  mastery: { kind: 'intent-count', intentType: 'open-character-sheet', count: 1 },
  trigger: () => true,
  copy: (keymap) => `Press ${keymap.byAction['character-sheet'].key} to read your own measure.`,
};

describe('HintStrip', () => {
  it('renders nothing when there is no active hint', () => {
    const { container } = render(<HintStrip hint={null} keymap={defaultKeymap} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the hint copy as a role="note" (never alert/status -- must not interrupt)', () => {
    render(<HintStrip hint={hint} keymap={defaultKeymap} />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('Press c to read your own measure.');
  });

  it('renders the LIVE chord from the resolved keymap -- a rebind changes the copy', () => {
    const rebound = resolveKeymap({ 'character-sheet': { key: 'p', shift: false } });
    render(<HintStrip hint={hint} keymap={rebound} />);
    expect(screen.getByRole('note')).toHaveTextContent('Press p to read your own measure.');
  });

  it('shows the dedicated dismiss chord', () => {
    render(<HintStrip hint={hint} keymap={defaultKeymap} />);
    expect(screen.getByRole('note')).toHaveTextContent("'");
  });

  it('never steals focus on appear -- activeElement is unchanged', () => {
    document.body.focus();
    const before = document.activeElement;
    render(<HintStrip hint={hint} keymap={defaultKeymap} />);
    expect(document.activeElement).toBe(before);
  });
});
