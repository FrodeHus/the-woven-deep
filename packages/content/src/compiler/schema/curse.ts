import { z } from 'zod';
import { CURSE_TRIGGER_EFFECT_IDS, CURSE_TRIGGER_EVENTS } from '../../model/curse.js';
import { base, effect, negativeDerivedStatModifiers } from './common.js';

const curseTriggerEffect = effect.superRefine((value, context) => {
  if ((CURSE_TRIGGER_EFFECT_IDS as readonly string[]).includes(value.effectId)) return;
  context.addIssue({
    code: 'custom',
    path: ['effectId'],
    message:
      `curse trigger effect ${value.effectId} is not in the curse allowlist; ` +
      'curses may never mutate terrain, features, or traversal',
  });
});

const curseTrigger = z.strictObject({
  on: z.enum(CURSE_TRIGGER_EVENTS),
  effect: curseTriggerEffect,
  chanceBps: z.number().int().safe().min(1).max(10000).default(10000),
});

export const curseEntry = z
  .strictObject({
    ...base,
    kind: z.literal('curse'),
    revealText: z.string().trim().min(1).max(300),
    drawbackModifiers: negativeDerivedStatModifiers.default({}),
    trigger: curseTrigger.nullable().default(null),
  })
  .superRefine((entry, context) => {
    // `maxHealth` is a derived stat that is never written back onto the actor -- an actor's stored
    // maxHealth is fixed at run creation and is what the health bar, the healing cap, and the
    // below-half curse trigger all read. A curse drawback on it would therefore be silently inert,
    // so it is rejected at compile time rather than shipped as a curse that does nothing.
    if ('maxHealth' in entry.drawbackModifiers) {
      context.addIssue({
        code: 'custom',
        path: ['drawbackModifiers', 'maxHealth'],
        message:
          'curse drawbackModifiers may not target maxHealth: derived maxHealth is never written ' +
          'back to the actor, so the drawback would be inert. Use a stat that bites through ' +
          'equipmentModifiers (for example defense, meleeAccuracy, or maxWeave).',
      });
    }
    if (Object.keys(entry.drawbackModifiers).length === 0 && entry.trigger === null) {
      context.addIssue({
        code: 'custom',
        path: ['drawbackModifiers'],
        message: 'a curse must declare drawbackModifiers or trigger, or both',
      });
    }
  });
