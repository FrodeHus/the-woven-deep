import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { App } from '../src/App.js';
import { GuestSession } from '../src/session/guest-session.js';
import {
  DEFAULT_BINDINGS, DEFAULT_SETTINGS, resolveKeymap, SETTINGS_KEY, type Settings,
} from '../src/session/settings.js';
import { COMMAND_SEQUENCE_KEY, PORTRAIT_KEY, SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';
import { RECORDS_KEY } from '../src/session/run-records-storage.js';
import { SettingsOverlay } from '../src/ui/overlays/SettingsOverlay.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

function packFetcher(): typeof fetch {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(pack))) as unknown as typeof fetch;
}

function fakeStorage(initial?: Readonly<Record<string, string>>): SessionStorageLike {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
    remove: (key: string) => { values.delete(key); },
  };
}

/** Finds a binding row's own `<li>` (label + current chord + Rebind/Reset) by its label text. */
function bindingRow(label: string): HTMLElement {
  return screen.getByText(label).closest('li')!;
}

describe('SettingsOverlay (component-level)', () => {
  function harness(overrides: Partial<Settings> = {}) {
    const settings: Settings = { ...DEFAULT_SETTINGS, ...overrides };
    const onChange = vi.fn();
    const onClearGuestSession = vi.fn();
    const keymap = resolveKeymap(settings.bindings);
    render(
      <SettingsOverlay settings={settings} onChange={onChange} onClearGuestSession={onClearGuestSession} keymap={keymap} />,
    );
    return { onChange, onClearGuestSession };
  }

  it('renders every ActionId row with its label and current chord', () => {
    harness();
    expect(bindingRow('Move west')).toHaveTextContent('h');
    expect(bindingRow('Pick up')).toHaveTextContent('g');
    expect(bindingRow('Rest')).toHaveTextContent('Shift+R');
    expect(bindingRow('Settings')).toHaveTextContent('o');
  });

  it('font scale: selecting a step calls onChange with the new fontScale, and the preview reflects it live', () => {
    const { onChange } = harness();
    const option130 = screen.getByRole('radio', { name: '130%' });
    fireEvent.click(option130);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fontScale: 1.3 }));
  });

  it('reduced motion "Always" reports reducedMotion: on', () => {
    const { onChange } = harness();
    fireEvent.click(screen.getByRole('radio', { name: /always/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reducedMotion: 'on' }));
  });

  it('reduced motion "Never" reports reducedMotion: off', () => {
    const { onChange } = harness();
    fireEvent.click(screen.getByRole('radio', { name: /never/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reducedMotion: 'off' }));
  });

  it('reduced motion "System" reports reducedMotion: system', () => {
    // Starts already checked (DEFAULT_SETTINGS.reducedMotion is 'system'), so seed a different
    // current value -- otherwise a click on an already-checked native radio fires no change event.
    const { onChange } = harness({ reducedMotion: 'on' });
    fireEvent.click(screen.getByRole('radio', { name: /^system/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reducedMotion: 'system' }));
  });

  it('rebind: Enter arms capture, the next keydown becomes the chord, reported via onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = harness();
    const waitRow = bindingRow('Wait');
    await user.tab(); // move focus onto the dialog's first control (font-scale radio)
    within(waitRow).getByRole('button', { name: 'Rebind' }).focus();
    await user.keyboard('{Enter}');
    expect(within(waitRow).getByRole('textbox')).toHaveFocus();
    await user.keyboard('z');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      bindings: expect.objectContaining({ wait: { key: 'z', shift: false } }),
    }));
  });

  it('conflict refusal: capturing "g" for Inventory names Pick up, and leaves both bindings intact', async () => {
    const user = userEvent.setup();
    const { onChange } = harness();
    const inventoryRow = bindingRow('Inventory');
    within(inventoryRow).getByRole('button', { name: 'Rebind' }).click();
    await user.keyboard('g');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Inventory could not be rebound.*Pick up already uses it/i);
    // Both rows keep their original chords.
    expect(bindingRow('Inventory')).toHaveTextContent('i');
    expect(bindingRow('Pick up')).toHaveTextContent('g');
  });

  it('hardwired-key refusal: capturing ArrowUp for Wait is refused (arrows/numpad always move, and routeKey resolves them before the keymap so the binding would never fire), leaving Wait unchanged', async () => {
    const user = userEvent.setup();
    const { onChange } = harness();
    const waitRow = bindingRow('Wait');
    within(waitRow).getByRole('button', { name: 'Rebind' }).click();
    await user.keyboard('{ArrowUp}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/arrow and numpad keys always move/i);
    expect(bindingRow('Wait')).toHaveTextContent('.');
  });

  it('modifier-only capture: pressing bare Shift is ignored -- capture stays armed, no chord committed, no refusal message', async () => {
    const user = userEvent.setup();
    const { onChange } = harness();
    const waitRow = bindingRow('Wait');
    within(waitRow).getByRole('button', { name: 'Rebind' }).click();
    await user.keyboard('{Shift}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(waitRow).getByRole('textbox')).toHaveFocus(); // still armed for capture

    // The capture is still live: a real key now commits normally.
    await user.keyboard('z');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      bindings: expect.objectContaining({ wait: { key: 'z', shift: false } }),
    }));
  });

  it('Escape while capturing cancels the capture without committing a chord or closing (the row reverts to its Rebind button)', async () => {
    const user = userEvent.setup();
    const { onChange } = harness();
    const waitRow = bindingRow('Wait');
    within(waitRow).getByRole('button', { name: 'Rebind' }).click();
    await user.keyboard('{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(within(waitRow).getByRole('button', { name: 'Rebind' })).toBeInTheDocument();
  });

  it('per-row reset drops just that action\'s override', () => {
    const { onChange } = harness({ bindings: { wait: { key: 'z', shift: false }, pickup: { key: 'p', shift: false } } });
    within(bindingRow('Wait')).getByRole('button', { name: 'Reset' }).click();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      bindings: { pickup: { key: 'p', shift: false } },
    }));
  });

  it('global reset restores DEFAULT_BINDINGS (an empty overrides map)', () => {
    const { onChange } = harness({ bindings: { wait: { key: 'z', shift: false } } });
    screen.getByRole('button', { name: 'Reset all bindings' }).click();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bindings: {} }));
  });

  it('clear guest session requires the exact word before the button enables, then calls onClearGuestSession', async () => {
    const user = userEvent.setup();
    const { onClearGuestSession } = harness();
    const confirmField = screen.getByLabelText(/type "clear" to confirm/i);
    const clearButton = screen.getByRole('button', { name: 'Clear guest session' });

    expect(clearButton).toBeDisabled();
    await user.type(confirmField, 'clea');
    expect(clearButton).toBeDisabled();
    await user.clear(confirmField);
    await user.type(confirmField, 'clear');
    expect(clearButton).toBeEnabled();

    await user.click(clearButton);
    expect(onClearGuestSession).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsOverlay composed with PlayScreen/App', () => {
  function bootStorage(): SessionStorageLike { return fakeStorage(); }

  async function bootIntoPlay(
    storage: SessionStorageLike = bootStorage(), localStorage: SessionStorageLike = bootStorage(),
  ): Promise<void> {
    window.history.pushState({}, '', '/play?quickstart=1');
    render(<App fetcher={packFetcher()} storage={storage} localStorage={localStorage} />);
    await screen.findByRole('grid', { name: /dungeon/i });
  }

  async function openSettings(): Promise<void> {
    fireEvent.keyDown(window, { key: 'o' });
    await screen.findByRole('dialog', { name: 'Settings' });
  }

  it('rebind flow persists via saveSettings and the router honors it -- walking with the new key dispatches move, the old key does not', async () => {
    const dispatchSpy = vi.spyOn(GuestSession.prototype, 'dispatch');
    const localStorage = bootStorage();
    await bootIntoPlay(bootStorage(), localStorage);
    await openSettings();

    const user = userEvent.setup();
    const westRow = bindingRow('Move west');
    within(westRow).getByRole('button', { name: 'Rebind' }).click();
    await user.keyboard('z');
    expect(bindingRow('Move west')).toHaveTextContent('z');

    // Persisted: the localStorage-backed settings blob now carries the override.
    const stored = JSON.parse(localStorage.get(SETTINGS_KEY)!) as Settings;
    expect(stored.bindings['move.w']).toEqual({ key: 'z', shift: false });

    fireEvent.keyDown(window, { key: 'Escape' }); // close the overlay
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();

    dispatchSpy.mockClear();
    fireEvent.keyDown(window, { key: 'z' });
    expect(dispatchSpy).toHaveBeenCalledWith({ type: 'move', direction: 'west' });

    dispatchSpy.mockClear();
    fireEvent.keyDown(window, { key: 'h' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('arrows still move after rebinding move.w away from "h" (hardwired synonyms are never rebindable)', async () => {
    const dispatchSpy = vi.spyOn(GuestSession.prototype, 'dispatch');
    await bootIntoPlay();
    await openSettings();

    const user = userEvent.setup();
    within(bindingRow('Move west')).getByRole('button', { name: 'Rebind' }).click();
    await user.keyboard('z');
    fireEvent.keyDown(window, { key: 'Escape' });

    dispatchSpy.mockClear();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(dispatchSpy).toHaveBeenCalledWith({ type: 'move', direction: 'west' });
  });

  it('global reset restores DEFAULT_BINDINGS end-to-end: "h" moves west again after a rebind+reset round-trip', async () => {
    const dispatchSpy = vi.spyOn(GuestSession.prototype, 'dispatch');
    await bootIntoPlay();
    await openSettings();

    const user = userEvent.setup();
    fireEvent.click(within(bindingRow('Move west')).getByRole('button', { name: 'Rebind' }));
    await user.keyboard('z');
    expect(bindingRow('Move west')).toHaveTextContent('z');

    fireEvent.click(screen.getByRole('button', { name: 'Reset all bindings' }));
    expect(await within(bindingRow('Move west')).findByText(chordKeyOf(DEFAULT_BINDINGS['move.w']))).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    dispatchSpy.mockClear();
    fireEvent.keyDown(window, { key: 'h' });
    expect(dispatchSpy).toHaveBeenCalledWith({ type: 'move', direction: 'west' });
  });

  it('font scale and reduced motion changes persist and re-render the app root on the next boot', async () => {
    const localStorage = bootStorage();
    await bootIntoPlay(bootStorage(), localStorage);
    await openSettings();

    fireEvent.click(screen.getByRole('radio', { name: '130%' }));
    fireEvent.click(screen.getByRole('radio', { name: /always/i }));

    const stored = JSON.parse(localStorage.get(SETTINGS_KEY)!) as Settings;
    expect(stored.fontScale).toBe(1.3);
    expect(stored.reducedMotion).toBe('on');

    // Re-render (fresh App instance) reading the SAME localStorage: the persisted values apply at
    // the root immediately, no further interaction needed.
    screen.getByRole('dialog', { name: 'Settings' }); // still open in the first render
    window.history.pushState({}, '', '/play?quickstart=1');
    const { container } = render(<App fetcher={packFetcher()} storage={bootStorage()} localStorage={localStorage} />);
    await within(container).findByRole('grid', { name: /dungeon/i });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\bmotion-reduced\b/);
    expect(root.style.fontSize).toBe('calc(1.3rem)');
  });

  it('clear guest session requires the exact word, wipes every guest-session key, and lands on the title screen', async () => {
    const storage = fakeStorage({
      [SAVE_KEY]: 'run-blob', [COMMAND_SEQUENCE_KEY]: '3', [RECORDS_KEY]: 'hall-blob', [PORTRAIT_KEY]: '@',
    });
    const localStorage = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, fontScale: 1.5 }) });
    await bootIntoPlay(storage, localStorage);
    await openSettings();

    const user = userEvent.setup();
    const confirmField = screen.getByLabelText(/type "clear" to confirm/i);
    await user.type(confirmField, 'clear');
    await user.click(screen.getByRole('button', { name: 'Clear guest session' }));

    await screen.findByRole('option', { name: /enter the deep/i });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();

    for (const key of [SAVE_KEY, COMMAND_SEQUENCE_KEY, RECORDS_KEY, PORTRAIT_KEY]) {
      expect(storage.get(key)).toBeNull();
    }
    expect(localStorage.get(SETTINGS_KEY)).toBeNull();
  });

  it('clear guest session forces the memoized Hall repository to reload: a seeded record is gone from the Hall screen after the wipe, not served stale from cache', async () => {
    const seededHall = {
      records: [{
        recordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
        heroName: 'Ada',
        classTags: ['fighter'],
        completionType: 'died',
        cause: { killerContentId: 'monster.cave-rat', depth: 3, turn: 12, worldTime: 12 },
        deepestDepth: 3,
        score: { lines: [], total: 40 },
        metrics: {
          kills: 0, killsByModel: { individual: 0, group: 0, swarm: 0, boss: 0 },
          bossKills: 0, championKills: 0, echoKills: 0, threatDefeated: 0,
          damageDealt: 0, damageTaken: 0, itemsCollected: 0, itemsIdentified: 0,
          currencyEarned: 0, currencySpent: 0, tradesCompleted: 0,
          floorsEntered: 0, deepestDepth: 3, discoveriesRevealed: 0,
          turnsElapsed: 0, restsCompleted: 0,
        },
        reputations: [],
        heirloom: null,
        build: { attributes: { might: 14, agility: 12, vitality: 16, wits: 10, resolve: 12 }, equippedItemContentIds: [], signatureAbilityIds: [] },
        runSeed: 'aaaaaaaa00000000',
        contentHash: 'b'.repeat(64),
        enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
      }],
      heart: null,
      lifetime: {
        conqueredChampionRecordIds: [], grantedAchievementIds: [], discoveryProtection: [],
        totals: {
          kills: 0, killsByModel: { individual: 0, group: 0, swarm: 0, boss: 0 },
          bossKills: 0, championKills: 0, echoKills: 0, threatDefeated: 0,
          damageDealt: 0, damageTaken: 0, itemsCollected: 0, itemsIdentified: 0,
          currencyEarned: 0, currencySpent: 0, tradesCompleted: 0,
          floorsEntered: 0, deepestDepth: 0, discoveriesRevealed: 0,
          turnsElapsed: 0, restsCompleted: 0,
        },
      },
      appliedDeltaRecordIds: [],
    };
    const storage = fakeStorage({ [RECORDS_KEY]: JSON.stringify(seededHall) });
    const localStorage = fakeStorage();
    await bootIntoPlay(storage, localStorage);
    await openSettings();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/type "clear" to confirm/i), 'clear');
    await user.click(screen.getByRole('button', { name: 'Clear guest session' }));

    await screen.findByRole('option', { name: /enter the deep/i });
    await user.click(screen.getByRole('option', { name: /hall of records/i }));

    await screen.findByRole('heading', { name: 'Hall of Records' });
    expect(screen.getByRole('status')).toHaveTextContent(/no runs have been recorded yet/i);
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });
});

function chordKeyOf(chord: Readonly<{ key: string; shift: boolean }>): string {
  return chord.shift ? `Shift+${chord.key}` : chord.key;
}
