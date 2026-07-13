import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { contentPack } from './content-pack-fixture.js';

it('shows the compiled content hash and entry counts', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', contentHash: 'c'.repeat(64), entries: 2 })))
    .mockResolvedValueOnce(new Response(JSON.stringify(contentPack('c'.repeat(64), ['monster', 'item']))));

  render(<App fetcher={fetcher as typeof fetch} />);
  expect(await screen.findByText('2 entries bound')).toBeVisible();
  expect(screen.getByText('1 monster')).toBeVisible();
  expect(screen.getByText('1 item')).toBeVisible();
  expect(screen.getByText('c'.repeat(64))).toBeVisible();
});
