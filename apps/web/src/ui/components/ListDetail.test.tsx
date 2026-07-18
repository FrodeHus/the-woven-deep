import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { ListDetail, type ListDetailItem } from './ListDetail.js';

const firstItem: ListDetailItem = { id: 'a', label: 'Iron sword' };
const secondItem: ListDetailItem = { id: 'b', label: 'Ashen potion', quantity: 2 };
const lastItem: ListDetailItem = { id: 'c', label: 'Wooden shield' };
const items: ListDetailItem[] = [firstItem, secondItem, lastItem];

function Harness({ onSelect, initial = 0 }: { onSelect: (i: number) => void; initial?: number }) {
  const [sel, setSel] = useState(initial);
  return (
    <ListDetail
      items={items}
      listLabel="Pack"
      selectedIndex={sel}
      onSelect={(i) => { setSel(i); onSelect(i); }}
      renderDetail={(item) => <p>{item ? item.label : 'nothing'}</p>}
    />
  );
}

describe('ListDetail', () => {
  it('moves selection with ArrowDown and shows detail', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const listbox = screen.getByRole('listbox', { name: 'Pack' });
    listbox.focus();
    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('option', { name: /^Ashen potion/ })).toBeInTheDocument();
  });

  it('selects on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const listbox = screen.getByRole('listbox', { name: 'Pack' });
    await user.click(within(listbox).getByText('Ashen potion'));
    expect(onSelect).toHaveBeenLastCalledWith(1);
  });

  it('does not merge a selection marker into the option accessible name', () => {
    render(<Harness onSelect={vi.fn()} />);
    const listbox = screen.getByRole('listbox', { name: 'Pack' });
    // Row 0 is selected by default; its accessible name must be the bare label.
    expect(within(listbox).getByRole('option', { name: 'Iron sword' })).toBeInTheDocument();
  });

  it('ArrowUp from index 0 wraps to the last item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const listbox = screen.getByRole('listbox', { name: 'Pack' });
    listbox.focus();
    await user.keyboard('{ArrowUp}');
    expect(onSelect).toHaveBeenLastCalledWith(items.length - 1);
    expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining(lastItem.id));
  });

  it('ArrowDown from the last item wraps to index 0', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} initial={items.length - 1} />);
    const listbox = screen.getByRole('listbox', { name: 'Pack' });
    listbox.focus();
    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenLastCalledWith(0);
    expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining(firstItem.id));
  });

  it('Home selects index 0 from a non-zero selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} initial={2} />);
    const listbox = screen.getByRole('listbox', { name: 'Pack' });
    listbox.focus();
    await user.keyboard('{Home}');
    expect(onSelect).toHaveBeenLastCalledWith(0);
    expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining(firstItem.id));
  });

  it('End selects the last index', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const listbox = screen.getByRole('listbox', { name: 'Pack' });
    listbox.focus();
    await user.keyboard('{End}');
    expect(onSelect).toHaveBeenLastCalledWith(items.length - 1);
    expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining(lastItem.id));
  });

  it('updates aria-activedescendant on the listbox as selection moves', async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} />);
    const listbox = screen.getByRole('listbox', { name: 'Pack' });
    listbox.focus();

    expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining(firstItem.id));

    await user.keyboard('{ArrowDown}');
    expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining(secondItem.id));

    await user.keyboard('{ArrowDown}');
    expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining(lastItem.id));
  });
});
