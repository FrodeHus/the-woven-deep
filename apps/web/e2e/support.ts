import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared helpers for reconciling the e2e suite with the Pixi playfield + full-bleed HUD (the
 * DOM-grid `role="grid"` playfield and the `StatusBar`/right-rail/`HintStrip` panels it replaced).
 * Every spec file used to read those DOM fixtures directly; this module centralizes their
 * canvas/overlay-based replacements so each spec's own walk/derivation stays the star of the file.
 */

/** The playfield is now a single Pixi canvas exposed as `role="img"` (see `PlayfieldCanvas.tsx`'s
 * `aria-label="Isometric view of the dungeon floor"`) rather than a per-cell `role="grid"`. Every
 * spec that used to assert `getByRole('grid', { name: /dungeon/i })` asserts this instead -- same
 * "the playfield is up" intent, just the new accessible role. */
export function dungeonCanvas(page: Page): Locator {
  return page.getByRole('img', { name: /dungeon/i });
}

/** The retired `StatusBar`'s `role="group" name="Status"` became `TopBar`'s plain
 * `data-testid="top-bar-location"` span (see `TopBar.tsx`) -- same "Town" text, but the dungeon
 * form is now the design's uppercase `DEPTH N` rather than title-case `Depth N`, so callers match
 * case-insensitively. */
export function topBarLocation(page: Page): Locator {
  return page.getByTestId('top-bar-location');
}

/**
 * The retired DOM grid rendered the hero's cell as its own labelled element
 * (`aria-label="Hero at X, Y"`) directly in the playfield; the Pixi canvas draws the hero as a
 * sprite with no per-cell DOM at all. The one surviving place that same label still exists is the
 * Map & Journal overlay's map pane (`MapJournalOverlay.tsx`'s `MapPane`, which renders the FULL
 * floor as a real DOM grid for the journal). Opening it briefly to read the hero's cell is the
 * nearest honest equivalent left to "read the hero's exact world position" -- opening/closing an
 * overlay is client-side UI state, never an engine command, so it can never desync a pinned walk.
 */
export async function heroCellLabel(page: Page): Promise<string> {
  const overlay = page.getByTestId('overlay-map-journal');
  const alreadyOpen = await overlay.isVisible().catch(() => false);
  if (!alreadyOpen) {
    // Mirrors every spec's own `awaitKeyboardReady`: the very first keydown after load (or right
    // after a previous overlay's Escape) can race the global key listener attaching, so retry the
    // press rather than pinning a wait.
    await expect(async () => {
      await page.keyboard.press('m');
      await expect(overlay).toBeVisible({ timeout: 250 });
    }).toPass();
  }
  const label = await overlay.getByLabel(/^Hero at \d+, \d+$/).getAttribute('aria-label');
  if (!alreadyOpen) {
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  }
  if (label === null) throw new Error('hero cell label missing from the map pane');
  return label;
}

/** Asserts the hero is at exactly `(x, y)` via `heroCellLabel` above. */
export async function expectHeroAt(page: Page, x: number, y: number): Promise<void> {
  expect(await heroCellLabel(page)).toBe(`Hero at ${x}, ${y}`);
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Mirrors `iso-math.ts`'s `worldToScreen` (zoom pinned at 1, per `IsoRenderer`'s own `ZOOM`
 * constant) so a test can point the mouse at a specific WORLD cell on the canvas without touching
 * renderer internals. `camera` is the world cell the camera is centered on -- in practice the
 * hero's own cell, since the camera eases toward the hero and settles there once the hero stops
 * moving (every hover below happens well after the hero's last move in its spec).
 */
function isoScreenPoint(camera: Point, cell: Point, viewport: { width: number; height: number }): Point {
  const dx = cell.x - camera.x;
  const dy = cell.y - camera.y;
  return {
    x: (dx - dy) * 32 + viewport.width / 2,
    y: (dx + dy) * 16 + viewport.height / 2,
  };
}

/**
 * Hovers the canvas at the screen position of world cell `cell`, given the camera is settled on
 * `camera`. Replaces the retired DOM grid's `[data-cell="x,y"]` hover target -- there is no
 * per-cell DOM to hover anymore, only a canvas pixel position computed from the same iso projection
 * the renderer itself uses. Wrapped in `toPass` because the camera is still easing toward the hero
 * for a few animation frames after any move/resize; retrying the move a few times rides that out
 * rather than pinning a wait duration.
 */
export async function hoverWorldCell(page: Page, camera: Point, cell: Point): Promise<void> {
  const canvas = dungeonCanvas(page);
  await expect(async () => {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('dungeon canvas has no layout box yet');
    const point = isoScreenPoint(camera, cell, box);
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await expect(page.getByRole('tooltip')).toBeVisible({ timeout: 250 });
  }).toPass();
}
