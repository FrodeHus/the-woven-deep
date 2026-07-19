import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockBar, DotLeaderRow, TagChip } from './chargen-components.js';

describe('BlockBar', () => {
  it('fills round(value/max*cells) cells and pads the rest, total = cells', () => {
    const { container } = render(<BlockBar value={6} max={30} cells={10} />);
    const text = container.textContent ?? '';
    expect([...text].filter((c) => c === '█')).toHaveLength(10); // 2 filled + 8 empty
  });
});
describe('DotLeaderRow', () => {
  it('shows a positive delta in the positive tone', () => {
    render(<DotLeaderRow label="Defense" value="15" delta={2} />);
    expect(screen.getByText(/\+2/)).toBeInTheDocument();
  });
});
describe('TagChip', () => {
  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<TagChip label="Melee" selected={false} onClick={onClick} />);
    screen.getByRole('button', { name: 'Melee' }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
