# Combat balance tuning — monsters survive blows and threaten real damage

**Issue:** #212 (playtest 2026-08-03: "very simple to play and no real danger — all encounters are
usually killed with one blow, so there is no sense of impending doom").

## Root cause

The hero's melee stats derive linearly from full attribute values (`meleeAccuracy`/
`meleeDamageBonus` = might × 1, so a default all-tens hero swings at +11 to hit for 1d6+10;
`defense` = 8 + agility = 18–19 with armor). The monster stat blocks, however, were authored on a
modifier-like scale: 3–7 HP and +0–4 accuracy at depth 1. The result was one-blow kills in the
hero's favor and ~15–30 % hit chances against them for 1d3-ish damage — no attrition, no threat.

Rescaling the hero-side formulas instead was considered and rejected: the formulas feed the chargen
derived-stat display, lockpicking/search difficulties, and the spellPower divisor economy, and a
`base: -10` melee bonus would zero out low-might builds outright (point-buy attributes start at 0).
The monster stat blocks are the side that was mis-scaled, so they are what moved.

## The model

A throwaway generator (run once, not committed) proposed per-monster `health`/`accuracy`/`damage`
against an **at-band hero benchmark**: the default guest hero plus tempering points at depths
3/6/9/12/15/18 (alternating might/vitality), a +1 damage enchant from the mid-game, and armor
growth 1→3 across the run. Per-monster role targets, classified from tags:

| Role (tags)                | Blows to kill | Monster hit % | Relative threat |
| -------------------------- | ------------- | ------------- | ---------------- |
| fodder (vermin/animal)     | 2             | 40–45 %       | low              |
| skirmisher / ranged        | 2             | 55 %          | medium           |
| caster                     | 2             | 45 %          | spells carry it  |
| standard                   | 3             | 50 %          | medium           |
| ooze (mindless)            | 3             | 35 %          | slow but heavy   |
| brute / armored            | 4             | 45 %          | high             |
| elite                      | 5             | 60 %          | high             |
| bosses                     | 9–13          | 65 %          | phase-driven     |

**No-nerf policy:** anything already at or beyond its target (most of the depth-13+ roster) kept
its stats; only accuracy rose where hit rates were below band. Armor and resistances were left
untouched everywhere — they are the monsters' identities, and the health targets were computed
*through* them (an armored monster needs fewer raw HP for the same blow count).

Hand adjustments: `monster.heart-herald` 120 HP (the milestone-boss test pins ashfather <
tide-sovereign < heart-herald health ordering, and the herald's mitigation would otherwise land its
12-blow pool below the sovereign's); `monster.weakened-heart` 176 HP / 2d8+1 stays the ceiling every
ramp monster must sit under.

## What it feels like at the pinned e2e seed (11.22.33.44)

- Cave rats take **two blows** each; clearing the starting pair costs the hero **8 of 20 HP**.
- Standing next to a surviving rat kills the hero in **12 waits** (previously 86).
- The gameplay demo's hero now finishes its scenario at 10/20 HP (previously untouched).

## Validation

- Every demo CLI re-pinned after inspecting the milestone transcripts: same milestones (kills, boss
  phases, loot drops, lock picks) at later command ids, plus the hero visibly taking damage. The
  rat/beetle kills in the gameplay demo and replay test became bounded `repeatUntil` loops so the
  scenario proves the same beats regardless of blow counts.
- `packages/content` balance tests green (boss monotonicity, ramp-under-heart re-pinned 90→176).
- All e2e walks re-derived (same derivation methodology as issue #107) and green.

## Deliberately out of scope

- Hero-side formula changes (see rejection above).
- Monster speed, behavior, resistances, loot, threat/score coefficients.
- Champion/echo haunts — they derive from recorded hero attributes and were already hero-scale.
- Encounter density/placement (#152's depth-12 desert is its own issue).
