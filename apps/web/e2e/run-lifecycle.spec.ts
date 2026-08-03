import { expect, test, type Page } from '@playwright/test';
import { dungeonCanvas, topBarLocation } from './support.js';

/**
 * The 5B exit demonstration: the full chargen -> play -> death -> conclusion -> Hall lifecycle,
 * proven in a real chromium against the real server and content pack, by keyboard.
 *
 * Two independent journeys share this file:
 *
 * 1. The eight-step chargen console (`/play?seed=...`, NO quickstart), driven the way a player
 *    would: a typed name, clicked option rows, a point-buy allocation adjusted through the
 *    attribute stepper's +/- buttons, and a click on "NEXT ▸" between steps. The step order is
 *    Identity -> Calling -> Kit -> Attributes -> Origin -> Traits -> Mode -> Review. The seed pins
 *    the console's attribute rolls but is irrelevant to the point-buy path this walk ends on. The
 *    chosen block sets Vitality to 12; with the `maxHealth = { base: 10, vitality: 1 }` formula
 *    and no equipment/background/trait touching maxHealth (verified against the bundled content),
 *    the Lamplighter lands in play with 10 + 12 = 22 HP and the brass lantern in its off-hand.
 *
 * 2. The death loop (`/play?quickstart=1&seed=11.22.33.44`, the same pinned seed +
 *    `DEFAULT_GUEST_HERO` as the 5A walk). Town start: quickstart boots into the town, so the walk
 *    gains a one-step descend prefix (`3` then `>`, spawn (5,9) -> dungeon entrance (6,10) ->
 *    depth 1). On the 160x50 depth-1 floor the hero marches to the nearest cave-rat pair and kills
 *    ONE of them (`CLUSTER_KILL`, shared derivation with `guest-play.spec.ts`), leaving its live
 *    packmate adjacent at (56,42) with the hero at (57,41). From there the hero simply WAITS
 *    (`.`): each wait passes the turn to the adjacent hostile, which attacks with no retaliation,
 *    and the hero dies (the cave rat lands the blow — 86 waits for this pinned seed,
 *    engine-deterministic). That count is deliberately NOT hardcoded — we poll the conclusion
 *    screen with an immediate `isVisible()` under a generous cap — because a pinned wait-count
 *    would be brittle test data with no reader value, unlike the movement walk it builds on.
 */
const WIZARD_SEED_QUERY = '/play?seed=11.22.33.44';
const QUICKSTART_QUERY = '/play?quickstart=1&seed=11.22.33.44';

/** Town spawn (5,9) -> dungeon entrance / stair-down (6,10): one southeast step, then `>`. */
const DESCEND_PREFIX = ['3'];

/** Depth 1: march to the cave-rat pair and kill the first — its packmate survives adjacent at
 * (56,42), hero at (57,41) (see `guest-play.spec.ts`'s derivation notes; the trailing southwest
 * bump is `b` because top-row `1` is the potion belt's first slot now). */
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

/** See `guest-play.spec.ts`: the very first keydown after load can race the key listener
 * attaching, so prove the keyboard is live with a no-op `g` before the pinned walk. */
async function awaitKeyboardReady(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('g');
    await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(
      /nothing here to pick up/i,
      { timeout: 250 },
    );
  }).toPass();
}

test('a guest builds a Lamplighter through the eight-step console and enters play', async ({
  page,
}) => {
  await page.goto(WIZARD_SEED_QUERY);

  // Title -> Enter the Deep.
  await expect(page.getByRole('option', { name: 'Enter the Deep' })).toBeVisible();
  await page.getByRole('option', { name: 'Enter the Deep' }).click();

  // Step 1 (Identity): name + portrait.
  await expect(page.getByLabel(/Step 1 of 8/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Name' }).fill('Testa');
  await page.getByRole('listbox', { name: 'Portrait' }).getByRole('option').nth(1).click();
  await page.getByRole('button', { name: /NEXT/ }).click();

  // Step 2 (Calling): the Lamplighter.
  await expect(page.getByLabel(/Step 2 of 8/)).toBeVisible();
  await page.getByRole('option', { name: /Lamplighter/ }).click();
  await page.getByRole('button', { name: /NEXT/ }).click();

  // Step 3 (Kit): the lantern kit.
  await expect(page.getByLabel(/Step 3 of 8/)).toBeVisible();
  await page.getByRole('option', { name: 'Lantern' }).click();
  await page.getByRole('button', { name: /NEXT/ }).click();

  // Step 4 (Attributes): choose Roll first, roll, then use the one-shot reroll...
  await expect(page.getByLabel(/Step 4 of 8/)).toBeVisible();
  await page.getByRole('option', { name: /ROLL 3D6/i }).click();
  await page.getByRole('button', { name: 'Roll attributes' }).click();
  await page.getByRole('button', { name: /REROLL ONCE/ }).click();
  await expect(page.getByRole('button', { name: /FORGIVENESS SPENT/ })).toBeDisabled();

  // ...then switch the method to point buy (inline within the same step, no navigation needed)
  // and allocate a legal block via the attribute stepper's +/- buttons.
  await page.getByRole('option', { name: /POINT-BUY/i }).click();
  await expect(page.getByText(/Budget remaining/)).toBeVisible();
  // Attribute order is [might, agility, vitality, wits, resolve], each with its own stepper row;
  // the third "+" button (index 2) raises Vitality. 12 clicks lands it at 12 (cost 14 of the 30
  // budget).
  const vitalityIncrement = page.getByRole('button', { name: '+', exact: true }).nth(2);
  for (let i = 0; i < 12; i += 1) await vitalityIncrement.click();
  await expect(page.getByRole('region', { name: 'Derived stats' })).toContainText(/Max health\s*22/);
  await page.getByRole('button', { name: /NEXT/ }).click();

  // Step 5 (Origin): deep-miner background.
  await expect(page.getByLabel(/Step 5 of 8/)).toBeVisible();
  await page.getByRole('option', { name: 'Deep miner' }).click();
  await page.getByRole('button', { name: /NEXT/ }).click();

  // Step 6 (Traits): two traits.
  await expect(page.getByLabel(/Step 6 of 8/)).toBeVisible();
  await page.getByRole('option', { name: 'Keen-eyed' }).click();
  await page.getByRole('option', { name: 'Sure-footed' }).click();
  await page.getByRole('button', { name: /NEXT/ }).click();

  // Step 7 (Mode): keep the default Classic.
  await expect(page.getByLabel(/Step 7 of 8/)).toBeVisible();
  await page.getByRole('button', { name: /NEXT/ }).click();

  // Step 8 (Review): weave the hero, confirm through THE LOOM ACCEPTS, and enter play.
  await expect(page.getByLabel(/Step 8 of 8/)).toBeVisible();
  await page.getByRole('button', { name: 'WEAVE ▸', exact: true }).click();
  await page.getByRole('button', { name: /DESCEND/ }).click();

  // The Lamplighter's loadout: 22 HP derived from the allocated Vitality lives in the ActionBar's
  // life-thread gauge (`Gauge.tsx`'s `aria-label`, e.g. "Life-thread: 22 of 22"); the brass lantern
  // equipped in the off-hand lives in the Hero Record overlay (`c`) -- both replace the retired
  // always-on hero panel, which the full-bleed HUD has no equivalent of.
  await expect(dungeonCanvas(page)).toBeVisible();
  await expect(page.getByTestId('gauge-hp')).toHaveAttribute(
    'aria-label',
    /^Life-thread: 22 of 22$/,
  );
  await page.keyboard.press('c');
  const heroRecord = page.getByTestId('overlay-character-sheet');
  await expect(heroRecord).toBeVisible();
  await expect(heroRecord).toContainText('off-hand');
  // The identification pillar presents the unidentified name at run start: the brass lantern the
  // kit equips reads as "Wavering lamp" until identified.
  await expect(heroRecord).toContainText('Wavering lamp');
  await page.keyboard.press('Escape');
  await expect(heroRecord).toBeHidden();
});

test('a death finalizes into the Hall and the conclusion closes the loop', async ({ page }) => {
  await page.goto(QUICKSTART_QUERY);
  await expect(dungeonCanvas(page)).toBeVisible();
  await awaitKeyboardReady(page);

  // Descend from town, march to the cave-rat pair and kill one, then wait beside the survivor
  // until it kills the hero.
  await pressAll(page, DESCEND_PREFIX);
  await page.keyboard.press('>');
  await expect(topBarLocation(page)).toContainText(/depth 1/i);
  await pressAll(page, CLUSTER_KILL);
  await expect(page.getByRole('log', { name: /adventure log/i })).toContainText(/dies/i);

  // The armoured hero shrugs off most of the survivor's swings, so death takes many waits (86 for
  // this pinned seed). We poll with an immediate `isVisible()` rather than a per-iteration timeout
  // so the loop stays fast; the cap is a generous guard, not pinned test data.
  // A Classic death first raises the DeathOverlay ("THE DEEP TAKES YOU") over the playfield; the
  // run is already finalized at that point, and Enter acknowledges it into the conclusion screen.
  const deathOverlay = page.getByRole('alertdialog', { name: /the deep takes you/i });
  let dead = false;
  for (let i = 0; i < 200 && !dead; i += 1) {
    await page.keyboard.press('.');
    dead = await deathOverlay.isVisible();
  }
  await expect(deathOverlay).toBeVisible();
  await page.keyboard.press('Enter');
  const fallen = page.getByRole('heading', { name: /you have fallen/i });
  await expect(fallen).toBeVisible();

  // Conclusion: the rat is named as the killer, the itemized score is present, and the run is
  // marked unverified/session-only (its finalization into the Hall already ran automatically).
  await expect(page.getByText(/Slain by Cave rat/i)).toBeVisible();
  const scoreTable = page.getByRole('table', { name: 'Score' });
  await expect(scoreTable).toBeVisible();
  await expect(scoreTable.getByText('Total')).toBeVisible();
  await expect(scoreTable.locator('tbody tr').first()).toBeVisible();
  await expect(page.getByRole('note')).toContainText(/unverified/i);

  // View the Hall: the just-finalized run is the first record, tagged "Run #1".
  await page.getByRole('option', { name: 'Hall of Records' }).click();
  await expect(page.getByRole('heading', { name: 'Hall of Records' })).toBeVisible();
  const record = page.getByRole('listbox', { name: 'Hall records' }).getByRole('option');
  await expect(record).toBeVisible();
  await expect(record).toContainText('Run #1');

  // Back to the conclusion, then start a new hero — which lands back at chargen step 1.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: /you have fallen/i })).toBeVisible();
  await page.getByRole('option', { name: 'New Hero' }).click();
  await expect(page.getByLabel(/Step 1 of 8/)).toBeVisible();

  // Regression: New Hero -> console -> WEAVE must start the NEW hero fresh, not restore the
  // just-finalized dead run (whose non-null conclusion would otherwise bounce straight back to
  // this same conclusion screen forever). Complete a minimal run-through (Identity -> Calling ->
  // Kit -> Attributes -> Origin -> Traits -> Mode -> Review) and arrive in the dungeon at Turn 0
  // with the new hero's name visible.
  await page.getByRole('textbox', { name: 'Name' }).fill('Nova');
  await page.getByRole('button', { name: /NEXT/ }).click();

  await page.getByRole('option', { name: /Wayfarer/ }).click();
  await page.getByRole('button', { name: /NEXT/ }).click();

  await page.getByRole('listbox', { name: 'Kit' }).getByRole('option').first().click();
  await page.getByRole('button', { name: /NEXT/ }).click();

  await page.getByRole('option', { name: /ROLL 3D6/i }).click();
  await page.getByRole('button', { name: 'Roll attributes' }).click();
  await page.getByRole('button', { name: /NEXT/ }).click();

  await page.getByRole('option', { name: 'Caravan guard' }).click();
  await page.getByRole('button', { name: /NEXT/ }).click();

  await page.getByRole('button', { name: /NEXT/ }).click(); // Traits (none) -> Mode
  await page.getByRole('button', { name: /NEXT/ }).click(); // Mode (Classic) -> Review

  await expect(page.getByLabel(/Step 8 of 8/)).toBeVisible();
  await page.getByRole('button', { name: 'WEAVE ▸', exact: true }).click();
  await page.getByRole('button', { name: /DESCEND/ }).click();

  await expect(dungeonCanvas(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: /you have fallen/i })).not.toBeVisible();
  await page.keyboard.press('c');
  const heroRecord = page.getByTestId('overlay-character-sheet');
  await expect(heroRecord).toBeVisible();
  await expect(heroRecord).toContainText('Nova');
  await page.keyboard.press('Escape');
  await expect(heroRecord).toBeHidden();
  await expect(page.getByTestId('turn-count')).toHaveText('Turn 0');
});
