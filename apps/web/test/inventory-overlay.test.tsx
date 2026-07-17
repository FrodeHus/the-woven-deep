import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  actorById, DEFAULT_GUEST_HERO, createNewRun, projectGameplayState, resolveCommand,
  type ActiveRun, type GameplayProjection, type ItemInstance,
} from '@woven-deep/engine';
import { foldEventsIntoLog } from '../src/session/event-log.js';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { InventoryOverlay, type ProjectedItemLike } from '../src/ui/overlays/InventoryOverlay.js';
import { OverlayScaffold } from '../src/ui/overlays/OverlayScaffold.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;
let baseRun: ActiveRun;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  baseRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: baseRun, content: pack });
});

function item(overrides: Readonly<Partial<ProjectedItemLike>> & Pick<ProjectedItemLike, 'itemId' | 'name' | 'category'>): ProjectedItemLike {
  return {
    quantity: 1, identified: true, condition: 100, fuel: null, enabled: null,
    ...overrides,
  };
}

function snapshotWithBackpack(
  items: readonly ProjectedItemLike[],
  equipment: Readonly<Record<string, ProjectedItemLike | null>> = {},
): SessionSnapshot {
  return {
    projection: {
      ...baseProjection,
      hero: { ...baseProjection.hero, backpack: items, equipment },
    } as unknown as GameplayProjection,
    log: [],
    lastEvents: [],
    pendingDecision: null,
    notice: null,
    houseOpen: false,
    conclusion: null, sightings: { monsterIds: [], itemIds: [] }, heroClassTags: [], onboarding: { counts: {}, dismissed: [] },
  };
}

describe('InventoryOverlay (absorbs BackpackMenu -- compatibility proof: every assertion below is', () => {
  describe('migrated byte-for-byte from the deleted backpack-menu.test.tsx)', () => {
    it('lists backpack items, traps focus, dispatches equip/use/drop/toggle-light intents, and closes on Escape', async () => {
      const user = userEvent.setup();
      const onDispatch = vi.fn();
      const onClose = vi.fn();
      const snapshot = snapshotWithBackpack([
        item({ itemId: 'item.torch', name: 'Torch', category: 'light' }),
        item({ itemId: 'item.potion', name: 'Potion', category: 'potion' }),
      ]);

      render(
        <OverlayScaffold title="Backpack" onClose={onClose} testId="overlay-inventory">
          <InventoryOverlay snapshot={snapshot} onDispatch={onDispatch} />
        </OverlayScaffold>,
      );

      const dialog = screen.getByRole('dialog', { name: /backpack/i });
      const list = within(screen.getByRole('listbox', { name: /backpack items/i }));
      expect(list.getByText('Torch')).toBeInTheDocument();
      expect(list.getByText('Potion')).toBeInTheDocument();

      // Focus starts on the list (its first focusable item) on open.
      const torchButton = screen.getByRole('button', { name: 'Torch' });
      const potionButton = screen.getByRole('button', { name: 'Potion' });
      expect(torchButton).toHaveFocus();

      // Tab wraps forward at the last focusable element back to the first.
      await user.tab();
      expect(potionButton).toHaveFocus();
      await user.tab();
      expect(torchButton).toHaveFocus();

      // Shift+Tab wraps backward from the first to the last.
      await user.tab({ shift: true });
      expect(potionButton).toHaveFocus();

      // Move selection down to Potion and use it.
      await user.keyboard('{ArrowDown}');
      await user.keyboard('u');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'use', itemId: 'item.potion' });

      // Move selection back up to Torch and equip/drop/toggle-light it.
      await user.keyboard('{ArrowUp}');
      await user.keyboard('e');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'equip', itemId: 'item.torch' });
      await user.keyboard('d');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'drop', itemId: 'item.torch' });
      await user.keyboard('l');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'toggle-light', itemId: 'item.torch' });

      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledOnce();

      void dialog;
    });

    it('lists equipped gear after backpack stacks and dispatches unequip when e is pressed on it', async () => {
      const user = userEvent.setup();
      const onDispatch = vi.fn();
      const snapshot = snapshotWithBackpack(
        [item({ itemId: 'item.ration', name: 'Travel ration', category: 'food' })],
        {
          'main-hand': item({ itemId: 'item.sword', name: 'Iron sword', category: 'weapon' }),
          body: null,
        },
      );

      render(
        <OverlayScaffold title="Backpack" onClose={vi.fn()} testId="overlay-inventory">
          <InventoryOverlay snapshot={snapshot} onDispatch={onDispatch} />
        </OverlayScaffold>,
      );

      // The backpack stack lists first; the equipped item renders after it with an "(equipped)" tag.
      const rationButton = screen.getByRole('button', { name: 'Travel ration' });
      const swordButton = screen.getByRole('button', { name: /Iron sword \(equipped\)/ });
      expect(rationButton).toHaveFocus();

      // e on the backpack stack still equips.
      await user.keyboard('e');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'equip', itemId: 'item.ration' });

      // Select the equipped sword; e now unequips it.
      await user.keyboard('{ArrowDown}');
      expect(swordButton).toHaveFocus();
      await user.keyboard('e');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'unequip', itemId: 'item.sword' });
    });

    it('shows a placeholder when the backpack is empty', () => {
      render(<InventoryOverlay snapshot={snapshotWithBackpack([])} onDispatch={vi.fn()} />);
      expect(screen.getByText(/backpack is empty/i)).toBeInTheDocument();
    });

    it('focuses the dialog container itself when opened with an empty backpack (no focusable items to fall back to)', () => {
      render(
        <OverlayScaffold title="Backpack" onClose={vi.fn()} testId="overlay-inventory">
          <InventoryOverlay snapshot={snapshotWithBackpack([])} onDispatch={vi.fn()} />
        </OverlayScaffold>,
      );
      const dialog = screen.getByRole('dialog', { name: /backpack/i });
      expect(dialog).toHaveFocus();
    });

    it('accepts uppercase action-key hints (e/u/d/l) the same as lowercase', async () => {
      const user = userEvent.setup();
      const onDispatch = vi.fn();
      const snapshot = snapshotWithBackpack([item({ itemId: 'item.torch', name: 'Torch', category: 'light' })]);

      render(
        <OverlayScaffold title="Backpack" onClose={vi.fn()} testId="overlay-inventory">
          <InventoryOverlay snapshot={snapshot} onDispatch={onDispatch} />
        </OverlayScaffold>,
      );

      await user.keyboard('E');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'equip', itemId: 'item.torch' });
      await user.keyboard('U');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'use', itemId: 'item.torch' });
      await user.keyboard('D');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'drop', itemId: 'item.torch' });
      await user.keyboard('L');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'toggle-light', itemId: 'item.torch' });
    });

    it('restores focus to whatever had it before the dialog opened, on close/unmount', () => {
      const opener = document.createElement('button');
      opener.textContent = 'Open backpack';
      document.body.appendChild(opener);
      opener.focus();
      expect(opener).toHaveFocus();

      const { unmount } = render(
        <OverlayScaffold title="Backpack" onClose={vi.fn()} testId="overlay-inventory">
          <InventoryOverlay
            snapshot={snapshotWithBackpack([item({ itemId: 'item.torch', name: 'Torch', category: 'light' })])}
            onDispatch={vi.fn()}
          />
        </OverlayScaffold>,
      );
      expect(opener).not.toHaveFocus();

      unmount();
      expect(opener).toHaveFocus();
      opener.remove();
    });
  });

  describe('new capabilities (category filter, name sort, detail pane)', () => {
    it('f cycles the category filter through all/weapons/armor/consumables/light/other and back to all', async () => {
      const user = userEvent.setup();
      const snapshot = snapshotWithBackpack([
        item({ itemId: 'item.sword', name: 'Sword', category: 'weapon' }),
        item({ itemId: 'item.shield', name: 'Shield', category: 'shield' }),
        item({ itemId: 'item.ration', name: 'Ration', category: 'food' }),
        item({ itemId: 'item.torch', name: 'Torch', category: 'light' }),
        item({ itemId: 'item.ring', name: 'Ring', category: 'ring' }),
      ]);

      render(
        <OverlayScaffold title="Backpack" onClose={vi.fn()} testId="overlay-inventory">
          <InventoryOverlay snapshot={snapshot} onDispatch={vi.fn()} />
        </OverlayScaffold>,
      );
      const filterLabel = () => screen.getByText(/^Filter:/);

      expect(filterLabel()).toHaveTextContent('Filter: All');

      await user.keyboard('f');
      expect(filterLabel()).toHaveTextContent('Filter: Weapons');
      expect(screen.getByRole('button', { name: 'Sword' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Shield' })).not.toBeInTheDocument();

      await user.keyboard('f');
      expect(filterLabel()).toHaveTextContent('Filter: Armor');
      expect(screen.getByRole('button', { name: 'Shield' })).toBeInTheDocument();

      await user.keyboard('f');
      expect(filterLabel()).toHaveTextContent('Filter: Consumables');
      expect(screen.getByRole('button', { name: 'Ration' })).toBeInTheDocument();

      await user.keyboard('f');
      expect(filterLabel()).toHaveTextContent('Filter: Light');
      expect(screen.getByRole('button', { name: 'Torch' })).toBeInTheDocument();

      await user.keyboard('f');
      expect(filterLabel()).toHaveTextContent('Filter: Other');
      expect(screen.getByRole('button', { name: 'Ring' })).toBeInTheDocument();

      await user.keyboard('f');
      expect(filterLabel()).toHaveTextContent('Filter: All');
      expect(screen.getByRole('button', { name: 'Sword' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ring' })).toBeInTheDocument();
    });

    it('s toggles a stable, locale-free name sort -- default order is backpack-then-equipped (unsorted)', async () => {
      const user = userEvent.setup();
      const snapshot = snapshotWithBackpack(
        [
          item({ itemId: 'item.zebra', name: 'Zebra pelt', category: 'misc' }),
          item({ itemId: 'item.apple', name: 'Apple', category: 'food' }),
        ],
        { 'main-hand': item({ itemId: 'item.mid', name: 'Mid sword', category: 'weapon' }) },
      );

      render(
        <OverlayScaffold title="Backpack" onClose={vi.fn()} testId="overlay-inventory">
          <InventoryOverlay snapshot={snapshot} onDispatch={vi.fn()} />
        </OverlayScaffold>,
      );

      // Default (unsorted): backpack order first (Zebra, Apple), then equipped (Mid sword).
      let buttons = screen.getAllByRole('button');
      expect(buttons.map((button) => button.textContent)).toEqual(['Zebra pelt', 'Apple', 'Mid sword (equipped)']);

      await user.keyboard('s');
      // Plain codepoint order: 'Apple' < 'Mid sword' < 'Zebra pelt'.
      buttons = screen.getAllByRole('button');
      expect(buttons.map((button) => button.textContent)).toEqual(['Apple', 'Mid sword (equipped)', 'Zebra pelt']);

      await user.keyboard('s');
      buttons = screen.getAllByRole('button');
      expect(buttons.map((button) => button.textContent)).toEqual(['Zebra pelt', 'Apple', 'Mid sword (equipped)']);
    });

    it('the detail pane shows an unidentified item by its verb+noun appearance, with NO contentId anywhere in the markup', () => {
      const snapshot = snapshotWithBackpack([
        {
          itemId: 'item.mystery', name: 'shimmering draught', category: 'potion',
          quantity: 1, identified: false, condition: 100, fuel: null, enabled: null,
          // Deliberately no `contentId` -- exactly what `projectItem` omits for a hidden appearance.
        },
      ]);

      const { container } = render(<InventoryOverlay snapshot={snapshot} onDispatch={vi.fn()} />);

      expect(screen.getByRole('button', { name: 'shimmering draught' })).toBeInTheDocument();
      expect(screen.getByText('Unidentified')).toBeInTheDocument();
      expect(container.innerHTML).not.toContain('item.mystery-potion');
      expect(container.innerHTML).not.toMatch(/contentId/i);
    });

    it('the detail pane shows effects, enchantment, unknown-properties, charges/fuel/condition, and the equipped-slot marker', () => {
      const snapshot = snapshotWithBackpack(
        [],
        {
          'main-hand': item({
            itemId: 'item.enchanted-sword', contentId: 'item.sword', name: 'Enchanted sword', category: 'weapon',
            effects: [{ effectId: 'effect.bleed', parameters: {} }],
            enchantment: { enchantmentId: 'enchant.1', modifiers: { meleeAccuracy: 3 } },
            charges: 4, condition: 87,
          }),
        },
      );

      render(<InventoryOverlay snapshot={snapshot} onDispatch={vi.fn()} />);

      expect(screen.getByText('Identified')).toBeInTheDocument();
      expect(screen.getByText('effect.bleed')).toBeInTheDocument();
      expect(screen.getByText('meleeAccuracy: +3')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument(); // charges
      expect(screen.getByText('87')).toBeInTheDocument(); // condition
      expect(screen.getByText('main-hand')).toBeInTheDocument(); // equipped-slot marker
    });

    it('marks unknown properties (an unidentified enchantment) without leaking the enchantment itself', () => {
      const snapshot = snapshotWithBackpack([
        item({
          itemId: 'item.ring-a', contentId: 'item.ring', name: 'Ring', category: 'ring',
          unknownProperties: true, identified: false,
        }),
      ]);

      render(<InventoryOverlay snapshot={snapshot} onDispatch={vi.fn()} />);
      expect(screen.getByText('Unknown properties')).toBeInTheDocument();
    });

    it('equip from the overlay updates the equipment slot live and the overlay stays open (re-renders from the projection)', async () => {
      const user = userEvent.setup();
      const onDispatch = vi.fn();
      const initial = snapshotWithBackpack([item({ itemId: 'item.torch', name: 'Torch', category: 'light' })]);

      const { rerender } = render(
        <OverlayScaffold title="Backpack" onClose={vi.fn()} testId="overlay-inventory">
          <InventoryOverlay snapshot={initial} onDispatch={onDispatch} />
        </OverlayScaffold>,
      );
      expect(screen.getByRole('button', { name: 'Torch' })).toBeInTheDocument();

      await user.keyboard('e');
      expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'equip', itemId: 'item.torch' });

      // Simulate the live re-render `useGuestSession` would produce once the engine applies the
      // equip command: the item moves from `backpack` to `equipment.light`, and the overlay never
      // unmounts (no `onClose` call anywhere in this test).
      const afterEquip = snapshotWithBackpack([], { light: item({ itemId: 'item.torch', name: 'Torch', category: 'light' }) });
      rerender(
        <OverlayScaffold title="Backpack" onClose={vi.fn()} testId="overlay-inventory">
          <InventoryOverlay snapshot={afterEquip} onDispatch={onDispatch} />
        </OverlayScaffold>,
      );

      expect(screen.getByRole('button', { name: /Torch \(equipped\)/ })).toBeInTheDocument();
    });
  });

  describe('full-backpack rejection (existing invalid-command handling, exercised through the exact commands the overlay dispatches)', () => {
    it('unequip is rejected with the standard "cannot be done (inventory.full)" log line when the backpack has no room', () => {
      // Fill the backpack to its 12-slot capacity with filler stacks (a stack occupies one slot
      // regardless of quantity -- see `inventorySlotCount` in packages/engine/src/inventory.ts),
      // then attempt to unequip the hero's starting sword: `unequipItem` moves the displaced item
      // into the backpack, so a full backpack rejects it with `inventory.full` -- the same
      // rejection path `drop`'s sibling backpack actions all share, mapped by
      // `event-log.ts`'s `action.invalid` case to the literal standard log line.
      const template = baseRun.items.find((candidate): candidate is ItemInstance => candidate.location.type === 'backpack')!;
      const equippedItems = baseRun.items.filter((candidate) => candidate.location.type === 'equipped');
      const filler = Array.from({ length: 12 }, (_, index) => ({
        ...template, itemId: `filler.${index}`, quantity: 1,
        location: { type: 'backpack' as const, actorId: baseRun.hero.actorId },
      }));
      const fullRun: ActiveRun = { ...baseRun, items: [...equippedItems, ...filler] };
      const heroActor = actorById(fullRun, fullRun.hero.actorId)!;
      const slot = Object.entries(heroActor.equipment).find(([, itemId]) => itemId !== null)!;

      const resolution = resolveCommand(
        fullRun,
        { type: 'unequip', slot: slot[0] as never, commandId: 'cmd.full-backpack-test', expectedRevision: fullRun.revision },
        { content: pack },
      );

      expect(resolution.result.status).toBe('invalid');
      expect((resolution.result as { reason?: string }).reason).toBe('inventory.full');

      const folded = foldEventsIntoLog([], resolution.events, 1);
      expect(folded.log.some((line: { text: string }) => /cannot be done \(inventory\.full\)/i.test(line.text))).toBe(true);
    });
  });
});
