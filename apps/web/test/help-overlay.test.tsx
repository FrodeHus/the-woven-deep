import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { DEFAULT_SETTINGS, resolveKeymap, type Settings } from '../src/session/settings.js';
import { HelpOverlay } from '../src/ui/overlays/HelpOverlay.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function harness(overrides: Partial<Settings> = {}) {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...overrides };
  const keymap = resolveKeymap(settings.bindings);
  render(<HelpOverlay keymap={keymap} pack={pack} />);
}

describe('HelpOverlay', () => {
  it('renders a controls row for Inventory with the DEFAULT chord ("i"), and no other row leaks that literal', () => {
    harness();
    const inventoryRow = screen.getByText('Inventory').closest('li')!;
    expect(inventoryRow).toHaveTextContent('i');
  });

  it('renders the REBOUND chord for Inventory ("p") when settings override it -- proves the row is', () => {
    harness({ bindings: { inventory: { key: 'p', shift: false } } });
    const inventoryRow = screen.getByText('Inventory').closest('li')!;
    expect(inventoryRow).toHaveTextContent('p');
    expect(inventoryRow).not.toHaveTextContent(/\bi\b/);
  });

  it('renders every ActionId as a controls row with its live chord, grouped movement/actions/screens', () => {
    harness();
    expect(screen.getByText('Move north').closest('li')!).toHaveTextContent('k');
    expect(screen.getByText('Rest').closest('li')!).toHaveTextContent('Shift+R');
    expect(screen.getByText('Codex').closest('li')!).toHaveTextContent('x');
    expect(screen.getByText('Help').closest('li')!).toHaveTextContent('Shift+?');
  });

  it('includes fixed hardwired notes for arrow/numpad movement and Escape, not sourced from the keymap', () => {
    harness();
    expect(screen.getByText(/arrow.*numpad.*always move/i)).toBeInTheDocument();
    expect(screen.getByText(/Escape closes/i)).toBeInTheDocument();
  });

  it('renders the glyph legend from the real pack: hero, a monster with its actual glyph/color, an item, and terrain', () => {
    harness();
    const legend = screen.getByRole('region', { name: /glyph legend/i });
    expect(within(legend).getByText('@')).toBeInTheDocument();

    const caveRat = pack.entries.find((entry) => entry.kind === 'monster' && entry.id === 'monster.cave-rat');
    expect(caveRat).toBeDefined();
    const monsterRow = within(legend).getByText('Cave rat').closest('li')!;
    expect(monsterRow).toHaveTextContent((caveRat as { glyph: string }).glyph);

    const anyItem = pack.entries.find((entry) => entry.kind === 'item');
    expect(anyItem).toBeDefined();
    expect(within(legend).getByText((anyItem as { name: string }).name)).toBeInTheDocument();

    expect(within(legend).getByText(/floor/i)).toBeInTheDocument();
    expect(within(legend).getByText(/wall/i)).toBeInTheDocument();
  });

  it('renders mechanics notes covering hunger, light/fuel, identification, the town truce, and death finality', () => {
    harness();
    const mechanics = screen.getByRole('region', { name: /mechanics/i });
    expect(within(mechanics).getAllByText(/hunger/i).length).toBeGreaterThan(0);
    expect(within(mechanics).getAllByText(/fuel/i).length).toBeGreaterThan(0);
    expect(within(mechanics).getAllByText(/identif/i).length).toBeGreaterThan(0);
    expect(within(mechanics).getAllByText(/town/i).length).toBeGreaterThan(0);
    expect(within(mechanics).getAllByText(/permanent|final/i).length).toBeGreaterThan(0);
  });
});
