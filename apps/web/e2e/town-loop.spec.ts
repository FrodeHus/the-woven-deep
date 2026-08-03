import { expect, test, type Page } from '@playwright/test';
import { dungeonCanvas, expectHeroAt, topBarLocation } from './support.js';

/**
 * The 5C exit demonstration: the full town loop, proven end to end in a real chromium against the
 * real server and content pack, by keyboard alone. This is the milestone's exit gate:
 *
 *   boot to town -> buy from the provisioner -> store the purchase in the house -> descend ->
 *   kill a monster -> return to town and back down (the killed monster stays dead: the hero walks
 *   onto its very cell) -> sell surplus starting gear to the arms dealer -> buy the strongbox
 *   upgrade (house capacity 6 -> 10) -> withdraw the stored item -> descend once more.
 *
 * The seed and every key below are pinned test data, reviewed like the engine demos' hashes.
 * Derivation: a throwaway node script (not committed) drove the built engine exactly like
 * `GuestSession.dispatch` (`createNewRun({ pack, seed: [11,22,33,44], hero: DEFAULT_GUEST_HERO })`
 * through `@woven-deep/session-core`'s `dispatchIntent`, path-planned over each floor's true tiles
 * with the engine's own `findPath`, trade/house/unequip via the real intents the screens issue) and
 * printed the resulting key sequences. Engine determinism (same seed + same command sequence =
 * byte-identical state) makes the browser replay exact.
 *
 * Town facts (seed-independent, authored): town is 34x16, hero spawns at (5,9); the dungeon
 * entrance / stair-down is (6,10); the house door is (27,13); the provisioner stall is (6,2), the
 * arms dealer (armorer) (16,2). Economy (authored, seed-independent): start 40g; the provisioner's
 * first stock row is Lamp oil at 4g; the armorer buys the leather armor for 10g and the iron sword
 * for 9g; the strongbox service costs 50g. So 40 - 4 (oil) = 36, + 10 + 9 (gear) = 55, - 50
 * (strongbox) = 5.
 *
 * Depth 1 for this seed is 160x50; the hero arrives on the stair-up at (38,23). The nearest
 * hostiles are a cave-rat pair around (54,44); the KILL walk bump-attacks until BOTH die (two
 * blows each since the #212 combat tuning), the first at (56,42). The stored-floor proof re-descends and walks the hero back onto (56,42): only
 * reachable if that monster stays dead (a live monster would block the cell). Southwest steps use
 * `b` (top-row `1` is the potion belt's first slot now; see `guest-play.spec.ts`).
 */
const SEED_QUERY = '/play?quickstart=1&seed=11.22.33.44';

/** Depth-1 walks. */
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
  '2',
  '2',
];
const TO_STAIR_UP = [
  '8',
  '8',
  '8',
  '8',
  '8',
  '8',
  '8',
  '8',
  '8',
  '8',
  '7',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '7',
  '7',
  '4',
  '7',
  '7',
  '7',
  '4',
  '7',
  '7',
];
// After re-descending: walk the hero back onto the corpse cell (56,42), then to the stair-up (38,23).
const TO_CORPSE = [
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
const TO_STAIR_UP_2 = [
  '9',
  '8',
  '8',
  '8',
  '8',
  '8',
  '8',
  '8',
  '8',
  '8',
  '8',
  '7',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '7',
  '7',
  '4',
  '7',
  '7',
  '7',
  '4',
  '7',
  '7',
];
// Town walks.
const TO_PROVISIONER = ['8', '8', '8', '8', '8', '8'];
const TO_HOUSE = [
  '6',
  '6',
  '6',
  '3',
  '6',
  '6',
  '6',
  '6',
  '3',
  '3',
  '3',
  '3',
  '3',
  '3',
  '3',
  '3',
  '3',
  '3',
  '6',
  '6',
  '6',
];
const TO_STAIR = [
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '7',
  '7',
  '7',
  '7',
];
const TO_ARMORER = ['6', '6', '9', '9', '9', '9', '9', '9', '9', '8'];
const TO_PROVISIONER_2 = ['2', 'b', '4', '4', '4', '4', '4', '7', '7'];
const TO_HOUSE_2 = [
  '3',
  '3',
  '6',
  '6',
  '6',
  '6',
  '3',
  '3',
  '3',
  '3',
  '3',
  '3',
  '3',
  '3',
  '3',
  '3',
  '6',
  '6',
  '6',
];
const TO_STAIR_2 = [
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '4',
  '7',
  '7',
  '7',
  '7',
];

async function pressAll(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** The very first keydown after load can race the key listener attaching; a `g` with nothing
 * underfoot is rejected client-side without touching engine state, proving the keyboard is live. */
async function awaitKeyboardReady(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('g');
    await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(
      /nothing here to pick up/i,
      { timeout: 250 },
    );
  }).toPass();
}

/** Opens a dialog by key and waits for it to mount before the caller sends further keys.
 * `TradeScreen`/`HouseScreen` route Tab/Arrow/Enter through a capture-phase `window` listener
 * rather than DOM focus (see their own doc comments), so -- unlike the backpack sheet, whose
 * dedicated focus-trap contract is exercised in `guest-play.spec.ts` -- there is no single
 * "the first item is focused" assertion that applies to every dialog this helper opens; waiting
 * for visibility is the load-bearing guard against racing the dialog's mount here. */
async function openDialog(page: Page, key: string, name: RegExp): Promise<void> {
  await page.keyboard.press(key);
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
}

/** The currency readout used to be the only `Ng`-shaped text in the dialog; the trade screen now
 * also renders a `Ng` price tag on every stock/sale row (`min-w-11 text-right text-accent-strong`
 * spans), so a bare text match is ambiguous. The "Your purse" readout is still the only text in the
 * dialog wrapped in the `text-lg` paragraph (`TradeScreen.tsx`), so scope to that. */
function currencyText(dialog: ReturnType<Page['getByRole']>) {
  return dialog.locator('p.text-lg span:not([aria-hidden])');
}

/** The house capacity readout is a plain `House (used/capacity)` paragraph (no dedicated class). */
function houseCapacityText(dialog: ReturnType<Page['getByRole']>) {
  return dialog.getByText(/^House \(\d+\/\d+\)$/);
}

test('the town loop: buy, store, descend, kill, return, sell, upgrade, retrieve, descend', async ({
  page,
}) => {
  await page.goto(SEED_QUERY);
  await expect(dungeonCanvas(page)).toBeVisible();
  const trade = page.getByRole('dialog', { name: /trade/i });
  const house = page.getByRole('dialog', { name: /house/i });

  // --- Boot to town: the status label reads "Town" and the provisioner is on the town panel. ---
  await expect(topBarLocation(page)).toContainText(/town/i);
  await expect(page.getByRole('region', { name: 'Town' })).toContainText(/provisioner/i);
  await awaitKeyboardReady(page);

  // --- Buy Lamp oil from the provisioner: currency drops 40g -> 36g. ---
  await pressAll(page, TO_PROVISIONER);
  await openDialog(page, 'Shift+T', /trade/i);
  await expect(currencyText(trade)).toHaveText('40g');
  await page.keyboard.press('Enter'); // buy the first stock row (Lamp oil, 4g)
  await expect(currencyText(trade)).toHaveText('36g');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /trade/i })).toBeHidden();

  // --- Store the just-bought oil in the house: the capacity readout shows 1/6. ---
  await pressAll(page, TO_HOUSE);
  await openDialog(page, 'Shift+H', /house/i);
  await page.keyboard.press('Enter'); // deposit the selected backpack row (the lamp oil)
  await expect(houseCapacityText(house)).toHaveText('House (1/6)');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /house/i })).toBeHidden();

  // --- Descend to Depth 1. ---
  await pressAll(page, TO_STAIR);
  await page.keyboard.press('>');
  await expect(topBarLocation(page)).toContainText(/depth 1/i);

  // --- Kill the cave-rat pair. ---
  await pressAll(page, KILL);
  await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(/dies/i);

  // --- Return to town, then back down to the SAME stored floor. ---
  await pressAll(page, TO_STAIR_UP);
  await page.keyboard.press('<');
  await expect(topBarLocation(page)).toContainText(/town/i);
  await page.keyboard.press('>');
  await expect(topBarLocation(page)).toContainText(/depth 1/i);

  // Dead stays dead: walk the hero back onto the first killed rat's cell (56,42). It is only
  // reachable and standable because the corpse never respawned -- a regenerated floor would have a
  // live monster there. The hero glyph occupying the cell is the proof.
  await pressAll(page, TO_CORPSE);
  await expectHeroAt(page, 56, 42);

  // Back up to town for the trade half of the loop.
  await pressAll(page, TO_STAIR_UP_2);
  await page.keyboard.press('<');
  await expect(topBarLocation(page)).toContainText(/town/i);

  // --- Unequip the surplus starting gear (sword + armor) into the backpack so it can be sold.
  // List order is backpack rows first (the travel rations), then equipped gear in slot order:
  // main-hand iron sword, off-hand pitch torch, body leather armor. Unequipping the sword moves it
  // into the backpack section (before the equipped rows), so the armor stays two rows further on. ---
  await openDialog(page, 'i', /pack & gear/i);
  await page.keyboard.press('ArrowDown'); // -> Iron sword (equipped, main-hand)
  await page.keyboard.press('e'); // unequip sword
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // -> Leather armor (equipped, body)
  await page.keyboard.press('e'); // unequip armor
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /pack & gear/i })).toBeHidden();

  // --- Sell both to the arms dealer: currency rises 36g -> 55g. ---
  await pressAll(page, TO_ARMORER);
  await openDialog(page, 'Shift+T', /trade/i);
  await expect(currencyText(trade)).toHaveText('36g');
  await page.keyboard.press('Tab'); // buy -> sell list
  await page.keyboard.press('Enter'); // sell the first sale offer
  // Wait for the sale to settle (the offer list re-renders) before selling the next.
  await expect(currencyText(trade)).not.toHaveText('36g');
  await page.keyboard.press('Enter'); // sell the remaining sale offer
  await expect(currencyText(trade)).toHaveText('55g');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /trade/i })).toBeHidden();

  // --- Buy the strongbox upgrade from the provisioner: currency 55g -> 5g. ---
  await pressAll(page, TO_PROVISIONER_2);
  await openDialog(page, 'Shift+T', /trade/i);
  await page.keyboard.press('Tab'); // buy -> sell
  await page.keyboard.press('Tab'); // sell -> services
  await page.keyboard.press('Enter'); // buy the strongbox service (50g)
  await expect(currencyText(trade)).toHaveText('5g');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /trade/i })).toBeHidden();

  // --- Retrieve the stored oil: the house readout now shows capacity 10 (6 -> 10). ---
  await pressAll(page, TO_HOUSE_2);
  await openDialog(page, 'Shift+H', /house/i);
  await expect(houseCapacityText(house)).toHaveText('House (1/10)');
  await page.keyboard.press('Tab'); // backpack -> house list
  await page.keyboard.press('Enter'); // withdraw the stored oil
  await expect(houseCapacityText(house)).toHaveText('House (0/10)');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /house/i })).toBeHidden();

  // --- Descend once more to close the loop. ---
  await pressAll(page, TO_STAIR_2);
  await page.keyboard.press('>');
  await expect(topBarLocation(page)).toContainText(/depth 1/i);
});
