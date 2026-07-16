import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// jsdom (our test environment) never evaluates @media queries, so we cannot assert the
// reduced-motion behaviour by rendering and reading computed styles. Instead this is a static,
// lint-style contract on the stylesheet text: the reduced-motion override for `.glow` must carry
// `!important`, because `.glow[data-source*="torch"]` has higher specificity (0,2,0) than a bare
// `.glow` override (0,1,0) and would otherwise keep the torch flicker animating even when the
// user has asked to reduce motion.
const testDir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(testDir, '../src/styles.css'), 'utf8');
const landingCss = readFileSync(join(testDir, '../src/landing/landing.css'), 'utf8');

function extractReducedMotionBlocks(source: string): readonly string[] {
  const blocks: string[] = [];
  const marker = '@media (prefers-reduced-motion: reduce)';
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

  it('centers .glow with a standalone translate property so keyframes can animate scale/opacity without overwriting it', () => {
    const glowRuleMatch = /(?:^|\n)\.glow\s*\{([^}]*)\}/.exec(css);
    expect(glowRuleMatch, '.glow rule not found in stylesheet').toBeTruthy();
    expect(glowRuleMatch![1]).toMatch(/(?:^|[;\n])\s*translate\s*:\s*-50%\s+-50%/);
    expect(glowRuleMatch![1]).not.toMatch(/transform\s*:\s*translate/);

    const keyframesMatch = /@keyframes\s+glow-drift\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(keyframesMatch, '@keyframes glow-drift not found').toBeTruthy();
    expect(keyframesMatch![1]).not.toMatch(/transform\s*:/);
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
