# Handoff: The Woven Deep — Marketing Landing Page

## Overview
A single-page marketing/landing site for **The Woven Deep**, a free browser-based roguelike dungeon crawler. It sells the game's premise (descend a living labyrinth that remembers the dead, recover the Heart before the prison unravels), explains the free **Guest** vs. free-account **"Be Woven In"** modes, lists notable features, answers FAQs, and drives the primary CTA: **Play Free — Descend Now** (browser, no download).

## About the Design Files
The file in this bundle (`The Woven Deep.dc.html`) is a **design reference created in HTML** — a working prototype showing the intended look, motion, and behavior. It is **not** production code to ship directly. It is authored as a "Design Component" (`.dc.html`) with a small custom runtime and inline styles; that format is a prototyping convenience, not a target.

The task is to **recreate this design in the target codebase's environment** using its established patterns and libraries. The game's real web app is a **React + Vite + TypeScript** app (`apps/web` in the `FrodeHus/the-woven-deep` repo), so the natural target is a React component tree with your chosen styling approach (CSS Modules, Tailwind, styled-components, etc.). If no front-end environment exists yet, implement in React/Vite to match the existing app.

You can open `The Woven Deep.dc.html` directly in a browser to see and interact with the reference (embers, parallax, scroll reveals, FAQ accordion).

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, copy, and interactions are all specified below and should be recreated faithfully. The one intentional placeholder: the CTAs are in-page anchors (`#play`, `#access`) because there is no live game URL yet — wire them to the real play/registration routes.

---

## Layout & Structure

Single column, dark theme, centered content. Two global fixed layers sit behind everything:
1. **Ambient gradient layer** (`z-index:1`, `position:fixed`, `inset:0`, `pointer-events:none`) — layered radial "lantern" glows + a warm **hearth glow anchored to the bottom edge** of the viewport.
2. **Ember canvas** (`z-index:2`, `position:fixed`, `inset:0`, `pointer-events:none`) — animated particle field (see *Ember particle system*).

All page content sits at `z-index:4`. Max content width **1180px** (narrower for prose sections: lore 900px, FAQ 820px), horizontal padding **28px**, centered with `margin:0 auto`.

### Sections (top to bottom)
1. **Nav** (absolute over hero) — wordmark left, links + Play Free button right.
2. **Hero** — two-column grid (`1.05fr .95fr`, gap 56px), min-height `100vh`, top padding 150px. Left: copy + CTAs. Right: framed cover poster with pulsing glow + float.
3. **Scroll cue** — centered "DESCEND ↓".
4. **Lore** (`#lore`, max 900px) — eyebrow, heading, 3 prose paragraphs with a drop-cap.
5. **The Deep remembers** (`#deep`, max 1180px) — 2×2 grid of 4 "pillar" cards.
6. **Guest & Legacy** (`#access`, max 1180px) — 2-column comparison (Guest vs Be Woven In).
7. **Notable features** (`#features`, max 1180px) — 3-column grid of 6 feature cards.
8. **FAQ** (max 820px) — 6-item accordion.
9. **Final CTA + Footer** (`#play`, max 1180px) — glowing CTA panel, then footer row.

---

## Design Tokens

### Color
| Token | Hex | Use |
|---|---|---|
| Base background | `#0c0e16` | Page background |
| Panel background | `#111420` | Cards, FAQ, guest card |
| Registered-card bg | `linear-gradient(180deg,#1c1708,#131017)` | "Be Woven In" card |
| Gold (primary accent) | `#e8c879` | Headings, primary buttons, wordmark, marks |
| Gold bright (hover) | `#f1d898` / `#f6e2ac` | Button hover |
| Amber / ember | `#eab765`, `#c98c3f`, `#d2a046` | Hot accents, glows, pillar numerals |
| Heading cream | `#efe3c4` | Hero H1, card titles |
| Body text | `#c3cadf` / `#bcc4db` | Lead paragraphs |
| Muted text | `#98a1bd` / `#8891ac` | Secondary copy |
| Dim/label | `#7d89a8` | Eyebrows, nav links |
| Faint | `#586179` / `#4f5773` | Micro text, footer |
| Border (default) | `#262c42` / `#232941` | Card borders |
| Border (hover/gold) | `#e8c879` | Card hover, focus |
| Border (registered) | `#b98a34` | "Be Woven In" card border |
| Divider | `#1c2136` | Footer top border |

Note: the cover art contains **violet** dungeon glow, but the UI palette itself is deliberately **all warm (gold/amber), no purple** — keep it that way.

### Typography
- **Display / headings & wordmark:** `'Marcellus', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif` (Marcellus is a Trajan-style Roman capital; the web-safe chain is the required fallback so it never breaks). Marcellus ships weight 400 only — sizes/tracking carry the emphasis; faux-bold is acceptable.
- **Body / prose:** `'EB Garamond', Georgia, serif`.
- **Labels / eyebrows / buttons / micro:** `ui-monospace, Menlo, Consolas, monospace`, uppercase, letter-spacing `.13em–.28em`.

Type scale (clamp, responsive):
- Hero H1: `clamp(3rem, 6vw, 5.4rem)`, line-height `.97`.
- Section H2: `clamp(2.2rem, 4.4vw, 3.4rem)`, line-height `1.05`.
- Final-CTA H2: `clamp(2.4rem, 5vw, 4rem)`.
- Lead paragraph: `clamp(1.15rem, 1.7vw, 1.4rem)`, line-height `1.6`.
- Card title (h3): `1.4rem–2rem`.
- Body prose: `1.16rem–1.34rem`, line-height `1.6–1.75`.
- Eyebrow/label: `11–12px`.

### Spacing
Section vertical padding ~`90–120px`. Card padding `30–38px`. Grid gaps: pillars `22px`, features `20px`, access `24px`, FAQ `12px`. Button padding `15–19px × 26–40px`.

### Radius & borders
- Cards: `5–8px`. Buttons: `3px`. Poster frame: `5px`. Border width `1px` throughout.

### Shadows / glows
- Primary button hover: `0 0 34px -4px rgba(232,200,121,.6)` + `translateY(-2px)`.
- Pillar card hover: `0 22px 60px -26px rgba(232,180,100,.5), inset 0 0 40px -20px rgba(232,200,121,.35)`.
- Feature card hover: `0 18px 50px -28px rgba(232,180,100,.55)` + `translateY(-4px)`.
- Poster frame: `0 40px 90px -30px rgba(0,0,0,.9)`.
- Registered card: `0 30px 80px -40px rgba(210,160,70,.6)`.

---

## Components (per section)

### Nav
- Wordmark: gold diamond (11px, rotated 45°, `box-shadow:0 0 14px rgba(232,200,121,.9)`) + "The Woven Deep" in Marcellus 20px, letter-spacing `.1em`, `#e8c879`.
- Links (Lore / The Deep / Guest & Legacy): monospace 11.5px uppercase `#7d89a8`.
- **Play Free** button: gold bg `#e8c879`, text `#0d0f18`, monospace, radius 3px; hover → `#f1d898` + gold glow.

### Hero
- Eyebrow: "AN ENDLESS DESCENT · FREE IN YOUR BROWSER".
- H1: "Few return / from the Deep. / **None are forgotten.**" — last line colored `#eab765` with amber text-shadow.
- Lead: gods/labyrinth/Heart premise; "Heart of the Deep" italic `#eab765`.
- Italic tagline: "Descend into the depths. Recover the Heart. Escape alive."
- CTAs: **Descend Now ▾** (gold, primary) + **Enter as guest** (outline, border `#3a4159`, hover gold).
- Micro line: "Many enter · Few return · All are woven in".
- **Cover poster** (right): `images/woven-deep-cover.png` (1024×1536) in a framed box (`width:min(400px,86%)`, border `rgba(232,200,121,.24)`, inset vignette). Behind it a radial **Heart glow** (`radial-gradient` amber, blurred 26px) that pulses; the frame gently floats.

### Lore (`#lore`)
- Eyebrow "The prison beneath the world", H2 "A labyrinth that remembers the dead", 3 paragraphs. First paragraph has a Marcellus **drop-cap "L"** (`float:left`, ~4.6rem, `#eab765`). Final paragraph tinted `#d7c39a`, slightly larger. Section has a faint warm radial glow behind the drop-cap area.

### The Deep remembers (`#deep`) — 4 pillar cards, 2×2
Each: Roman numeral (I–IV, monospace `#c98c3f`), Marcellus title, muted body. Card bg `#111420` + a faint diagonal woven texture (`repeating-linear-gradient(118deg, rgba(232,200,121,.05) 0 2px, transparent 2px 10px)`). **Hover:** gold border, glow, and the woven texture shifts (`background-position` 0→64px over 1.1s).
Content:
- I — Every death is recorded
- II — The labyrinth rewrites itself
- III — You will meet the fallen
- IV — The weave is unraveling

### Guest & Legacy (`#access`) — 2 cards
- **Enter as a Guest** (`#111420`): label "No account · Instant". Benefit list with gold `›` marks (positives) and dim `✕` marks (limitations). Outline CTA "Descend as guest".
  - Positives: play instantly no account/download; full descent every depth + the Heart.
  - Limits: progress lives only for this session; death vanishes with you.
- **Be Woven In** (registered, gold border, warm gradient bg): corner ribbon "Remembered" (gold bg, dark text). Label "Free account · Persistent". Six `✦` benefits. Solid gold CTA "Register free — leave a legacy".
  - Benefits: everything in guest kept forever; the Deep remembers you (your death persists as a haunt); named legacy/bloodline across runs; track expeditions/depth records/relics; your treasures & ghosts seed others' labyrinths; cloud saves cross-device.

### Notable features (`#features`) — 6 cards, 3 columns
Each: 38×38 bordered glyph tile (gold glyph), Marcellus title, muted body. **Hover:** gold border, glow, `translateY(-4px)`.
1. ↺ An ever-shifting labyrinth
2. † Permadeath with legacy
3. ❖ Deep, systemic content
4. ? Unidentified relics
5. ◈ Play in your browser
6. ✵ A living, shared world

### FAQ — 6-item accordion
Each item: `#111420` card, monospace `+`/`−` toggle in gold. Clicking toggles open (single-open accordion; item 0 open by default). Questions: download?, what is guest mode?, what happens when I die?, is it free?, how hard?, what does registering cost? (Full answers are in the HTML.)

### Final CTA + Footer (`#play`)
- Panel: radial amber glow top, border `#2b3149`, radius 8px, centered. Eyebrow "The weave is failing", H2 "Will you answer / the descent?", supporting line (no download, no cost), **Play Free — Descend Now** (large gold button) + text link "Or register to be remembered".
- Footer: dim diamond + "The Woven Deep" (Marcellus), and micro line "Many enter · Few return · All are woven in".

---

## Interactions & Behavior

- **Scroll reveal:** every section element marked `data-reveal` starts `opacity:0; translateY(22–30px)` and animates to visible when it nears the viewport. Implementation should be self-healing: reveal on load, on scroll, and on resize for anything within ~92% of viewport height, plus a hard fallback (~1.6s) so content can never stay hidden. Transition ~`.8–1s` `cubic-bezier(.2,.7,.2,1)`. Respect `prefers-reduced-motion` (reveal instantly, no transition).
- **Parallax:** on scroll, the cover image translates `translate3d(0, scrollY*0.1, 0)` and the Heart glow shifts `marginTop: scrollY*0.05`. rAF-throttled.
- **Hover states:** buttons lift + glow; cards gain gold border + glow (see shadows); FAQ card border lightens.
- **FAQ accordion:** single open item at a time; toggling the open item closes it; `+`↔`−`.
- **CSS keyframe animations** (disabled under reduced-motion):
  - `wd-pulse` (6s) — Heart glow opacity `.45→.85` + scale `1→1.12`.
  - `wd-float` (9s) — poster `translateY 0→-10px`.
  - `wd-bob` (2.4s) — scroll-cue arrow.
  - (A `wd-flicker` keyframe exists for a lantern flicker; currently not applied to the H1.)

### Ember particle system (the signature animation)
Canvas, fixed full-viewport, `globalCompositeOperation='lighter'`. Behaves like a **hearth**:
- Particles originate **low** (near the bottom of the frame) and drift **gently upward** with slow 2-axis sinusoidal sway — never a straight jet.
- Two kinds: **sparks** (brighter, rise a bit faster, near-white hot core) and **motes** (dim, slow, warm). `sparkChance`: `both`=0.42, `ember`=0.55, `dust`=0.
- **Motion-blur streaks:** each particle is drawn as a short line along its velocity vector; length scales with per-frame speed (`min(sparkMax, speed*k)`), so slow motes look like points and fast sparks smear into short glowing lines. Plus a radial glow head; sparks also get a near-white core dot.
- **Heat color ramp** by age (`t = age/life`): white-hot `255,247,222` → yellow `255,208,124` → orange `249,160,70` → `226,108,46` → deep red `152,48,26`. Embers cool as they rise/age.
- **Vertical falloff:** alpha × `(0.08 + 0.92 * (y/H)²)` — brightest at the bottom, fading toward the top.
- **Lifetime envelope:** fade in over first 14%, hold, fade out last 28%. Flicker via layered sines (sparks shimmer strongly, motes subtly).
- Count `~min(100, max(44, W/15))`, capped `devicePixelRatio` at 2. Re-seeds on resize. Cancel rAF + remove listeners on unmount.

---

## State Management
Minimal:
- `openFaq` (number) — index of the currently open FAQ item (default `0`; `-1` = all closed).
- Ember canvas internal particle array + rAF handle (component-local, not app state).
- Two design-time tweak props (map to config, not runtime UI): `motion` (boolean, gates all animation) and `emberStyle` (`'both' | 'ember' | 'dust'`).

## Data / content
All copy is static and lives in the HTML (pillars, guest/member benefit lists, features, FAQ Q&A). No data fetching on this page. (The real app's `/api/content/*` endpoints are unrelated to this marketing page.)

## Assets
- `images/woven-deep-cover.png` — the game cover art (1024×1536), sourced from `FrodeHus/the-woven-deep` repo (`images/woven-deep-cover.png`). Used as the hero poster. Included in this bundle.
- Fonts: **Marcellus** and **EB Garamond** from Google Fonts. Glyph marks (↺ † ❖ ◈ ✵ ✦ › ✕ ▾ ↓ + −) are Unicode characters, not image icons — swap for your icon set if preferred.
- No custom SVG/icon assets.

## Files
- `The Woven Deep.dc.html` — the complete design reference (template markup + logic + inline styles + ember/reveal/parallax JS).
- `images/woven-deep-cover.png` — cover art asset.
- `screenshots/01–06-section.png` — reference captures scrolling down the page (hero → lore → the-deep → access → features → final CTA). Static frames; open the HTML to see motion.

## Accessibility notes
- All animation respects `prefers-reduced-motion`.
- Cover `<img>` has descriptive alt text.
- FAQ toggles are real `<button>`s; ensure `aria-expanded` is added on recreation.
- Maintain contrast: body text `#c3cadf`/`#98a1bd` on `#0c0e16`/`#111420` passes; keep muted text ≥ `#8891ac` for small sizes.

> Repo note (2026-07-16): copied from the Claude Design handoff at /tmp/design_handoff_woven_deep_landing. The bundle's images/woven-deep-cover.png is omitted here — it is the same file already tracked at images/woven-deep-cover.png in the repo root.
