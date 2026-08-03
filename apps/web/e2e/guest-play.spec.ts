import { expect, test, type Page } from '@playwright/test';
import { dungeonCanvas, hoverWorldCell, topBarLocation } from './support.js';

/**
 * The 5A exit demonstration: a guest plays the real game — real server, real content pack,
 * real chromium — by keyboard alone.
 *
 * The seed and every key below are pinned test data, reviewed like the engine demos' hashes.
 * Derivation: a throwaway node script drove the built engine exactly like `GuestSession.dispatch`
 * (`createNewRun({ pack, seed: [11, 22, 33, 44], hero: DEFAULT_GUEST_HERO })`, then
 * `resolveCommand`/`descendToNextFloor` per keypress, path-planned over the floor's true tiles)
 * and printed the resulting key sequence. Engine determinism (same seed + same command sequence
 * = same states) makes the replay exact.
 *
 * Town start (5C): quickstart now boots into the authored town (depth 0), so every walk gains a
 * one-step descend prefix — the hero spawns at (5,9), the dungeon entrance / stair-down is (6,10)
 * (a single southeast step, `3`), then `>` drops to depth 1 (160x50, hero on the stair-up at
 * (38,23)). The two dungeon walks below are re-derived against that floor's CURRENT population
 * (issue #107): monsters now spawn in packed pairs, and the nearest pack to the stair-up is the
 * cave-rat pair at (54,44)/(54,45). `KILL` marches to that pair and kills BOTH rats (the second
 * closes to melee as the first dies), ending at (57,41) with nothing hostile within eight cells —
 * a calm spot for the item-management beats. `CLUSTER_KILL` is the same march stopped one blow
 * earlier: the first rat dies with the survivor adjacent at (56,42), hero at (57,41), for the
 * threat-popover walk. No seed places ground items on a dungeon floor, so the "walk onto an item
 * and press g" beat drops one of the hero's travel rations and picks it back up.
 *
 * Southwest steps use `b` (the default keymap's vi binding): the top-row `1` is the potion belt's
 * first slot now — only `Numpad1` still means southwest, and Playwright's `keyboard.press('1')`
 * sends `Digit1`, which with an empty belt is a silent no-op that desyncs the walk.
 */
// The landing page now owns `/`; the guest game lives behind the `/play` path (see
// `src/main.tsx`'s path check). The seed override still parses out of the query string exactly
// as before (see `App.tsx`'s `parseSeedFromQuery`). `?quickstart=1` is the test-only escape hatch
// that skips the title screen and chargen wizard (added alongside `ScreenState`) and boots
// straight into play with `DEFAULT_GUEST_HERO`.
const SEED_QUERY = '/play?quickstart=1&seed=11.22.33.44';

/** Town spawn (5,9) -> dungeon entrance / stair-down (6,10): one southeast step, then `>`. */
const DESCEND_PREFIX = ['3'];

/** Depth 1: march to the nearest cave-rat pair and bump-attack until BOTH die (the second rat
 * closes to melee as the first falls), ending at (57,41) with no hostiles within eight cells — a
 * calm spot for the drop/pickup/consume/rest beats. */
const KILL = [
  '6',
  '3',
  '3',
  '6',
  '3',
  '3',
  '3',
  '3',
  '3',
  '6',
  '6',
  '6',
  '6',
  '6',
  '6',
  '6',
  '6',
  '6',
  '3',
  '2',
  '2',
  '2',
  '2',
  '2',
  '2',
  '2',
  '2',
  '2',
  '2',
  'b',
  'b',
];

/** Depth 1: the same march stopped one blow earlier — the first cave rat dies with its packmate
 * (a live cave rat) left adjacent at (56,42), hero at (57,41). */
const CLUSTER_KILL = [
  '6',
  '3',
  '3',
  '6',
  '3',
  '3',
  '3',
  '3',
  '3',
  '6',
  '6',
  '6',
  '6',
  '6',
  '6',
  '6',
  '6',
  '6',
  '3',
  '2',
  '2',
  '2',
  '2',
  '2',
  '2',
  '2',
  '2',
  '2',
  '2',
  'b',
];

async function pressAll(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/**
 * The very first keydown after load can race the key listener attaching. Pressing `g` with
 * nothing underfoot is rejected client-side ("There is nothing here to pick up.") WITHOUT
 * touching engine state, so it proves the keyboard is live without desyncing the pinned walk.
 */
async function awaitKeyboardReady(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('g');
    await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(
      /nothing here to pick up/i,
      { timeout: 250 },
    );
  }).toPass();
}

/** Opens the backpack with `i` and waits until its focus trap owns the keyboard, so the
 * following menu keys can never race the dialog's mount -- the overlay's mount effect moves focus
 * onto its own listbox (see `InventoryOverlay`'s `useEffect`), not onto any particular button. */
async function openBackpack(page: Page): Promise<void> {
  await page.keyboard.press('i');
  const dialog = page.getByRole('dialog', { name: 'Pack & Gear' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listbox')).toBeFocused();
}

async function closeBackpack(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Pack & Gear' })).toBeHidden();
}

test('a guest plays, persists, and descends by keyboard alone', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(dungeonCanvas(page)).toBeVisible();
  await expect(topBarLocation(page)).toContainText(/town/i);
  const log = page.getByRole('log', { name: /adventure log/i });
  await awaitKeyboardReady(page);

  // Descend from town into the dungeon.
  await pressAll(page, DESCEND_PREFIX);
  await page.keyboard.press('>');
  await expect(topBarLocation(page)).toContainText(/depth 1/i);

  // Bump-attack a monster until it dies.
  await pressAll(page, KILL);
  await expect(log).toContainText(/dies/i);

  // Drop a travel ration (creating a real ground item), step off and back onto it, pick it up.
  // North/south is the derived step pair at (57,41) — west is a wall there.
  await openBackpack(page);
  await page.keyboard.press('d');
  await closeBackpack(page);
  await pressAll(page, ['8', '2']);
  await page.keyboard.press('g');
  await expect(log).toContainText(/you pick up an item/i);

  // Consume a travel ration through the backpack menu.
  await openBackpack(page);
  await page.keyboard.press('u');
  await closeBackpack(page);
  await expect(log).toContainText(/you consume an item/i);

  // Rest (completes or is interrupted — either way the engine reports why it stopped).
  await page.keyboard.press('Shift+R');
  await expect(log).toContainText(/stop resting/i);
});

test('a mid-run reload restores the run and a cleared session starts fresh', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(dungeonCanvas(page)).toBeVisible();

  // Wait at least one turn (pressing again if the very first keydown raced the listener
  // attaching); every applied command persists the run to sessionStorage.
  await expect(async () => {
    await page.keyboard.press('.');
    await expect(page.getByTestId('turn-count')).not.toHaveText(/turn 0/i, { timeout: 250 });
  }).toPass();
  const turnBefore = await page.getByTestId('turn-count').textContent();

  await page.reload();
  await expect(page.getByTestId('turn-count')).toHaveText(turnBefore!); // restored, not reset
  await expect(page.getByText(/your run was restored/i)).toBeVisible();

  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId('turn-count')).toHaveText(/turn 0/i); // fresh
  await expect(page.getByText(/a new run has begun/i)).toBeVisible();
});

test('every interactive surface is reachable by keyboard', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(dungeonCanvas(page)).toBeVisible();

  // The session banner's Dismiss button is first in tab order; dismiss it by keyboard.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Dismiss' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: /new run/i })).toBeHidden();

  // Unlike the retired DOM grid (a real focus target the old right-rail design tabbed into), the
  // Pixi canvas is never focusable -- keyboard input is a global `window` keydown listener
  // (`usePlayKeyDispatcher`), independent of DOM focus entirely. So there is no "Tab reaches the
  // grid, grid is focused" step to translate; the surviving intent -- the game keeps responding to
  // keyboard input after the banner's dismissal -- is proven by the same no-op `g` probe every
  // other spec in this suite uses to confirm the keyboard is live.
  await awaitKeyboardReady(page);

  // `i` opens the backpack as a focus-trapped dialog: its mount effect moves focus onto the
  // backpack's own listbox (see `InventoryOverlay`)...
  await page.keyboard.press('i');
  const dialog = page.getByRole('dialog', { name: 'Pack & Gear' });
  await expect(dialog).toBeVisible();
  const listbox = dialog.getByRole('listbox');
  await expect(listbox).toBeFocused();

  // ...and Tab cannot escape the dialog: it wraps within its focusables (the toolbar's filter/sort
  // buttons, the listbox itself, the detail pane's action buttons, and the close button).
  const focusables = dialog.locator('button, [role="listbox"]');
  const firstFocusable = focusables.first();
  const lastFocusable = focusables.last();
  await lastFocusable.focus();
  await page.keyboard.press('Tab');
  await expect(firstFocusable).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(lastFocusable).toBeFocused();

  // Escape closes the dialog; the game is still live afterward (again, there is no focus target to
  // reassert -- the canvas is never a focusable element).
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await awaitKeyboardReady(page);
});

// The full-bleed HUD has no always-on right rail at all: hero vitals/spells/conditions/threats now
// live only in their overlays (Hero Record, Spellbook) and this hover popover -- there is no
// persistent "Threats" region to list a nearby hostile in anymore (see `PlayScreen`'s own doc
// comment), so the pre-redesign "the right rail lists a nearby threat" half of this test has no
// honest translation and is dropped rather than faked. The surviving, still-representable intent is
// "hovering a nearby hostile's cell raises the popover naming it", which this test now proves purely
// through the canvas.
test('hovering a nearby threat on the canvas raises the popover', async ({ page }) => {
  await page.goto(SEED_QUERY);
  await expect(dungeonCanvas(page)).toBeVisible();
  await awaitKeyboardReady(page);

  // Descend, then march to the cave-rat pair and kill the first: its packmate survives at world
  // cell (56,42) beside the hero at (57,41) — pinned by the derivation run.
  await pressAll(page, DESCEND_PREFIX);
  await page.keyboard.press('>');
  await expect(topBarLocation(page)).toContainText(/depth 1/i);
  await pressAll(page, CLUSTER_KILL);
  await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(/dies/i);

  const hero = { x: 57, y: 41 };
  const rat = { x: 56, y: 42 };

  // Hovering the rat's cell (computed from the pinned hero cell via the same iso projection the
  // renderer itself uses -- see `support.ts`'s `hoverWorldCell`) raises the threat popover card.
  await hoverWorldCell(page, hero, rat);
  const popover = page.getByRole('tooltip');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText(/cave rat/i);

  // Resizing the viewport never hides the canvas, and the popover still raises at the recomputed
  // pixel position for the (now-different) canvas size.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(dungeonCanvas(page)).toBeVisible();
  await page.mouse.move(0, 0); // clear the stale hover from the old viewport size first
  await hoverWorldCell(page, hero, rat);
  await expect(popover).toBeVisible();
  await expect(popover).toContainText(/cave rat/i);
});
