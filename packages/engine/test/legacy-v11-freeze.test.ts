import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { legacyEventV11, legacyRecordedV11 } from '../src/save-schema/migrations.js';

/**
 * The v10-v12 legacy save schemas build their command/result/event unions from the LIVE unions
 * (`legacyEventV11` spreads the live `eventOptions`; `legacyRecordedV11` embeds the live `command`
 * and `processedResult`), so their "frozen" claim holds only while every live change stays additive
 * (new variants old saves never contain). This suite is the tripwire (#186): it pins the JSON-Schema
 * shape of every variant those unions had when the fixture was generated. A NEW variant added later
 * is fine and ignored; a change to a PINNED variant (a required field, a type change, a removal)
 * would break real v10-v12 saves at decode time and fails here — at that point, spell the affected
 * v11 union out as a true frozen literal (the `legacyActiveRunV14Schema` pattern) instead of
 * re-pinning.
 *
 * Regenerate after such a conscious freeze with:
 *   REPIN_LEGACY_V11_SHAPES=1 npm run test --workspace @woven-deep/engine -- --run test/legacy-v11-freeze.test.ts
 */

const FIXTURE_PATH = resolve(import.meta.dirname, 'fixtures/legacy-v11-union-shapes.json');

interface DiscriminatedUnionLike {
  readonly options: readonly z.ZodType[];
}

function variantShapes(
  union: DiscriminatedUnionLike,
  discriminator: string,
): Record<string, unknown> {
  const shapes: Record<string, unknown> = {};
  for (const option of union.options) {
    const schema = z.toJSONSchema(option, { unrepresentable: 'any', io: 'input' }) as {
      $schema?: string;
      properties?: Record<string, { const?: unknown; enum?: unknown[] }>;
    };
    delete schema.$schema;
    // One option can cover several discriminator values (`z.enum(['lock.picked', ...])`); pin the
    // shared shape under each value so a value later split out or reshaped still trips the wire.
    const literal = schema.properties?.[discriminator]?.const;
    const values =
      typeof literal === 'string' ? [literal] : (schema.properties?.[discriminator]?.enum ?? []);
    if (values.length === 0 || values.some((value) => typeof value !== 'string')) {
      throw new Error(`union option carries no string '${discriminator}' literal(s)`);
    }
    for (const value of values as string[]) {
      shapes[value] = schema;
    }
  }
  return shapes;
}

function currentShapes(): Record<string, Record<string, unknown>> {
  const recorded = legacyRecordedV11.shape;
  return {
    events: variantShapes(legacyEventV11 as unknown as DiscriminatedUnionLike, 'type'),
    commands: variantShapes(recorded.command as unknown as DiscriminatedUnionLike, 'type'),
    results: variantShapes(recorded.result as unknown as DiscriminatedUnionLike, 'status'),
  };
}

describe('legacy v10-v12 union freeze tripwire (#186)', () => {
  it('every variant a real v10-v12 save may contain still validates against its pinned shape', () => {
    const current = currentShapes();

    if (process.env.REPIN_LEGACY_V11_SHAPES === '1') {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(current, null, 2)}\n`);
    }
    expect(
      existsSync(FIXTURE_PATH),
      'fixture missing — generate it with REPIN_LEGACY_V11_SHAPES=1',
    ).toBe(true);

    const pinned = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<
      string,
      Record<string, unknown>
    >;

    for (const [group, variants] of Object.entries(pinned)) {
      for (const [variant, shape] of Object.entries(variants)) {
        expect(
          current[group]?.[variant],
          `${group}.${variant} drifted from its pinned v11 shape. This variant is reachable from ` +
            `the "frozen" legacy v10-v12 save schemas, so this change would break real v10-v12 ` +
            `saves at decode time. Spell the affected v11 union out as a true frozen literal ` +
            `(see the legacyActiveRunV14Schema pattern) before re-pinning.`,
        ).toEqual(shape);
      }
    }
  });
});
