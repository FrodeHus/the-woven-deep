import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { FacetedOptionList, type FacetedOptionListEntry } from './FacetedOptionList.js';

function makeEntries(n: number): FacetedOptionListEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `entry-${i}`,
    name: `Entry ${i}`,
    description: `Description ${i}`,
    tags: i % 2 ? ['melee'] : ['ranged'],
  }));
}

describe('FacetedOptionList', () => {
  it('hides the filter bar at or below the facet threshold', () => {
    render(
      <FacetedOptionList
        entries={makeEntries(6)}
        ariaLabel="Test list"
        marker="single"
        selected={() => false}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();
  });

  it('shows the filter bar above the facet threshold and filters entries by query', async () => {
    const user = userEvent.setup();
    render(
      <FacetedOptionList
        entries={makeEntries(7)}
        ariaLabel="Test list"
        marker="single"
        selected={() => false}
        onSelect={() => {}}
      />,
    );
    const search = screen.getByPlaceholderText('Search...');
    expect(search).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(7);
    await user.type(search, 'Entry 3');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /Entry 3/ })).toBeInTheDocument();
  });

  it('renders single-select markers and calls onSelect with the clicked entry', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const entries = makeEntries(2);
    render(
      <FacetedOptionList
        entries={entries}
        ariaLabel="Test list"
        marker="single"
        selected={(entry) => entry.id === 'entry-1'}
        onSelect={onSelect}
      />,
    );
    const list = screen.getByRole('listbox', { name: 'Test list' });
    expect(list).not.toHaveAttribute('aria-multiselectable');
    const selectedOption = screen.getByRole('option', { name: /Entry 1/ });
    expect(selectedOption).toHaveAttribute('aria-selected', 'true');
    expect(selectedOption.textContent).toContain('(•)');

    await user.click(screen.getByRole('option', { name: /Entry 0/ }));
    expect(onSelect).toHaveBeenCalledWith(entries[0]);
  });

  it('renders multi-select markers and aria-multiselectable', () => {
    render(
      <FacetedOptionList
        entries={makeEntries(2)}
        ariaLabel="Test list"
        marker="multi"
        selected={(entry) => entry.id === 'entry-0'}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('listbox', { name: 'Test list' })).toHaveAttribute(
      'aria-multiselectable',
      'true',
    );
    expect(screen.getByRole('option', { name: /Entry 0/ }).textContent).toContain('[×]');
    expect(screen.getByRole('option', { name: /Entry 1/ }).textContent).toContain('[ ]');
  });

  it('renders meta text and a locked entry with its lock hint', () => {
    const entries: FacetedOptionListEntry[] = [
      { id: 'a', name: 'A', tags: [], meta: '+2 defense' },
      { id: 'b', name: 'B', tags: [], locked: true, lockHint: 'Requires level 5' },
    ];
    render(
      <FacetedOptionList
        entries={entries}
        ariaLabel="Test list"
        marker="single"
        selected={() => false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('+2 defense')).toBeInTheDocument();
    const lockedOption = screen.getByRole('option', { name: /B/ });
    expect(lockedOption).toHaveAttribute('aria-disabled', 'true');
    expect(lockedOption.textContent).toContain('Requires level 5');
  });

  it('renders children between the filter bar and the listbox', () => {
    render(
      <FacetedOptionList
        entries={makeEntries(7)}
        ariaLabel="Test list"
        marker="single"
        selected={() => false}
        onSelect={() => {}}
      >
        <span data-testid="slot">0/2</span>
      </FacetedOptionList>,
    );
    expect(screen.getByTestId('slot')).toBeInTheDocument();
  });
});
