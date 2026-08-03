import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MonsterContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

// The spec's designated depth-12 anchor is the ashwrought elite (NOT monster.ashen-warden,
// which is a lower-threat depth-5-12 guardian). Curated representative ramp, one step per
// difficulty tier from depth 12 to the depth-20 boss.
const RAMP_ANCHORS = [
  'monster.ashen-juggernaut',
  'monster.bound-shackled',
  'monster.bound-warden',
  'monster.echo-colossus',
  'monster.echo-sovereign',
  'monster.weakened-heart',
] as const;

const NEW_MONSTERS = [
  'monster.bound-wretch',
  'monster.bound-shackled',
  'monster.bound-warden',
  'monster.bound-hexbound',
  'monster.echo-breaker',
  'monster.echo-colossus',
  'monster.echo-harrower',
  'monster.echo-sovereign',
] as const;

describe('deep-dungeon difficulty ramp', () => {
  it('is monotonic in health and threat across the ramp anchors 12 -> 20', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const anchors = RAMP_ANCHORS.map((id) => byId.get(id) as MonsterContentEntry);
    anchors.forEach((monster, index) => expect(monster, RAMP_ANCHORS[index]).toBeDefined());
    for (let index = 1; index < anchors.length; index += 1) {
      expect(anchors[index]!.health).toBeGreaterThanOrEqual(anchors[index - 1]!.health);
      expect(anchors[index]!.threat).toBeGreaterThanOrEqual(anchors[index - 1]!.threat);
    }
  });

  it('keeps every new non-boss monster under the depth-20 weakened heart', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const boss = byId.get('monster.weakened-heart') as MonsterContentEntry;
    expect(boss.health).toBe(176);
    expect(boss.threat).toBe(20);
    for (const id of NEW_MONSTERS) {
      const monster = byId.get(id) as MonsterContentEntry;
      expect(monster, id).toBeDefined();
      expect(monster.health, id).toBeLessThan(boss.health);
      expect(monster.threat, id).toBeLessThan(boss.threat);
    }
  });
});
