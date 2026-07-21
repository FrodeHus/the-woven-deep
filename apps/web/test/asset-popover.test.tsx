import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { AssetPopover } from '../src/ui/AssetPopover.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('AssetPopover', () => {
  it("shows an identified ground item's description and known facts (Damage/Worth)", () => {
    render(
      <AssetPopover
        asset={{
          title: 'Iron sword',
          detail: 'Weapon',
          x: 2,
          y: 3,
          contentId: 'item.iron-sword',
        }}
        col={2}
        row={3}
        paneCols={20}
        paneRows={10}
        cellPx={{ width: 8, height: 16 }}
        pack={pack}
      />,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Iron sword');
    expect(tooltip).toHaveTextContent(/notched from honest use/i);
    expect(tooltip).toHaveTextContent('Damage');
    expect(tooltip).toHaveTextContent('1d6');
    expect(tooltip).toHaveTextContent('Worth');
    expect(tooltip).toHaveTextContent('18');
  });

  it('shows only title/detail for an unidentified item (no contentId), with no description or facts', () => {
    render(
      <AssetPopover
        asset={{
          title: 'Unidentified item',
          detail: 'Unidentified',
          x: 2,
          y: 3,
        }}
        col={2}
        row={3}
        paneCols={20}
        paneRows={10}
        cellPx={{ width: 8, height: 16 }}
        pack={pack}
      />,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Unidentified item');
    expect(tooltip).toHaveTextContent('Unidentified');
    expect(tooltip).not.toHaveTextContent(/notched from honest use/i);
    expect(tooltip).not.toHaveTextContent('Damage');
    expect(document.querySelector('.threat-popover-description')).not.toBeInTheDocument();
  });

  it('shows the honest hardcoded copy for a stair tile, with no facts', () => {
    render(
      <AssetPopover
        asset={{
          title: 'Stairs down',
          detail: 'Descends deeper into the Deep.',
          x: 2,
          y: 3,
        }}
        col={2}
        row={3}
        paneCols={20}
        paneRows={10}
        cellPx={{ width: 8, height: 16 }}
        pack={pack}
      />,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Stairs down');
    expect(tooltip).toHaveTextContent('Descends deeper into the Deep.');
    expect(document.querySelector('.threat-popover-description')).not.toBeInTheDocument();
    expect(tooltip).not.toHaveTextContent('Worth');
  });
});
