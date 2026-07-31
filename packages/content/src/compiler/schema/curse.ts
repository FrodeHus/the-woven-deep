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
    if (Object.keys(entry.drawbackModifiers).length === 0 && entry.trigger === null) {
      context.addIssue({
        code: 'custom',
        path: ['drawbackModifiers'],
        message: 'a curse must declare drawbackModifiers or trigger, or both',
      });
    }
  });
