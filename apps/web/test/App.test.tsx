import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { App } from '../src/App.js';

it('shows the compiled content hash and entry counts', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', contentHash: 'c'.repeat(64), entries: 2 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      schemaVersion: 1,
      hash: 'c'.repeat(64),
      entries: [
        { id: 'monster.cave-rat', kind: 'monster', name: 'Cave rat' },
        { id: 'item.brass-lantern', kind: 'item', name: 'Brass lantern' },
      ],
    })));

  render(<App fetcher={fetcher as typeof fetch} />);
  expect(await screen.findByText('2 entries bound')).toBeVisible();
  expect(screen.getByText('1 monster')).toBeVisible();
  expect(screen.getByText('1 item')).toBeVisible();
  expect(screen.getByText('c'.repeat(64))).toBeVisible();
});
