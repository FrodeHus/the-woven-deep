import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StatusBar } from './StatusBar.js';

const snapshot = {
  projection: { hero: { name: 'Ashwalker', conditions: [] }, floor: { depth: 3, town: false }, metrics: { turnsElapsed: 42 } },
} as never;

describe('StatusBar', () => {
  it('renders hero name, depth and turn count', () => {
    render(<StatusBar snapshot={snapshot} />);
    expect(screen.getByText('Ashwalker')).toBeInTheDocument();
    expect(screen.getByText('Depth 3')).toBeInTheDocument();
    expect(screen.getByTestId('turn-count')).toHaveTextContent('Turn 42');
  });

  it('is a labeled group', () => {
    render(<StatusBar snapshot={snapshot} />);
    expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument();
  });
});
