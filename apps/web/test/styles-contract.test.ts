import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, relativeLuminance, visibleForeground } from '../src/ui/cell-color.js';

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
        if (depth === 0) {
          end = index;
          break;
        }
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
  it('never lets the screen-fade overlay block input, and declares its motion behavior in all four motion blocks', () => {
    const fadeRuleMatch = /(?:^|\n)\.screen-fade\s*\{([^}]*)\}/.exec(css);
    expect(fadeRuleMatch, '.screen-fade rule not found in stylesheet').toBeTruthy();
    const fadeDecls = fadeRuleMatch![1]!;
    expect(fadeDecls).toMatch(/pointer-events\s*:\s*none/);
    expect(fadeDecls).toMatch(/position\s*:\s*fixed/);

    const originalAnimationMatch = /animation\s*:\s*([^;]+);/.exec(fadeDecls);
    expect(originalAnimationMatch, '.screen-fade has no animation declaration').toBeTruthy();

    // The single @media (prefers-reduced-motion: reduce) block suppresses the fade.
    const reducedBlocks = extractReducedMotionBlocks(css);
    const mediaFadeBlock = reducedBlocks.find((block) =>
      /\.screen-fade\s*\{[^}]*animation\s*:\s*none\s*!important/.test(block),
    );
    expect(
      mediaFadeBlock,
      'expected a .screen-fade animation:none override in the reduced-motion media block',
    ).toBeTruthy();

    // .motion-reduced class block.
    const motionReducedBlocks = extractBlocksAfterMarker(css, '.motion-reduced {');
    expect(motionReducedBlocks[0]).toMatch(
      /\.screen-fade\s*\{[^}]*animation\s*:\s*none\s*!important/,
    );

    // .motion-full class block -- restored duration must match the original declaration.
    const motionFullBlocks = extractBlocksAfterMarker(css, '.motion-full {');
    const fullFadeMatch = /\.screen-fade\s*\{([^}]*)\}/.exec(motionFullBlocks[0]!);
    expect(fullFadeMatch, '.screen-fade rule not found inside .motion-full').toBeTruthy();
    expect(fullFadeMatch![1]).toMatch(/!important/);
    function fadeDuration(declBlock: string): string {
      const match = /animation\s*:\s*[\w-]+\s+([\d.]+m?s)/.exec(declBlock);
      expect(match, `no animation duration found in: ${declBlock}`).toBeTruthy();
      return match![1]!;
    }
    expect(fadeDuration(fullFadeMatch![1]!)).toBe(fadeDuration(originalAnimationMatch![0]!));
  });

  it('declares the overlay entrance (.wd-*) motions in all four motion blocks, suppressed under reduced motion and restored under .motion-full', () => {
    // The overlay entrances are pure CSS with no JS gate, so the reduced-motion media block is the
    // only thing honoring an OS-level preference for them; the explicit setting classes mirror it.
    const reducedBlocks = extractReducedMotionBlocks(css);
    const mediaWdBlock = reducedBlocks.find((block) =>
      /\.wd-slide-in[^{]*\{[^}]*animation\s*:\s*none\s*!important/.test(block),
    );
    expect(
      mediaWdBlock,
      'expected a .wd-* animation:none override in the reduced-motion media block',
    ).toBeTruthy();

    const motionReducedBlocks = extractBlocksAfterMarker(css, '.motion-reduced {');
    expect(motionReducedBlocks[0]).toMatch(
      /\.wd-slide-in[^{]*\{[^}]*animation\s*:\s*none\s*!important/,
    );

    // Every entrance is re-enabled with !important under .motion-full so it beats the suppression.
    const motionFullBlocks = extractBlocksAfterMarker(css, '.motion-full {');
    for (const entrance of ['wd-slide-in', 'wd-fade-in', 'wd-rise-in', 'wd-flicker']) {
      const match = new RegExp(`\\.${entrance}\\s*\\{([^}]*)\\}`).exec(motionFullBlocks[0]!);
      expect(match, `.${entrance} not found inside .motion-full`).toBeTruthy();
      expect(match![1]).toMatch(/animation\s*:[^}]*!important/);
    }
  });
});

/** Parses a `#rrggbb`/`#rgb` literal into an `[r, g, b]` triple (0..255 each). */
function hexToRgb(hex: string): readonly [number, number, number] {
  const normalized =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const match = /^#([0-9a-fA-F]{6})$/.exec(normalized);
  if (!match) throw new Error(`not a hex color: ${hex}`);
  const value = match[1]!;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
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
    'ink',
    'ground',
    'gold',
    'gold-bright',
    'line',
    'muted',
    'alert',
    'panel',
    'remembered',
    'void-bg',
    'portrait-default',
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
      const [r, g, b] = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(output)!.slice(1).map(Number) as [
        number,
        number,
        number,
      ];
      expect(relativeLuminance([r, g, b]), `${name} at minimum visible intensity`).toBeGreaterThan(
        REMEMBERED_LUMINANCE,
      );
    }
  });
});

/** Reads a `--name: #hex;` declaration's hex value out of an already-extracted block's inner text
 * (e.g. the `.theme-high-contrast { ... }` block body). */
function blockVariable(block: string, name: string): string {
  const decl = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\s*;`).exec(block);
  expect(decl, `--${name} not declared in this block`).toBeTruthy();
  return decl![1]!;
}

const AA_NORMAL_TEXT = 4.5;
const AA_LARGE_OR_GLYPH = 3;

describe('high-contrast theme stylesheet contract', () => {
  const ALL_PALETTE_COLORS = [
    'ink',
    'ground',
    'gold',
    'gold-bright',
    'line',
    'muted',
    'alert',
    'panel',
    'remembered',
    'void-bg',
    'portrait-default',
    'mat-wall',
    'mat-floor',
    'mat-door',
    'mat-stair',
    'mat-void',
  ] as const;

  function highContrastBlock(): string {
    const blocks = extractBlocksAfterMarker(css, '.theme-high-contrast {');
    expect(
      blocks.length,
      'expected a top-level .theme-high-contrast { ... } block',
    ).toBeGreaterThan(0);
    return blocks[0]!;
  }

  it('re-declares EVERY named palette variable under .theme-high-contrast', () => {
    const block = highContrastBlock();
    for (const name of ALL_PALETTE_COLORS) {
      expect(() => blockVariable(block, name), `--${name}`).not.toThrow();
    }
  });

  it('declares ONLY palette-variable custom properties in .theme-high-contrast -- no per-component overrides', () => {
    // The brief requires the theme block to be a pure palette re-declaration: every declaration
    // inside it must be one of the named `--*` custom properties, never a component selector's own
    // property (e.g. `.hero-panel { border-color: ... }` layered on top of the palette swap).
    const block = highContrastBlock();
    const declarationLines = block
      .replace(/^\s*\{/, '')
      .replace(/\}\s*$/, '')
      .split(';')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const line of declarationLines) {
      expect(line, `unexpected non-palette declaration in .theme-high-contrast: "${line}"`).toMatch(
        /^--(?:mat-)?[a-z-]+\s*:/,
      );
    }
  });

  function hc(name: string): readonly [number, number, number] {
    return hexToRgb(blockVariable(highContrastBlock(), name)) as unknown as readonly [
      number,
      number,
      number,
    ];
  }

  it('text on ground clears AA normal-text contrast (4.5:1)', () => {
    expect(contrastRatio(hc('ink'), hc('ground'))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('gold accents on panel clear AA large/glyph contrast (3:1)', () => {
    expect(contrastRatio(hc('gold'), hc('panel'))).toBeGreaterThanOrEqual(AA_LARGE_OR_GLYPH);
    expect(contrastRatio(hc('gold-bright'), hc('panel'))).toBeGreaterThanOrEqual(AA_LARGE_OR_GLYPH);
  });

  it('every material color clears AA glyph contrast (3:1) against the void background', () => {
    for (const material of ['mat-wall', 'mat-floor', 'mat-door', 'mat-stair'] as const) {
      expect(contrastRatio(hc(material), hc('void-bg')), material).toBeGreaterThanOrEqual(
        AA_LARGE_OR_GLYPH,
      );
      expect(contrastRatio(hc(material), hc('mat-void')), material).toBeGreaterThanOrEqual(
        AA_LARGE_OR_GLYPH,
      );
    }
  });

  it('every log tone clears AA normal-text contrast (4.5:1) against ground (the log panel background)', () => {
    expect(contrastRatio(hc('alert'), hc('ground'))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(hc('gold'), hc('ground'))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(hc('muted'), hc('ground'))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('remembered cells clear AA glyph contrast (3:1) against ground, and stay visibly dimmer than the ink used for visible text', () => {
    expect(contrastRatio(hc('remembered'), hc('ground'))).toBeGreaterThanOrEqual(AA_LARGE_OR_GLYPH);
    expect(relativeLuminance(hc('remembered'))).toBeLessThan(relativeLuminance(hc('ink')));
  });
});

describe('ornamental framing stylesheet contract', () => {
  function ruleBody(selector: string): string {
    const match = new RegExp(
      `(?:^|\\n)${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    ).exec(css);
    expect(match, `${selector} rule not found`).toBeTruthy();
    return match![1]!;
  }

  it('declares a --frame-* vocabulary in :root, with the corner color a REFERENCE to --gold (never a raw hex), so the high-contrast theme inherits it automatically', () => {
    const rootMatch = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(rootMatch, ':root block not found').toBeTruthy();
    const root = rootMatch![1]!;
    expect(root).toMatch(/--frame-corner\s*:\s*"[^"]+"/);
    expect(root).toMatch(/--frame-corner-color\s*:\s*var\(--gold\)/);
    expect(root).toMatch(/--frame-corner-size\s*:/);
    expect(root).toMatch(/--frame-inset\s*:/);
  });

  it('never re-declares a --frame-* variable inside .theme-high-contrast -- the frame inherits through the cascade, no theme-specific frame rule exists', () => {
    const blocks = extractBlocksAfterMarker(css, '.theme-high-contrast {');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]!).not.toMatch(/--frame-/);
  });

  it('gives .framed relative positioning and two corner pseudo-elements using the CSS alt-text syntax (content: ... / "") so the glyph never enters the accessibility tree', () => {
    expect(ruleBody('.framed')).toMatch(/position\s*:\s*relative/);
    const before = ruleBody('.framed::before,\n.framed::after');
    expect(before).toMatch(/content\s*:\s*var\(--frame-corner\)\s*\/\s*""/);
    expect(before).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('gives .framed-title a trailing ornament, also via the alt-text content syntax, consuming only frame/palette variables (no raw hex)', () => {
    const after = ruleBody('.framed-title::after');
    expect(after).toMatch(/content\s*:\s*var\(--frame-corner\)\s*\/\s*""/);
    expect(after).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe('landing page reduced-motion stylesheet contract', () => {
  const blocks = extractReducedMotionBlocks(landingCss);

  it('has at least one @media (prefers-reduced-motion: reduce) block', () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('kills every landing animation and transition with !important, beating any per-element rule', () => {
    const blockWithGlobalKill = blocks.find((block) =>
      /\*[^{}]*\{[^}]*animation\s*:\s*none\s*!important/.test(block),
    );
    expect(
      blockWithGlobalKill,
      'expected a reduced-motion block that forces animation:none !important on all landing elements',
    ).toBeTruthy();
    expect(blockWithGlobalKill!).toMatch(/transition\s*:\s*none\s*!important/);
  });

  it('forces [data-reveal] elements fully visible with !important, so a missed reveal can never hide content', () => {
    const blockWithRevealOverride = blocks.find((block) =>
      /\[data-reveal\]\s*\{[^}]*opacity\s*:/.test(block),
    );
    expect(
      blockWithRevealOverride,
      'expected a reduced-motion block overriding [data-reveal] visibility',
    ).toBeTruthy();
    const revealRuleMatch = /\[data-reveal\]\s*\{([^}]*)\}/.exec(blockWithRevealOverride!);
    expect(
      revealRuleMatch,
      '[data-reveal] rule not found inside reduced-motion block',
    ).toBeTruthy();
    expect(revealRuleMatch![1]).toMatch(/opacity\s*:\s*1\s*!important/);
    expect(revealRuleMatch![1]).toMatch(/transform\s*:\s*none\s*!important/);
  });
});

describe('colorblind reinforcement stylesheet contract (Task 9)', () => {
  it('gives each colored log tone a non-color leading glyph via a silent ::before', () => {
    for (const tone of ['combat', 'warning', 'system']) {
      const rule = new RegExp(`\\.log-line--${tone}::before\\s*\\{([^}]*)\\}`).exec(css);
      expect(rule, `expected a ::before glyph for .log-line--${tone}`).toBeTruthy();
      // CSS alt-text syntax `content: "..." / ""` keeps the glyph out of the accessibility tree.
      expect(rule![1]).toMatch(/content\s*:\s*"[^"]+"\s*\/\s*""/);
    }
  });

  it('gives each colored journal log tone the same silent reinforcement glyph', () => {
    for (const tone of ['combat', 'warning', 'system']) {
      const rule = new RegExp(`\\.journal-log-line--${tone}::before\\s*\\{([^}]*)\\}`).exec(css);
      expect(rule, `expected a ::before glyph for .journal-log-line--${tone}`).toBeTruthy();
      expect(rule![1]).toMatch(/content\s*:\s*"[^"]+"\s*\/\s*""/);
    }
  });

  it('defines an .sr-only visually-hidden utility for the hero-status live region', () => {
    const rule = /\.sr-only\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'expected an .sr-only utility class').toBeTruthy();
    expect(rule![1]).toMatch(/position\s*:\s*absolute/);
    expect(rule![1]).toMatch(/clip-path\s*:\s*inset\(50%\)/);
  });
});
