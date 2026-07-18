import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { ListDetail, type ListDetailItem } from './ListDetail.js';

const items: ListDetailItem[] = [
  { id: 'a', label: 'Iron sword' },
  { id: 'b', label: 'Ashen potion', quantity: 2 },
];

function Harness({ onSelect }: { onSelect: (i: number) => void }) {
  const [sel, setSel] = useState(0);
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
    expect(screen.getByText('Ashen potion')).toBeInTheDocument();
  });
  it('selects on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await user.click(screen.getByText('Ashen potion'));
    expect(onSelect).toHaveBeenLastCalledWith(1);
  });
});
