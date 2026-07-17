import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativeLuminance, visibleForeground } from '../src/ui/cell-color.js';

// jsdom (our test environment) never evaluates @media queries, so we cannot assert the
// reduced-motion behaviour by rendering and reading computed styles. Instead this is a static,
// lint-style contract on the stylesheet text: the reduced-motion override for `.glow` must carry
// `!important`, because `.glow[data-source*="torch"]` has higher specificity (0,2,0) than a bare
// `.glow` override (0,1,0) and would otherwise keep the torch flicker animating even when the
// user has asked to reduce motion.
const testDir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(testDir, '../src/styles.css'), 'utf8');
const landingCss = readFileSync(join(testDir, '../src/landing/landing.css'), 'utf8');

/** Brace-depth scan from the first `{` after `marker` to its matching `}`, returning everything in
 * between (inclusive of the braces). Shared by `extractReducedMotionBlocks` (marker = the media
 * query opener) and the `.motion-reduced` class-block contract below (marker = the class
 * selector) -- both are "a rule opener, then nested sub-rules" shapes. */
function extractBlocksAfterMarker(source: string, marker: string): readonly string[] {
  const blocks: string[] = [];
  let searchFrom = 0;
  for (;;) {
    const start = source.indexOf(marker, searchFrom);
    if (start === -1) break;
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    let end = braceStart;
    for (let index = braceStart; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) { end = index; break; }
      }
    }
    blocks.push(source.slice(braceStart, end + 1));
    searchFrom = end + 1;
  }
  return blocks;
}

function extractReducedMotionBlocks(source: string): readonly string[] {
  return extractBlocksAfterMarker(source, '@media (prefers-reduced-motion: reduce)');
}

describe('reduced-motion stylesheet contract', () => {
  it('overrides .glow animation with !important so it beats higher-specificity glow variants', () => {
    const blocks = extractReducedMotionBlocks(css);
    const blockWithGlowOverride = blocks.find((block) => /\.glow\s*\{[^}]*animation\s*:/.test(block));
    expect(blockWithGlowOverride, 'expected a @media (prefers-reduced-motion: reduce) block with a .glow animation override').toBeTruthy();
    const glowRuleMatch = /\.glow\s*\{([^}]*)\}/.exec(blockWithGlowOverride!);
    expect(glowRuleMatch, '.glow rule not found inside reduced-motion block').toBeTruthy();
    expect(glowRuleMatch![1]).toMatch(/animation\s*:\s*none\s*!important/);
  });

  it('overrides .effect animation with !important so decorative effects stop under reduced motion', () => {
    const blocks = extractReducedMotionBlocks(css);
    const blockWithEffectOverride = blocks.find((block) => /\.effect\s*\{[^}]*animation\s*:/.test(block));
    expect(blockWithEffectOverride, 'expected a @media (prefers-reduced-motion: reduce) block with an .effect animation override').toBeTruthy();
    const effectRuleMatch = /\.effect\s*\{([^}]*)\}/.exec(blockWithEffectOverride!);
    expect(effectRuleMatch, '.effect rule not found inside reduced-motion block').toBeTruthy();
    expect(effectRuleMatch![1]).toMatch(/animation\s*:\s*none\s*!important/);
  });

  it('clips .playfield with overflow: hidden so the carried-light glow cannot bleed past the map pane', () => {
    const playfieldRuleMatch = /\.playfield\s*\{([^}]*)\}/.exec(css);
    expect(playfieldRuleMatch, '.playfield rule not found in stylesheet').toBeTruthy();
    expect(playfieldRuleMatch![1]).toMatch(/overflow\s*:\s*hidden/);
  });

  it('sizes the .glow box off a single axis (--cell-h) so it is square and the radial gradient forms a true circle with no hard rim', () => {
    const glowRuleMatch = /(?:^|\n)\.glow\s*\{([^}]*)\}/.exec(css);
    expect(glowRuleMatch, '.glow rule not found in stylesheet').toBeTruthy();
    const declarations: string = glowRuleMatch![1]!;
    const widthMatch = /(?:^|;)\s*width\s*:\s*([^;]+);/.exec(declarations);
    const heightMatch = /(?:^|;)\s*height\s*:\s*([^;]+);/.exec(declarations);
    expect(widthMatch, '.glow width declaration not found').toBeTruthy();
    expect(heightMatch, '.glow height declaration not found').toBeTruthy();
    expect(widthMatch![1]!.trim()).toBe(heightMatch![1]!.trim());
    expect(declarations).toMatch(/closest-side/);
  });

  it('never lets a visible cell render darker than a remembered one, even at minimum light', () => {
    // Regression for the "dark circle" bug: `.cell-visible`'s opacity floor (its value at
    // `--light: 0`) must be >= `.cell-remembered`'s (static) opacity, so a dim-but-visible cell at
    // the edge of a torch's radius never renders darker than the remembered floor beyond it.
    const rememberedMatch = /(?:^|\n)\.cell-remembered\s*\{([^}]*)\}/.exec(css);
    const visibleMatch = /(?:^|\n)\.cell-visible\s*\{([^}]*)\}/.exec(css);
    expect(rememberedMatch, '.cell-remembered rule not found').toBeTruthy();
    expect(visibleMatch, '.cell-visible rule not found').toBeTruthy();

    const rememberedOpacityMatch = /opacity\s*:\s*([\d.]+)/.exec(rememberedMatch![1]!);
    expect(rememberedOpacityMatch, '.cell-remembered has no explicit opacity').toBeTruthy();
    const rememberedOpacity = Number(rememberedOpacityMatch![1]);

    // `.cell-visible`'s opacity is `calc(FLOOR + SPAN * var(--light, 1))`; its minimum (at
    // `--light: 0`) is FLOOR.
    const visibleCalcMatch = /opacity\s*:\s*calc\(\s*([\d.]+)\s*\+\s*[\d.]+\s*\*\s*var\(--light/.exec(visibleMatch![1]!);
    expect(visibleCalcMatch, '.cell-visible opacity is not the expected calc(FLOOR + SPAN * var(--light)) shape').toBeTruthy();
    const visibleFloor = Number(visibleCalcMatch![1]);

    expect(visibleFloor).toBeGreaterThanOrEqual(rememberedOpacity);
  });

  it('scales font-size (not --cell-w/--cell-h) on .playfield with --zoom, so glyphs grow with the cell box instead of leaving whitespace at zoom', () => {
    // `.cell` inherits font-size from `.playfield`, and `1ch`/`1lh` are relative to the element
    // they're used on — so scaling font-size here (rather than multiplying --cell-w/--cell-h by
    // --zoom directly) grows both the rendered glyph AND the cell box in lockstep from one
    // number. Multiplying --cell-w/--cell-h by --zoom directly, on top of a font-size that is
    // ALSO scaled by --zoom, would double-scale the box relative to the glyph — this pins that it
    // is one or the other, never both.
    const playfieldRuleMatch = /(?:^|\n)\.playfield\s*\{([^}]*)\}/.exec(css);
    expect(playfieldRuleMatch, '.playfield rule not found').toBeTruthy();
    const playfieldDecls = playfieldRuleMatch![1]!;

    const fontSizeMatch = /font-size\s*:\s*([^;]+);/.exec(playfieldDecls);
    expect(fontSizeMatch, '.playfield has no font-size declaration').toBeTruthy();
    expect(fontSizeMatch![1]).toMatch(/var\(--zoom/);

    const cellWMatch = /--cell-w\s*:\s*([^;]+);/.exec(playfieldDecls);
    const cellHMatch = /--cell-h\s*:\s*([^;]+);/.exec(playfieldDecls);
    expect(cellWMatch, '.playfield has no --cell-w declaration').toBeTruthy();
    expect(cellHMatch, '.playfield has no --cell-h declaration').toBeTruthy();
    // --cell-w/--cell-h must be plain 1ch/1lh — NOT also multiplied by --zoom — since font-size
    // above already carries the zoom scale into these units.
    expect(cellWMatch![1]!.trim()).toBe('1ch');
    expect(cellHMatch![1]!.trim()).toBe('1lh');
    expect(cellWMatch![1]).not.toMatch(/var\(--zoom/);
    expect(cellHMatch![1]).not.toMatch(/var\(--zoom/);

    const gridRuleMatch = /(?:^|\n)\.playfield-grid\s*\{([^}]*)\}/.exec(css);
    expect(gridRuleMatch, '.playfield-grid rule not found').toBeTruthy();
    expect(gridRuleMatch![1]).toMatch(/grid-auto-rows\s*:\s*var\(--cell-h\)/);

    const probeRuleMatch = /(?:^|\n)\.cell-probe\s*\{([^}]*)\}/.exec(css);
    expect(probeRuleMatch, '.cell-probe rule not found').toBeTruthy();
    expect(probeRuleMatch![1]).toMatch(/width\s*:\s*var\(--cell-w\)/);
    expect(probeRuleMatch![1]).toMatch(/height\s*:\s*var\(--cell-h\)/);
  });

  it('gives .cell-probe-base a fixed base font-size (not tied to --zoom), so PlayScreen can measure the 1x cell size directly instead of dividing the zoomed probe by the applied zoom', () => {
    const probeBaseRuleMatch = /(?:^|\n)\.cell-probe-base\s*\{([^}]*)\}/.exec(css);
    expect(probeBaseRuleMatch, '.cell-probe-base rule not found').toBeTruthy();
    const decls = probeBaseRuleMatch![1]!;
    expect(decls).toMatch(/font-size\s*:\s*1rem/);
    expect(decls).not.toMatch(/var\(--zoom/);
    expect(decls).toMatch(/width\s*:\s*1ch/);
    expect(decls).toMatch(/height\s*:\s*1lh/);
  });

  it('centers .glow with a standalone translate property so keyframes can animate scale/opacity without overwriting it', () => {
    const glowRuleMatch = /(?:^|\n)\.glow\s*\{([^}]*)\}/.exec(css);
    expect(glowRuleMatch, '.glow rule not found in stylesheet').toBeTruthy();
    expect(glowRuleMatch![1]).toMatch(/(?:^|[;\n])\s*translate\s*:\s*-50%\s+-50%/);
    expect(glowRuleMatch![1]).not.toMatch(/transform\s*:\s*translate/);

    const keyframesMatch = /@keyframes\s+glow-drift\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(keyframesMatch, '@keyframes glow-drift not found').toBeTruthy();
    expect(keyframesMatch![1]).not.toMatch(/transform\s*:/);
  });

  it('duplicates the reduced-motion overrides under an explicit .motion-reduced root class (set when the "Reduce motion" setting is "on", independent of the OS media query), with the same !important discipline', () => {
    // `.motion-reduced` is a single class-selector block (not a media query), but the sub-rules
    // inside it are found the same way -- reuse the media block's own brace-depth scan.
    const blocks = extractBlocksAfterMarker(css, '.motion-reduced {');
    expect(blocks.length, 'expected a top-level .motion-reduced { ... } block').toBeGreaterThan(0);
    const block = blocks[0]!;

    const glowRuleMatch = /\.glow\s*\{([^}]*)\}/.exec(block);
    expect(glowRuleMatch, '.glow rule not found inside .motion-reduced').toBeTruthy();
    expect(glowRuleMatch![1]).toMatch(/animation\s*:\s*none\s*!important/);

    const effectRuleMatch = /\.effect\s*\{([^}]*)\}/.exec(block);
    expect(effectRuleMatch, '.effect rule not found inside .motion-reduced').toBeTruthy();
    expect(effectRuleMatch![1]).toMatch(/animation\s*:\s*none\s*!important/);
  });

  it('re-enables the glow/effect animations under an explicit .motion-full root class (set when "Reduce motion" is "off"), matching the ORIGINAL declared durations with !important -- the mirror-image of .motion-reduced', () => {
    // The original (un-overridden) declarations, parsed straight out of the stylesheet -- never
    // copied literals, so this test can't drift out of sync with the real animation values.
    const glowRuleMatch = /(?:^|\n)\.glow\s*\{([^}]*)\}/.exec(css);
    expect(glowRuleMatch, '.glow rule not found in stylesheet').toBeTruthy();
    const originalGlowAnimation = /animation\s*:\s*([^;]+);/.exec(glowRuleMatch![1]!);
    expect(originalGlowAnimation, '.glow has no animation declaration').toBeTruthy();

    const torchGlowRuleMatch = /\.glow\[data-source\*="torch"\]\s*\{([^}]*)\}/.exec(css);
    expect(torchGlowRuleMatch, '.glow[data-source*="torch"] rule not found in stylesheet').toBeTruthy();
    const originalTorchAnimation = /animation\s*:\s*([^;]+);/.exec(torchGlowRuleMatch![1]!);
    expect(originalTorchAnimation, '.glow[data-source*="torch"] has no animation declaration').toBeTruthy();

    const hitFlashRuleMatch = /(?:^|\n)\.effect-hit-flash\s*\{([^}]*)\}/.exec(css);
    const attackStreakRuleMatch = /(?:^|\n)\.effect-attack-streak\s*\{([^}]*)\}/.exec(css);
    const deathBurstRuleMatch = /(?:^|\n)\.effect-death-burst\s*\{([^}]*)\}/.exec(css);
    expect(hitFlashRuleMatch, '.effect-hit-flash rule not found').toBeTruthy();
    expect(attackStreakRuleMatch, '.effect-attack-streak rule not found').toBeTruthy();
    expect(deathBurstRuleMatch, '.effect-death-burst rule not found').toBeTruthy();
    const originalHitFlash = /animation\s*:\s*([^;]+);/.exec(hitFlashRuleMatch![1]!);
    const originalAttackStreak = /animation\s*:\s*([^;]+);/.exec(attackStreakRuleMatch![1]!);
    const originalDeathBurst = /animation\s*:\s*([^;]+);/.exec(deathBurstRuleMatch![1]!);
    expect(originalHitFlash, '.effect-hit-flash has no animation declaration').toBeTruthy();
    expect(originalAttackStreak, '.effect-attack-streak has no animation declaration').toBeTruthy();
    expect(originalDeathBurst, '.effect-death-burst has no animation declaration').toBeTruthy();

    const blocks = extractBlocksAfterMarker(css, '.motion-full {');
    expect(blocks.length, 'expected a top-level .motion-full { ... } block').toBeGreaterThan(0);
    const block = blocks[0]!;

    const fullGlowMatch = /(?:^|\n)\s*\.glow\s*\{([^}]*)\}/.exec(block);
    expect(fullGlowMatch, '.glow rule not found inside .motion-full').toBeTruthy();
    expect(fullGlowMatch![1]).toMatch(/animation\s*:/);
    expect(fullGlowMatch![1]).toMatch(/!important/);

    const fullTorchGlowMatch = /\.glow\[data-source\*="torch"\]\s*\{([^}]*)\}/.exec(block);
    expect(fullTorchGlowMatch, '.glow[data-source*="torch"] rule not found inside .motion-full').toBeTruthy();
    expect(fullTorchGlowMatch![1]).toMatch(/!important/);

    const fullHitFlashMatch = /\.effect-hit-flash\s*\{([^}]*)\}/.exec(block);
    const fullAttackStreakMatch = /\.effect-attack-streak\s*\{([^}]*)\}/.exec(block);
    const fullDeathBurstMatch = /\.effect-death-burst\s*\{([^}]*)\}/.exec(block);
    expect(fullHitFlashMatch, '.effect-hit-flash rule not found inside .motion-full').toBeTruthy();
    expect(fullAttackStreakMatch, '.effect-attack-streak rule not found inside .motion-full').toBeTruthy();
    expect(fullDeathBurstMatch, '.effect-death-burst rule not found inside .motion-full').toBeTruthy();

    // Extract just the duration token (e.g. "2.6s"/"120ms") out of each `animation` shorthand and
    // compare the ORIGINAL to the restored .motion-full value -- proves the restored declaration
    // isn't just present, but actually matches the original timing.
    function duration(declBlock: string): string {
      const match = /animation\s*:\s*[\w-]+\s+([\d.]+m?s)/.exec(declBlock);
      expect(match, `no animation duration found in: ${declBlock}`).toBeTruthy();
      return match![1]!;
    }

    expect(duration(fullGlowMatch![1]!)).toBe(duration(originalGlowAnimation![0]!));
    expect(duration(fullTorchGlowMatch![1]!)).toBe(duration(originalTorchAnimation![0]!));
    expect(duration(fullHitFlashMatch![1]!)).toBe(duration(originalHitFlash![0]!));
    expect(duration(fullAttackStreakMatch![1]!)).toBe(duration(originalAttackStreak![0]!));
    expect(duration(fullDeathBurstMatch![1]!)).toBe(duration(originalDeathBurst![0]!));
  });
});

/** Parses a `#rrggbb`/`#rgb` literal into an `[r, g, b]` triple (0..255 each). */
function hexToRgb(hex: string): readonly [number, number, number] {
  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const match = /^#([0-9a-fA-F]{6})$/.exec(normalized);
  if (!match) throw new Error(`not a hex color: ${hex}`);
  const value = match[1]!;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/** Reads a `--name: #hex;` declaration's hex value out of the real `:root { ... }` block. */
function rootVariable(name: string): string {
  const rootMatch = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  expect(rootMatch, ':root block not found').toBeTruthy();
  const decl = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\s*;`).exec(rootMatch![1]!);
  expect(decl, `--${name} not declared in :root`).toBeTruthy();
  return decl![1]!;
}

const REMEMBERED_LUMINANCE = relativeLuminance(hexToRgb('#4b526b'));

describe('named palette stylesheet contract', () => {
  const NAMED_COLORS = [
    'ink', 'ground', 'gold', 'gold-bright', 'line', 'muted', 'alert', 'panel',
    'remembered', 'void-bg', 'portrait-default',
  ] as const;
  const MATERIAL_COLORS = ['mat-wall', 'mat-floor', 'mat-door', 'mat-stair', 'mat-void'] as const;

  it('declares every named palette variable in :root with a valid hex value', () => {
    for (const name of [...NAMED_COLORS, ...MATERIAL_COLORS]) {
      expect(() => hexToRgb(rootVariable(name)), `--${name}`).not.toThrow();
    }
  });

  it('leaves no raw hex literal for a recurring named color outside its own :root declaration', () => {
    // Every rule that used to spell out one of these hex literals directly must now reference the
    // variable instead -- the literal itself should appear exactly once in the whole file (the
    // :root declaration line), never again as a copy-pasted value elsewhere. Swept over EVERY named
    // color (including the material palette) -- not just the original 8 -- so a re-introduced
    // copy-pasted literal for `--remembered`/`--void-bg`/`--portrait-default`/`--mat-*` fails this
    // just as loudly as one of the original set would.
    for (const name of [...NAMED_COLORS, ...MATERIAL_COLORS]) {
      const hex = rootVariable(name);
      const occurrences = css.split(hex).length - 1;
      expect(occurrences, `--${name} (${hex}) should only appear once, in :root`).toBe(1);
    }
  });

  it('holds the visible-vs-remembered luminance floor for every material color, at the darkest visible intensity', () => {
    // Reuses the same floor guarantee `cell-color.test.ts` asserts in isolation, but sourced from
    // the REAL CSS hex values (not a copy) -- a regression here means styles.css and cell-color.ts
    // have drifted apart, or a material's base color itself broke the floor.
    for (const name of MATERIAL_COLORS) {
      const base = hexToRgb(rootVariable(name));
      const nearBlackTint: readonly [number, number, number] = [4, 3, 2];
      const output = visibleForeground(nearBlackTint, 1, base);
      const [r, g, b] = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(output)!.slice(1).map(Number) as [number, number, number];
      expect(relativeLuminance([r, g, b]), `${name} at minimum visible intensity`).toBeGreaterThan(REMEMBERED_LUMINANCE);
    }
  });

  it('composites the town tint into .playfield-grid\'s OWN background, not onto .playfield', () => {
    // `.playfield-grid` paints an opaque `background: var(--void-bg)` and is a child of
    // `.playfield` that covers essentially the same box -- a tint painted as a `background` on
    // `.playfield` itself is fully occluded by its child and never actually renders (jsdom can't
    // catch this via paint order, since it doesn't paint at all, so this test parses the real rule
    // shape instead: the tint must live on a `.playfield-town .playfield-grid` rule, mixed
    // straight into the grid's own background, not on a bare `.playfield-town` rule).
    expect(css, 'a bare `.playfield-town { background: ... }` rule is occluded by .playfield-grid and must not exist')
      .not.toMatch(/\.playfield-town\s*\{[^}]*background/);

    const townGridRuleMatch = /\.playfield-town\s+\.playfield-grid\s*\{([^}]*)\}/.exec(css);
    expect(townGridRuleMatch, 'expected a `.playfield-town .playfield-grid { ... }` rule').toBeTruthy();
    const decls = townGridRuleMatch![1]!;
    expect(decls, 'the town tint must be pre-mixed into the grid\'s own background via color-mix').toMatch(
      /background\s*:\s*color-mix\(in srgb,\s*var\(--gold\)\s*4%,\s*var\(--void-bg\)\)/,
    );
  });
});

describe('landing page reduced-motion stylesheet contract', () => {
  const blocks = extractReducedMotionBlocks(landingCss);

  it('has at least one @media (prefers-reduced-motion: reduce) block', () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('kills every landing animation and transition with !important, beating any per-element rule', () => {
    const blockWithGlobalKill = blocks.find((block) => /\*[^{}]*\{[^}]*animation\s*:\s*none\s*!important/.test(block));
    expect(blockWithGlobalKill, 'expected a reduced-motion block that forces animation:none !important on all landing elements').toBeTruthy();
    expect(blockWithGlobalKill!).toMatch(/transition\s*:\s*none\s*!important/);
  });

  it('forces [data-reveal] elements fully visible with !important, so a missed reveal can never hide content', () => {
    const blockWithRevealOverride = blocks.find((block) => /\[data-reveal\]\s*\{[^}]*opacity\s*:/.test(block));
    expect(blockWithRevealOverride, 'expected a reduced-motion block overriding [data-reveal] visibility').toBeTruthy();
    const revealRuleMatch = /\[data-reveal\]\s*\{([^}]*)\}/.exec(blockWithRevealOverride!);
    expect(revealRuleMatch, '[data-reveal] rule not found inside reduced-motion block').toBeTruthy();
    expect(revealRuleMatch![1]).toMatch(/opacity\s*:\s*1\s*!important/);
    expect(revealRuleMatch![1]).toMatch(/transform\s*:\s*none\s*!important/);
  });
});
