/**
 * All static landing-page copy, rewritten from the design handoff's copy in a humanizing pass:
 * short declarative sentences instead of the handoff's em-dash parentheticals and negative
 * parallelisms ("not just X, it's Y"). The register to match throughout is the recurring line
 * "Many enter. Few return. All are woven in." Structure, headings, and CTA text follow the
 * handoff verbatim; only prose that read as AI-typical was reworded.
 *
 * The real game route: every CTA that the handoff left as a `#play` placeholder anchor now
 * points here.
 */
export const PLAY_ROUTE = '/play';

/** The handoff's "Be Woven In" registration CTA describes milestone-6 (registered accounts),
 * which does not exist yet. Its target is an inert anchor, not a route to a page that isn't
 * built — this keeps the card sellable without pretending registration works today. */
export const REGISTRATION_COMING_SOON_HREF = '#registration-coming-soon';

export const TAGLINE = 'Many enter · Few return · All are woven in';

export const NAV_LINKS = [
  { href: '#lore', label: 'Lore' },
  { href: '#deep', label: 'The Deep' },
  { href: '#access', label: 'Guest & Legacy' },
] as const;

export const HERO = {
  eyebrow: 'An endless descent · Free in your browser',
  lead: {
    before: 'The gods wove a labyrinth to cage an ancient horror. Now the weave is failing. The ',
    emphasis: 'Heart of the Deep',
    after: ' must be recovered before the prison unravels.',
  },
  italicTagline: 'Descend into the depths. Recover the Heart. Escape alive.',
  coverAlt:
    'The Woven Deep: an adventurer stands at the lantern-lit edge of a vast woven labyrinth, a glowing Heart in its depths',
};

export const LORE = {
  eyebrow: 'The prison beneath the world',
  heading: 'A labyrinth that remembers the dead',
  paragraphs: [
    'Long ago, the gods wove an impossible labyrinth beneath the world to imprison an ancient horror. The prison became known as The Woven Deep, and at its center they set the Heart of the Deep, an ancient power that binds the weave together and holds the darkness below contained.',
    'For centuries, adventurers have descended seeking the Heart. Few return. Those who perish are not forgotten: the Deep remembers them. Their stories, treasures, failures, and ghosts become woven into the labyrinth itself. Every expedition leaves traces, and the dungeon shifts and tangles as the weave grows ever more knotted.',
    'Now the weave is beginning to unravel. The Heart must be found before the prison fails, and only a new adventurer, descending with nothing but a lantern and a blade, remains to answer.',
  ],
} as const;

export const DEEP_REMEMBERS = {
  eyebrow: 'Nothing is lost. Everything is woven in.',
  heading: 'The Deep remembers',
  pillars: [
    {
      no: 'I',
      title: 'Every death is recorded',
      body: 'When an adventurer falls, the Deep keeps them. Their corpse, their loot, and their last words all become threads in the weave.',
    },
    {
      no: 'II',
      title: 'The labyrinth rewrites itself',
      body: 'No two descents share a map. With every expedition the weave tangles tighter, and the paths you knew are swallowed.',
    },
    {
      no: 'III',
      title: 'You will meet the fallen',
      body: 'Descend far enough and you cross the haunts of those who came before. A few will aid you. Most will not.',
    },
    {
      no: 'IV',
      title: 'The weave is unraveling',
      body: 'As the Heart fails, the prison degrades and the horror below stirs. Reach it before the whole weave comes apart.',
    },
  ],
} as const;

export const ACCESS = {
  eyebrow: 'Free to play, either way',
  heading: 'Descend as a shade, or be woven in',
  supporting: 'Registration is still free. It just gives the Deep a name to remember you by.',
  guest: {
    label: 'No account · Instant',
    title: 'Enter as a Guest',
    body: 'Open the Deep in one click. Every depth, including the Heart itself, is here for you with nothing to sign.',
    positives: [
      'Play instantly. No account, no download.',
      'The complete descent: every depth and the Heart itself.',
    ],
    limits: [
      'Progress lives only for this session.',
      'Your death vanishes with you. The Deep never learns your name.',
    ],
    cta: 'Descend as guest',
  },
  member: {
    ribbon: 'Remembered',
    label: 'Free account · Persistent',
    title: 'Be Woven In',
    body: 'Everything in guest mode, plus permanence. Your descents endure. Your death becomes part of the weave.',
    benefits: [
      'Everything in guest mode, kept forever.',
      'The Deep remembers you. Your death persists as a haunt others will meet.',
      'Carry a named legacy and bloodline across every run.',
      'Track expeditions, depth records, and recovered relics.',
      "Your treasures and ghosts seed other adventurers' labyrinths.",
      'Cloud saves. Descend from any device and pick up where you fell.',
    ],
    cta: 'Register free: leave a legacy',
  },
} as const;

export const FEATURES = {
  eyebrow: 'What waits in the dark',
  heading: 'Notable features',
  items: [
    {
      icon: '↺',
      title: 'An ever-shifting labyrinth',
      body: 'The Deep rewrites itself every descent. No two maps are the same, and the weave tangles tighter the deeper you go.',
    },
    {
      icon: '†',
      title: 'Permadeath with legacy',
      body: 'Death is final for the run. For the woven-in, it endures and seeds the shared world with your corpse, loot, and ghost.',
    },
    {
      icon: '❖',
      title: 'Deep, systemic content',
      body: 'Hundreds of monsters, items, spells, traps, conditions, and vaults interlock, and no encounter plays out scripted.',
    },
    {
      icon: '?',
      title: 'Unidentified relics',
      body: 'Loot arrives unnamed. Identify it through use, or through risk. Every unknown vial or blade is a gamble against the dark.',
    },
    {
      icon: '◈',
      title: 'Play in your browser',
      body: 'The whole Deep runs in a single tab. No download, no launcher. Click Descend and you are already falling.',
    },
    {
      icon: '✵',
      title: 'A living, shared world',
      body: 'Every expedition leaves traces. Descend and you cross the haunts and hoards of adventurers who fell before you.',
    },
  ],
} as const;

export const FAQS = [
  {
    q: 'Do I need to download anything?',
    a: "No. The Deep opens directly in your browser. Click Descend and you're in. Nothing to install.",
  },
  {
    q: 'What is guest mode?',
    a: 'Enter immediately with no account. You get the full descent, every depth and the Heart itself, but your run ends when you close the tab. The Deep forgets you were ever there.',
  },
  {
    q: 'What happens when I die?',
    a: 'For guests, the run simply ends. For the woven-in, your death is recorded into the labyrinth itself. Your corpse, your loot, and your ghost become obstacles and rumors for other adventurers.',
  },
  {
    q: 'Is it really free?',
    a: 'Yes. Playing is free whether you register or not. Registration adds persistence and legacy. It never adds a cost.',
  },
  {
    q: 'How hard is it?',
    a: 'Few return. The Deep is unforgiving and ever-shifting, and death is permanent for that run. That difficulty is the point.',
  },
  {
    q: 'What does registering cost?',
    a: 'Nothing but a name. In return, the Deep remembers you. Your runs endure, and your legacy is woven into the shared labyrinth.',
  },
] as const;

export const FINAL_CTA = {
  eyebrow: 'The weave is failing',
  heading: ['Will you answer', 'the descent?'],
  supporting:
    'No download. No cost. Open the Deep in your browser and take your first step into the dark.',
  primaryCta: 'Play Free: Descend Now',
  secondaryCta: 'Or register to be remembered',
};
