import type { CompiledContentPack } from '@woven-deep/content';
import type { ObservableCell } from '@woven-deep/engine';
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  RenderTexture,
  Sprite,
  Text,
  Texture,
  type Ticker,
} from 'pixi.js';
import { MAX_TRANSIENT_EFFECTS, type TransientEffect } from '../effects-map.js';
import { equippedLightSource } from '../light-sources.js';
import { featuresOf, heroOf, type FeatureView } from '../../session/projection-view.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { AtlasRect, PlayfieldAtlas, SpriteAtlas } from './atlas.js';
import { bakeFloor, bakeKey, occludedWallIndices, planFloorBake } from './floor-bake.js';
import { TILE_HALF_H, TILE_HALF_W, worldToScreen, cellAtScreen, type IsoView } from './iso-math.js';
import { groundItemHoverOffset, resolveActorRect, resolveItemSprite } from './sprite-mapping.js';
import {
  isFogMaskedTier,
  lightPoolDiameterPx,
  lightsForFloor,
  visibleBrightness,
  type LightSpec,
} from './light-layer.js';
import { selectNewEffects, spawnForEffect, stepParticles, type Particle } from './particles.js';
import {
  motionPosition,
  nextSceneState,
  type ActorSprite,
  type GroundItemSprite,
  type SceneState,
} from './scene-state.js';

export interface RendererCallbacks {
  onCellClick(cell: { x: number; y: number }, button: 'primary' | 'secondary'): void;
  onCellHover(
    hover: { cell: { x: number; y: number }; clientX: number; clientY: number } | null,
  ): void;
}

export interface TargetingVisual {
  validCells: ReadonlySet<string>;
  affectedCells: ReadonlySet<string>;
  reticle: { x: number; y: number } | null;
}

/** The iso-local scale the floor bake is planned at. The camera zoom is applied by the world
 * container's own `scale` instead, so the bake stays a fixed 1:1 iso plan regardless of zoom. */
const BAKE_SCALE = 1;
/** Fixed camera zoom for this task -- a Settings-exposed zoom is explicitly out of scope. */
const ZOOM = 1;

const BACKGROUND_COLOR = 0x05060a;
/** The global darkness the multiply light-map starts from (areas outside any discovered cell). */
const DARKNESS_COLOR = 0x05060a;
/** The cool, dim brightness `remembered` cells multiply down to -- matches the old renderer's
 * `--remembered` gray (`#4b526b`, luminance ~0.29), so a remembered cell is clearly darker than any
 * visible one (floored at `VISIBLE_FLOOR_BRIGHTNESS`) yet still legible. */
const REMEMBERED_COLOR = 0x4b526b;
/** Warm lamp color for fixture light pools. */
const FIXTURE_LIGHT_COLOR = 0xffb166;
/** Fallback hero light color when no light source resolves a color. */
const DEFAULT_HERO_LIGHT_COLOR = 0xf2e2b6;

const SHADOW_COLOR = 0x000000;
const SHADOW_ALPHA = 0.35;
const HP_BAR_BG = 0x1a1a1a;
const HP_HIGH = 0x6fd66f;
const HP_LOW = 0xd65a5a;

const HURT_DURATION_MS = 400;
const HURT_VIGNETTE_COLOR = 0xcc2222;
const HURT_VIGNETTE_MAX_ALPHA = 0.5;
const HURT_SHAKE_MAX_PX = 7;

/** Floating combat-text lifetime/rise. `TransientEffect` (Task 7's `effects-map.ts`) carries no
 * damage amount -- only `key`/`kind`/`x`/`y`/`toX?`/`toY?` -- so this is a generic hit/death glyph,
 * not the actual damage number; a real number would need a wider domain-event shape upstream. */
const DAMAGE_FLOAT_TTL_MS = 650;
const DAMAGE_FLOAT_RISE_PX = 28;
const HIT_FLASH_GLYPH = '✦';
const DEATH_BURST_GLYPH = '☠';
const HIT_FLASH_TEXT_COLOR = 0xff6a5a;
const DEATH_BURST_TEXT_COLOR = 0xb188ff;

const CAMERA_EASE_PER_SECOND = 6;
const FLICKER_SPEED = 0.006;
const RADIAL_GRADIENT_SIZE = 128;

/** Per-feature-type glyph + color for the sprite-less fallback (chests, revealed secrets, traps,
 * open doors until arch art exists). `FeatureView` carries no glyph, so these are the renderer's
 * defaults; an unrecognized future type falls back to a neutral '?'. */
function featureGlyphStyle(type: string): { glyph: string; color: number } {
  switch (type) {
    case 'door':
      return { glyph: '/', color: 0xc9a06a };
    case 'chest':
      return { glyph: '▣', color: 0xd4af37 };
    case 'secret':
      return { glyph: '?', color: 0xb188ff };
    case 'trap':
      return { glyph: '^', color: 0xd65a5a };
    default:
      return { glyph: '?', color: 0xffffff };
  }
}

interface ActorDisplay {
  readonly container: Container;
  readonly sprite: ActorSprite;
}

/** A mounted ground-item display: the outer container (positioned at the cell), the bob-able body
 * node (sprite or glyph) whose y oscillates each frame, its resting y, and the world cell so the
 * hover phase stays keyed to the item's position. The shadow stays fixed on the container. */
interface ItemDisplay {
  readonly container: Container;
  readonly body: Container;
  readonly bodyBaseY: number;
  readonly x: number;
  readonly y: number;
}

/** Sheet→screen scale for actor sprites: applied uniformly so taller boss crops render larger for
 * free. A ~130px standard crop lands near two tiles tall; LARGE crops (up to ~160px) rise above it. */
const ACTOR_SPRITE_SCALE = 0.52;
/** Sheet→screen scale for ground-item sprites -- smaller than actors, centered on the cell. */
const ITEM_SPRITE_SCALE = 0.3;
/** Actor feet rest here below the diamond centre (matches the glyph baseline it replaces). */
const ACTOR_FEET_Y = TILE_HALF_H * 0.4;

/** A rising, fading glyph spawned for a hit or death effect. Owns its `Text` for the duration of
 * its float; `updateDamageFloats` destroys it the moment its ttl elapses. */
interface DamageFloat {
  readonly text: Text;
  readonly bornAt: number;
  readonly baseY: number;
}

interface LightDisplay {
  readonly sprite: Sprite;
  readonly spec: LightSpec;
  readonly isHero: boolean;
}

/**
 * The PixiJS v8 isometric renderer. A thin composition root: every placement/skinning/fog decision
 * already lives in a tested pure module (`iso-math`, `tile-skinning`, `floor-bake`, `scene-state`,
 * `light-layer`); this class only wires those into a Pixi scene graph, eases the camera, animates
 * ambient flicker/shake, and forwards pointer input as cell callbacks. It holds no game state and
 * dispatches no intents.
 *
 * NOTE (disclosed deviation from the Task 7 brief's literal `constructor(host, atlas, callbacks)`):
 * the hero light pool is sourced from `equippedLightSource`, whose real signature is
 * `(projection, pack)` -- it needs the compiled content pack to read the equipped light item's
 * radius. `SessionSnapshot` does not carry the pack, so the pack is a fourth constructor argument.
 * Task 8's `createRenderer` seam takes the same four arguments.
 */
export class IsoRenderer {
  private readonly host: HTMLElement;
  private readonly atlas: PlayfieldAtlas;
  private readonly actorAtlas: SpriteAtlas;
  private readonly itemAtlas: SpriteAtlas;
  private readonly callbacks: RendererCallbacks;
  private readonly pack: CompiledContentPack;

  private app: Application | null = null;
  private atlasImage: HTMLImageElement | null = null;
  private atlasBaseTexture: Texture | null = null;
  private actorBaseTexture: Texture | null = null;
  private itemBaseTexture: Texture | null = null;
  /** Lazily-built frame wrappers over the actor/item base sources, cached per contentId so each
   * sprite is allocated once and freed once (see `destroy`). */
  private readonly actorTextures = new Map<string, Texture>();
  private readonly itemTextures = new Map<string, Texture>();
  private gateTexture: Texture | null = null;
  private doorTexture: Texture | null = null;
  private archOpenTexture: Texture | null = null;
  private gradientTexture: Texture | null = null;
  private lightMap: RenderTexture | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private readonly worldContainer = new Container();
  private readonly floorSprite = new Sprite();
  private readonly featuresContainer = new Container();
  private readonly itemsContainer = new Container();
  private readonly actorsContainer = new Container();
  private readonly lightBuild = new Container();
  private readonly darknessQuad = new Sprite(Texture.WHITE);
  private readonly lightsContainer = new Container();
  private readonly fovGraphics = new Graphics();
  private readonly fovOverpaint = new Graphics();
  private readonly lightMapSprite = new Sprite();
  private readonly overlayContainer = new Container();
  private readonly targetingGraphics = new Graphics();
  private readonly effectsContainer = new Container();
  private readonly particleGraphicsNormal = new Graphics();
  private readonly particleGraphicsAdditive = new Graphics();
  private readonly vignetteSprite = new Sprite(Texture.WHITE);

  private scene: SceneState | null = null;
  private lights: readonly LightDisplay[] = [];
  private actorDisplays: readonly ActorDisplay[] = [];
  private itemDisplays: readonly ItemDisplay[] = [];
  private targeting: TargetingVisual | null = null;
  private particles: readonly Particle[] = [];
  private damageFloats: readonly DamageFloat[] = [];
  /** Salted per `snapshotGeneration` -- see `selectNewEffects` in `particles.ts` for why a raw
   * `effect.key` alone is not a safe cross-snapshot dedup key. */
  private seenEffectKeys: ReadonlySet<string> = new Set();
  /** The last snapshot OBJECT `setSnapshot` was given (reference identity, not a revision number:
   * `SessionSnapshot`/`GameplayProjection` never expose one -- confirmed against
   * `session-snapshot.ts` and `projection.ts`, consistent with the projection boundary never
   * leaking engine-internal revision counters). Bumping `snapshotGeneration` only when this
   * reference actually changes means a resize- or targeting-only re-feed of the SAME snapshot
   * object keeps the current generation, so its effects still dedup exactly once; a genuinely new
   * turn's snapshot always bumps it, even if `effectsForEvents` reuses a literal effect key. */
  private lastSnapshot: SessionSnapshot | null = null;
  private snapshotGeneration = 0;

  private floorWidth = 0;
  private floorHeight = 0;
  private currentBakeKey: string | null = null;
  private camX = 0;
  private camY = 0;
  private cameraInitialized = false;
  private hurtAt: number | null = null;
  private heroLightColor: number = DEFAULT_HERO_LIGHT_COLOR;
  private heroLightAlpha = 0;
  private heroLightRadius = 0;
  private shakeX = 0;
  private shakeY = 0;

  private readonly onTick = (ticker: Ticker): void => this.tick(ticker);
  private readonly onPointerDown = (event: PointerEvent): void => this.handlePointerDown(event);
  private readonly onPointerMove = (event: PointerEvent): void => this.handlePointerMove(event);
  private readonly onPointerLeave = (): void => this.callbacks.onCellHover(null);
  private readonly onContextMenu = (event: Event): void => event.preventDefault();

  constructor(
    host: HTMLElement,
    atlas: PlayfieldAtlas,
    callbacks: RendererCallbacks,
    pack: CompiledContentPack,
    actorAtlas: SpriteAtlas,
    itemAtlas: SpriteAtlas,
  ) {
    this.host = host;
    this.atlas = atlas;
    this.actorAtlas = actorAtlas;
    this.itemAtlas = itemAtlas;
    this.callbacks = callbacks;
    this.pack = pack;
  }

  async init(): Promise<void> {
    const app = new Application();
    await app.init({
      background: BACKGROUND_COLOR,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      width: Math.max(1, this.host.clientWidth),
      height: Math.max(1, this.host.clientHeight),
    });
    this.app = app;
    this.host.appendChild(app.canvas);

    const [atlasImage, actorImage, itemImage] = await Promise.all([
      this.loadAtlasImage(this.atlas.imageUrl),
      this.loadAtlasImage(this.actorAtlas.imageUrl),
      this.loadAtlasImage(this.itemAtlas.imageUrl),
    ]);
    this.atlasImage = atlasImage;
    this.atlasBaseTexture = Texture.from(this.atlasImage);
    this.actorBaseTexture = Texture.from(actorImage);
    this.itemBaseTexture = Texture.from(itemImage);
    // Built once and shared across every locked-feature sprite: a fresh per-snapshot wrapper would
    // leak, since a Sprite's default `destroy()` never destroys its texture.
    this.gateTexture = this.atlasTexture(this.atlas.gate);
    this.doorTexture = this.atlasTexture(this.atlas.door);
    // Absent in today's sheet -- an open door falls back to a glyph until the art ships.
    this.archOpenTexture =
      this.atlas.archOpen === undefined ? null : this.atlasTexture(this.atlas.archOpen);
    this.gradientTexture = this.buildRadialGradientTexture();

    this.assembleSceneGraph();
    this.recreateLightMap();

    const canvas = app.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('contextmenu', this.onContextMenu);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.host);

    app.ticker.add(this.onTick);
  }

  setSnapshot(snapshot: SessionSnapshot): void {
    const now = performance.now();
    const previous = this.scene;
    this.scene = nextSceneState(previous, snapshot, now);
    this.hurtAt = this.scene.hurtAt;

    if (snapshot !== this.lastSnapshot) {
      this.lastSnapshot = snapshot;
      this.snapshotGeneration += 1;
    }
    this.spawnNewEffects(this.scene.effects, now);

    const floor = snapshot.projection.floor;
    this.floorWidth = floor.width;
    this.floorHeight = floor.height;

    const hero = heroOf(snapshot.projection);
    if (!this.cameraInitialized) {
      this.camX = hero.x;
      this.camY = hero.y;
      this.cameraInitialized = true;
    }

    this.resolveHeroLight(snapshot);
    this.rebakeIfNeeded(floor.cells, floor.floorId, floor.town, hero);
    this.rebuildFeatures(snapshot);
    this.rebuildGroundItems();
    this.rebuildActors();
    this.rebuildLights(floor.cells, hero);
    this.rebuildFov(floor.cells);
  }

  setTargeting(visual: TargetingVisual | null): void {
    this.targeting = visual;
    this.redrawTargeting();
  }

  destroy(): void {
    const app = this.app;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    // Each damage float owns a `Text`; the app-destroy sweep below would reach them too (they hang
    // off `effectsContainer` in the stage), but destroying them explicitly first keeps this method
    // the single place that accounts for every `Text` this renderer ever created (Task 7's review
    // was strict about that).
    for (const damageFloat of this.damageFloats) damageFloat.text.destroy();
    this.damageFloats = [];
    this.particles = [];
    this.seenEffectKeys = new Set();
    this.lastSnapshot = null;
    this.snapshotGeneration = 0;

    // Capture the floor texture before the display tree is torn down.
    const floorTexture = this.floorSprite.texture;

    if (app) {
      app.ticker.remove(this.onTick);
      const canvas = app.canvas;
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerleave', this.onPointerLeave);
      canvas.removeEventListener('contextmenu', this.onContextMenu);
      // Destroy the display tree but NOT texture sources: `darknessQuad`/`vignetteSprite` render on
      // the process-global `Texture.WHITE`, and destroying its source (the `textureSource` flag)
      // would break every later IsoRenderer instance. The renderer-owned textures below are the
      // ones this instance actually allocated, so they are freed explicitly instead.
      app.destroy(true, { children: true });
    }

    // The light-build container is offscreen (never added to the stage), so the app teardown above
    // never reaches it; destroy its subtree here. Its children share `Texture.WHITE`/`gradientTexture`,
    // which are handled explicitly, so no texture flags here.
    this.lightBuild.destroy({ children: true });

    if (floorTexture && floorTexture !== Texture.EMPTY) floorTexture.destroy(true);
    this.gradientTexture?.destroy(true);
    // `gateTexture`/`doorTexture`/`archOpenTexture` are frame wrappers over the atlas base source, so
    // drop only the wrappers here and destroy the shared source once, via the base texture.
    this.gateTexture?.destroy(false);
    this.doorTexture?.destroy(false);
    this.archOpenTexture?.destroy(false);
    // Cached actor/item crops are frame wrappers over their base sources, so drop only the wrappers
    // here and destroy each shared source once via its base texture below.
    for (const texture of this.actorTextures.values()) texture.destroy(false);
    for (const texture of this.itemTextures.values()) texture.destroy(false);
    this.actorTextures.clear();
    this.itemTextures.clear();
    this.atlasBaseTexture?.destroy(true);
    this.actorBaseTexture?.destroy(true);
    this.itemBaseTexture?.destroy(true);
    this.lightMap?.destroy(true);

    this.gateTexture = null;
    this.doorTexture = null;
    this.archOpenTexture = null;
    this.gradientTexture = null;
    this.atlasBaseTexture = null;
    this.actorBaseTexture = null;
    this.itemBaseTexture = null;
    this.lightMap = null;
    this.app = null;
  }

  // --- setup helpers -------------------------------------------------------

  private loadAtlasImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = (): void => resolve(image);
      image.onerror = (): void => reject(new Error(`playfield atlas image failed to load: ${url}`));
      image.src = url;
    });
  }

  private assembleSceneGraph(): void {
    const app = this.app;
    if (!app) throw new Error('IsoRenderer.assembleSceneGraph called before init');

    this.actorsContainer.sortableChildren = true;

    this.worldContainer.addChild(
      this.floorSprite,
      this.featuresContainer,
      this.itemsContainer,
      this.actorsContainer,
    );

    this.darknessQuad.tint = DARKNESS_COLOR;
    // Light-map build order: (1) global darkness base, (2) `fovGraphics` paints each VISIBLE cell's
    // floored brightness, (3) additive light pools brighten that floor with falloff, (4)
    // `fovOverpaint` re-stamps every non-visible cell opaque LAST so a plain radial pool can never
    // leak light onto unseen geometry (the fog invariant in `isFogMaskedTier`).
    this.lightBuild.addChild(
      this.darknessQuad,
      this.fovGraphics,
      this.lightsContainer,
      this.fovOverpaint,
    );

    this.lightMapSprite.blendMode = 'multiply';

    this.particleGraphicsAdditive.blendMode = 'add';
    this.effectsContainer.addChild(this.particleGraphicsNormal, this.particleGraphicsAdditive);

    this.overlayContainer.addChild(this.targetingGraphics, this.effectsContainer);

    this.vignetteSprite.tint = HURT_VIGNETTE_COLOR;
    this.vignetteSprite.alpha = 0;

    app.stage.addChild(
      this.worldContainer,
      this.lightMapSprite,
      this.overlayContainer,
      this.vignetteSprite,
    );
  }

  /** A white-core-to-transparent radial gradient, reused (tinted) for every light pool. */
  private buildRadialGradientTexture(): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = RADIAL_GRADIENT_SIZE;
    canvas.height = RADIAL_GRADIENT_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('IsoRenderer: 2d context unavailable for light gradient');
    const half = RADIAL_GRADIENT_SIZE / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.55)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, RADIAL_GRADIENT_SIZE, RADIAL_GRADIENT_SIZE);
    return Texture.from(canvas);
  }

  private recreateLightMap(): void {
    const app = this.app;
    if (!app) return;
    this.lightMap?.destroy(true);
    this.lightMap = RenderTexture.create({
      width: Math.max(1, app.screen.width),
      height: Math.max(1, app.screen.height),
    });
    this.lightMapSprite.texture = this.lightMap;
  }

  private handleResize(): void {
    const app = this.app;
    if (!app) return;
    app.renderer.resize(Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight));
    this.recreateLightMap();
  }

  // --- per-snapshot rebuilds ----------------------------------------------

  private resolveHeroLight(snapshot: SessionSnapshot): void {
    const light = equippedLightSource(snapshot.projection, this.pack);
    if (light === undefined) {
      this.heroLightAlpha = 0;
      this.heroLightRadius = 0;
      this.heroLightColor = DEFAULT_HERO_LIGHT_COLOR;
      return;
    }
    const [r, g, b] = light.color;
    this.heroLightColor = (r << 16) | (g << 8) | b;
    // Fuel dims the glow's additive alpha; the pool keeps the item's full `radius` reach.
    this.heroLightAlpha = 0.35 + 0.65 * light.fuelFraction;
    this.heroLightRadius = light.radius;
  }

  private rebakeIfNeeded(
    cells: readonly ObservableCell[],
    floorId: string,
    town: boolean,
    hero: { x: number; y: number },
  ): void {
    // Hero-proximity occlusion stubs (see `occludedWallIndices`): folded into the key so the bake
    // rebuilds when the stub set changes as the hero moves, not just on terrain discovery.
    const occluded = occludedWallIndices(
      cells,
      this.floorWidth,
      this.floorHeight,
      floorId,
      this.atlas,
      BAKE_SCALE,
      town,
      hero,
    );
    const key = bakeKey(cells, floorId, occluded);
    if (key === this.currentBakeKey) return;
    this.currentBakeKey = key;

    const image = this.atlasImage;
    if (image === null) throw new Error('IsoRenderer.rebake called before the atlas image loaded');

    const plan = planFloorBake(
      cells,
      this.floorWidth,
      this.floorHeight,
      floorId,
      this.atlas,
      BAKE_SCALE,
      town,
      occluded,
    );
    const canvas = document.createElement('canvas');
    // `bakeFloor` fails loud on a null 2d context, so a missing context surfaces as a thrown error
    // rather than a floor that silently disappears.
    bakeFloor(canvas, image, plan);
    // `bakeKey` changes repeatedly during exploration (every newly discovered cell), so the outgoing
    // canvas-backed texture must be freed or GPU memory grows unbounded. Guard the initial empty one.
    const previous = this.floorSprite.texture;
    this.floorSprite.texture = Texture.from(canvas);
    if (previous && previous !== Texture.EMPTY) previous.destroy(true);
    this.floorSprite.position.set(-plan.originX, -plan.originY);
  }

  private atlasTexture(rect: AtlasRect): Texture {
    const base = this.atlasBaseTexture;
    if (base === null) throw new Error('IsoRenderer.atlasTexture called before the atlas loaded');
    return new Texture({
      source: base.source,
      frame: new Rectangle(rect.x, rect.y, rect.w, rect.h),
    });
  }

  /** A frame wrapper over a sprite-sheet base source, cached by `key` so each crop is allocated once
   * and destroyed once. Returns `null` before the base texture has loaded. */
  private spriteTexture(
    base: Texture | null,
    cache: Map<string, Texture>,
    key: string,
    rect: AtlasRect,
  ): Texture | null {
    if (base === null) return null;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const texture = new Texture({
      source: base.source,
      frame: new Rectangle(rect.x, rect.y, rect.w, rect.h),
    });
    cache.set(key, texture);
    return texture;
  }

  private rebuildFeatures(snapshot: SessionSnapshot): void {
    this.featuresContainer.removeChildren().forEach((child) => child.destroy());
    for (const feature of featuresOf(snapshot.projection)) {
      // An undiscovered secret projects as `terrain-cover` with no `state`; it blends into terrain
      // and gets neither sprite nor glyph.
      if (feature.state === undefined) continue;
      const mapped = this.featureSprite(feature);
      if (mapped) this.featuresContainer.addChild(mapped);
      else this.featuresContainer.addChild(this.featureGlyphDisplay(feature));
    }
  }

  /** The atlas sprite for a feature that has one: a door's closed leaf, a door's engaged lock (the
   * gate), or -- once the art ships -- an open-door archway. Every other feature (chests in any
   * state, revealed secrets, traps, open doors until arch art exists) returns `null` and renders a
   * glyph instead. The gate is deliberately restricted to doors so a LOCKED CHEST no longer inherits
   * the door gate. */
  private featureSprite(feature: FeatureView): Sprite | null {
    if (feature.type !== 'door') return null;
    let texture: Texture | null;
    let rect: AtlasRect;
    if (feature.state === 'closed') {
      texture = this.doorTexture;
      rect = this.atlas.door;
    } else if (feature.state === 'locked') {
      texture = this.gateTexture;
      rect = this.atlas.gate;
    } else if (feature.state === 'open' && this.atlas.archOpen !== undefined) {
      texture = this.archOpenTexture;
      rect = this.atlas.archOpen;
    } else {
      return null;
    }
    if (texture === null) return null;

    const sprite = new Sprite(texture);
    const dw = TILE_HALF_W * 2 * BAKE_SCALE;
    const dh = dw * (rect.h / rect.w);
    const [lx, ly] = this.isoLocal(feature.x, feature.y);
    // Foot-anchored like the baked wall cubes: the crop's bottom edge rests on the cell's
    // floor-diamond bottom corner so the standing feature rises above its floor.
    const bottomY = ly + TILE_HALF_H * BAKE_SCALE;
    sprite.width = dw;
    sprite.height = dh;
    sprite.position.set(lx - dw / 2, bottomY - dh);
    return sprite;
  }

  /** A shadow-ellipse + colored glyph for a feature with no mapped sprite, in the same visual style
   * as ground items and actors. `FeatureView` carries no glyph/color, so both fall back to a
   * sensible per-type default. */
  private featureGlyphDisplay(feature: FeatureView): Container {
    const { glyph, color } = featureGlyphStyle(feature.type);
    const container = new Container();

    const shadow = new Graphics();
    shadow.ellipse(0, TILE_HALF_H * 0.35, TILE_HALF_W * 0.5, TILE_HALF_H * 0.4);
    shadow.fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
    container.addChild(shadow);

    const text = new Text({
      text: glyph,
      style: { fill: color, fontFamily: 'monospace', fontSize: 24, fontWeight: 'bold' },
    });
    text.anchor.set(0.5, 1);
    text.position.set(0, TILE_HALF_H * 0.4);
    container.addChild(text);

    const [lx, ly] = this.isoLocal(feature.x, feature.y);
    container.position.set(lx, ly);
    return container;
  }

  private rebuildGroundItems(): void {
    this.itemsContainer.removeChildren().forEach((child) => child.destroy());
    const scene = this.scene;
    if (!scene) {
      this.itemDisplays = [];
      return;
    }
    const displays: ItemDisplay[] = [];
    for (const item of scene.groundItems) {
      const container = new Container();
      const [lx, ly] = this.isoLocal(item.x, item.y);
      container.position.set(lx, ly);

      // The shadow stays pinned to the ground; only the body bobs, so the widening gap between them
      // sells the hover.
      const shadow = new Graphics();
      shadow.ellipse(0, TILE_HALF_H * 0.35, TILE_HALF_W * 0.32, TILE_HALF_H * 0.3);
      shadow.fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
      container.addChild(shadow);

      const body = this.buildItemBody(item);
      container.addChild(body);
      this.itemsContainer.addChild(container);
      displays.push({ container, body, bodyBaseY: 0, x: item.x, y: item.y });
    }
    this.itemDisplays = displays;
  }

  /** A ground item's bob-able body: the atlas sprite (tinted only for a generic fallback sheet) when
   * one resolves, else the colored glyph. Centered on the cell. */
  private buildItemBody(item: GroundItemSprite): Container {
    const resolution = resolveItemSprite(item, this.itemAtlas);
    if (resolution !== null) {
      const key = item.contentId ?? `generic:${item.category}`;
      const texture = this.spriteTexture(
        this.itemBaseTexture,
        this.itemTextures,
        key,
        resolution.rect,
      );
      if (texture !== null) {
        const image = new Sprite(texture);
        image.anchor.set(0.5, 0.5);
        image.scale.set(ITEM_SPRITE_SCALE);
        if (resolution.tint !== undefined) image.tint = resolution.tint;
        image.position.set(0, 0);
        return image;
      }
    }

    const text = new Text({
      text: item.glyph,
      style: {
        fill: item.color ?? 0xffffff,
        fontFamily: 'monospace',
        fontSize: 22,
        fontWeight: 'bold',
      },
    });
    text.anchor.set(0.5, 0.5);
    text.position.set(0, 0);
    return text;
  }

  private rebuildActors(): void {
    this.actorsContainer.removeChildren().forEach((child) => child.destroy());
    const scene = this.scene;
    if (!scene) {
      this.actorDisplays = [];
      return;
    }
    const displays: ActorDisplay[] = [];
    for (const sprite of scene.actors) {
      const container = this.buildActorDisplay(sprite);
      this.actorsContainer.addChild(container);
      displays.push({ container, sprite });
    }
    this.actorDisplays = displays;
  }

  /** Drop-shadow ellipse + the actor body (atlas sprite when the contentId has art, else the colored
   * glyph) + a mini HP bar when hurt -- the port of the demo's `pHpBar` actor presentation. The
   * shadow and HP bar are identical for sprite and glyph; only the body differs. */
  private buildActorDisplay(sprite: ActorSprite): Container {
    const container = new Container();

    const shadow = new Graphics();
    shadow.ellipse(0, TILE_HALF_H * 0.35, TILE_HALF_W * 0.5, TILE_HALF_H * 0.4);
    shadow.fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
    container.addChild(shadow);

    const { node, topY } = this.buildActorBody(sprite);
    container.addChild(node);

    if (sprite.health < sprite.maxHealth && sprite.maxHealth > 0) {
      const fraction = Math.max(0, Math.min(1, sprite.health / sprite.maxHealth));
      const barW = TILE_HALF_W;
      const barH = 4;
      const barX = -barW / 2;
      const barY = topY - 6;
      const bar = new Graphics();
      bar.rect(barX, barY, barW, barH).fill({ color: HP_BAR_BG, alpha: 0.85 });
      bar
        .rect(barX, barY, barW * fraction, barH)
        .fill({ color: fraction > 0.4 ? HP_HIGH : HP_LOW });
      container.addChild(bar);
    }

    return container;
  }

  /** The actor's body node and the y of its top edge (for HP-bar placement). Prefers the atlas
   * sprite (foot-anchored to the cell floor, uniformly scaled so taller boss crops read bigger,
   * horizontally mirrored while facing right); falls back to the colored glyph when the contentId has
   * no art. */
  private buildActorBody(sprite: ActorSprite): { node: Container; topY: number } {
    const rect = resolveActorRect(sprite.contentId, this.actorAtlas);
    const texture =
      rect === null || sprite.contentId === null
        ? null
        : this.spriteTexture(this.actorBaseTexture, this.actorTextures, sprite.contentId, rect);
    if (rect !== null && texture !== null) {
      const image = new Sprite(texture);
      image.anchor.set(0.5, 1);
      const flip = sprite.facing === 'right' ? -1 : 1;
      image.scale.set(ACTOR_SPRITE_SCALE * flip, ACTOR_SPRITE_SCALE);
      image.position.set(0, ACTOR_FEET_Y);
      return { node: image, topY: ACTOR_FEET_Y - rect.h * ACTOR_SPRITE_SCALE };
    }

    const glyph = new Text({
      text: sprite.glyph,
      style: {
        fill: sprite.isHero ? 0xffe9a8 : (sprite.color ?? 0xffffff),
        fontFamily: 'monospace',
        fontSize: 28,
        fontWeight: 'bold',
      },
    });
    glyph.anchor.set(0.5, 1);
    glyph.position.set(0, ACTOR_FEET_Y);
    return { node: glyph, topY: ACTOR_FEET_Y - glyph.height };
  }

  private rebuildLights(cells: readonly ObservableCell[], hero: { x: number; y: number }): void {
    this.lightsContainer.removeChildren().forEach((child) => child.destroy());
    const gradient = this.gradientTexture;
    if (gradient === null) {
      this.lights = [];
      return;
    }
    const specs = lightsForFloor(cells, {
      x: hero.x,
      y: hero.y,
      lightRadius: this.heroLightRadius,
    });
    const displays: LightDisplay[] = [];
    specs.forEach((spec, index) => {
      const isHero = index === specs.length - 1;
      if (spec.radius <= 0) return;
      const sprite = new Sprite(gradient);
      sprite.anchor.set(0.5, 0.5);
      sprite.blendMode = 'add';
      sprite.tint = isHero ? this.heroLightColor : FIXTURE_LIGHT_COLOR;
      const diameter = lightPoolDiameterPx(spec.radius) * BAKE_SCALE;
      sprite.width = diameter;
      sprite.height = diameter;
      const [lx, ly] = this.isoLocal(spec.x, spec.y);
      sprite.position.set(lx, ly);
      this.lightsContainer.addChild(sprite);
      displays.push({ sprite, spec, isHero });
    });
    this.lights = displays;
  }

  private rebuildFov(cells: readonly ObservableCell[]): void {
    const visible = this.fovGraphics;
    const masked = this.fovOverpaint;
    visible.clear();
    masked.clear();
    for (const cell of cells) {
      const [cx, cy] = this.isoLocal(cell.x, cell.y);
      const diamond = [
        cx,
        cy - TILE_HALF_H,
        cx + TILE_HALF_W,
        cy,
        cx,
        cy + TILE_HALF_H,
        cx - TILE_HALF_W,
        cy,
      ];
      if (isFogMaskedTier(cell.knowledge)) {
        // Drawn into the overpaint layer, which composites AFTER the additive pools: `unknown`
        // renders pure black and `remembered` its fixed dim level, so a light pool spilling across
        // a corner can never brighten an unseen cell.
        const color = cell.knowledge === 'remembered' ? REMEMBERED_COLOR : 0x000000;
        masked.poly(diamond).fill({ color, alpha: 1 });
      } else {
        // A visible cell's BRIGHTNESS (white at alpha = visibleBrightness): the value the scene
        // multiplies against, floored so a visible cell is never darker than a remembered one, then
        // brightened further by the additive light pools layered on top.
        visible.poly(diamond).fill({ color: 0xffffff, alpha: visibleBrightness(cell.intensity) });
      }
    }
  }

  private redrawTargeting(): void {
    const graphics = this.targetingGraphics;
    graphics.clear();
    const visual = this.targeting;
    if (!visual) return;

    for (const key of visual.affectedCells) {
      const parsed = this.parseCellKey(key);
      if (parsed) this.drawTargetDiamond(graphics, parsed.x, parsed.y, 0xff6a3d, 0.35);
    }
    for (const key of visual.validCells) {
      const parsed = this.parseCellKey(key);
      if (parsed) this.drawTargetDiamond(graphics, parsed.x, parsed.y, 0x6ad1ff, 0.12);
    }
    if (visual.reticle) {
      this.drawTargetDiamond(graphics, visual.reticle.x, visual.reticle.y, 0xffffff, 0.2, true);
    }
  }

  private drawTargetDiamond(
    graphics: Graphics,
    x: number,
    y: number,
    color: number,
    fillAlpha: number,
    strong = false,
  ): void {
    const [cx, cy] = this.isoLocal(x, y);
    const diamond = [
      cx,
      cy - TILE_HALF_H,
      cx + TILE_HALF_W,
      cy,
      cx,
      cy + TILE_HALF_H,
      cx - TILE_HALF_W,
      cy,
    ];
    graphics.poly(diamond).fill({ color, alpha: fillAlpha });
    graphics.poly(diamond).stroke({ color, alpha: strong ? 1 : 0.8, width: strong ? 3 : 2 });
  }

  private parseCellKey(key: string): { x: number; y: number } | null {
    const [rawX, rawY] = key.split(',');
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  // --- per-frame tick ------------------------------------------------------

  private tick(ticker: Ticker): void {
    const app = this.app;
    const scene = this.scene;
    if (!app || !scene) return;

    const now = performance.now();
    const dt = ticker.deltaMS / 1000;

    this.easeCamera(scene, dt, now);
    const view = this.buildView(app);
    this.updateHurt(now);

    const [originX, originY] = worldToScreen(view, 0, 0);
    const baseX = originX + this.shakeX;
    const baseY = originY + this.shakeY;

    this.worldContainer.position.set(baseX, baseY);
    this.worldContainer.scale.set(ZOOM);
    this.overlayContainer.position.set(baseX, baseY);
    this.overlayContainer.scale.set(ZOOM);
    this.lightBuild.position.set(baseX, baseY);
    this.lightBuild.scale.set(ZOOM);

    this.updateActors(now);
    this.updateItems(scene, now);
    this.updateLights(now);
    this.updateDarknessCover(app, baseX, baseY);
    this.renderLightMap(app);
    this.updateVignette(app);
    this.updateEffects(now);
  }

  private easeCamera(scene: SceneState, dt: number, now: number): void {
    const hero = scene.actors.find((actor) => actor.isHero);
    if (!hero) return;
    const [hx, hy] = motionPosition(hero, now);
    const factor = Math.min(1, dt * CAMERA_EASE_PER_SECOND);
    this.camX += (hx - this.camX) * factor;
    this.camY += (hy - this.camY) * factor;
  }

  private buildView(app: Application): IsoView {
    return {
      camX: this.camX,
      camY: this.camY,
      zoom: ZOOM,
      viewW: app.screen.width,
      viewH: app.screen.height,
    };
  }

  private updateActors(now: number): void {
    for (const display of this.actorDisplays) {
      const [ax, ay] = motionPosition(display.sprite, now);
      const [lx, ly] = this.isoLocal(ax, ay);
      display.container.position.set(lx, ly);
      display.container.zIndex = ax + ay;
    }
  }

  /** Bob each ground item's body with a slow, position-seeded sine so items catch the eye without
   * bouncing. The shadow (a sibling of `body` in the container) is left untouched, so the hover reads
   * as the item floating off its own shadow. */
  private updateItems(scene: SceneState, now: number): void {
    for (const display of this.itemDisplays) {
      const offset = groundItemHoverOffset(scene.floorId, display.x, display.y, now);
      display.body.position.y = display.bodyBaseY - offset;
    }
  }

  private updateLights(now: number): void {
    for (const light of this.lights) {
      if (light.isHero) {
        light.sprite.alpha = this.heroLightAlpha * light.spec.intensity;
        continue;
      }
      const flicker = 0.8 + 0.2 * Math.sin(now * FLICKER_SPEED + light.spec.flickerSeed);
      light.sprite.alpha = light.spec.intensity * flicker;
    }
  }

  private updateDarknessCover(app: Application, baseX: number, baseY: number): void {
    // The quad lives inside the (camera-translated, zoomed) lightBuild container but must cover the
    // whole screen, so map screen (0,0)..(w,h) back into the container's local space.
    this.darknessQuad.position.set(-baseX / ZOOM, -baseY / ZOOM);
    this.darknessQuad.width = app.screen.width / ZOOM;
    this.darknessQuad.height = app.screen.height / ZOOM;
  }

  private renderLightMap(app: Application): void {
    const lightMap = this.lightMap;
    if (!lightMap) return;
    app.renderer.render({ container: this.lightBuild, target: lightMap, clear: true });
  }

  private updateHurt(now: number): void {
    const hurtAt = this.hurtAt;
    if (hurtAt === null) {
      this.shakeX = 0;
      this.shakeY = 0;
      return;
    }
    const elapsed = now - hurtAt;
    if (elapsed < 0 || elapsed >= HURT_DURATION_MS) {
      this.shakeX = 0;
      this.shakeY = 0;
      return;
    }
    const decay = 1 - elapsed / HURT_DURATION_MS;
    const magnitude = HURT_SHAKE_MAX_PX * decay;
    this.shakeX = (Math.random() * 2 - 1) * magnitude;
    this.shakeY = (Math.random() * 2 - 1) * magnitude;
  }

  private updateVignette(app: Application): void {
    const hurtAt = this.hurtAt;
    this.vignetteSprite.width = app.screen.width;
    this.vignetteSprite.height = app.screen.height;
    if (hurtAt === null) {
      this.vignetteSprite.alpha = 0;
      return;
    }
    const elapsed = performance.now() - hurtAt;
    if (elapsed < 0 || elapsed >= HURT_DURATION_MS) {
      this.vignetteSprite.alpha = 0;
      return;
    }
    this.vignetteSprite.alpha = HURT_VIGNETTE_MAX_ALPHA * (1 - elapsed / HURT_DURATION_MS);
  }

  // --- transient combat effects ---------------------------------------------

  /** Spawns a particle burst (and, for hit/death, a floating glyph) for every effect this renderer
   * has not already spawned for THIS generation, per `selectNewEffects` (see its doc comment in
   * `particles.ts` for why the dedup key is salted by `snapshotGeneration` rather than the raw
   * `effect.key`). */
  private spawnNewEffects(effects: readonly TransientEffect[], now: number): void {
    const decision = selectNewEffects(
      effects,
      this.snapshotGeneration,
      this.seenEffectKeys,
      MAX_TRANSIENT_EFFECTS,
    );
    this.seenEffectKeys = decision.seenKeys;

    for (const effect of decision.newEffects) {
      this.particles = [...this.particles, ...spawnForEffect(effect, now)];
      if (effect.kind === 'hit-flash' || effect.kind === 'death-burst') {
        this.spawnDamageFloat(effect, now);
      }
    }
  }

  private spawnDamageFloat(effect: TransientEffect, now: number): void {
    const isDeath = effect.kind === 'death-burst';
    const text = new Text({
      text: isDeath ? DEATH_BURST_GLYPH : HIT_FLASH_GLYPH,
      style: {
        fill: isDeath ? DEATH_BURST_TEXT_COLOR : HIT_FLASH_TEXT_COLOR,
        fontFamily: 'monospace',
        fontSize: 16,
        fontWeight: 'bold',
      },
    });
    text.anchor.set(0.5, 1);
    const [lx, ly] = this.isoLocal(effect.x, effect.y);
    const baseY = ly - TILE_HALF_H;
    text.position.set(lx, baseY);
    this.effectsContainer.addChild(text);
    this.damageFloats = [...this.damageFloats, { text, bornAt: now, baseY }];
  }

  private updateEffects(now: number): void {
    this.particles = stepParticles(this.particles, now);
    this.drawParticles(now);
    this.updateDamageFloats(now);
  }

  private drawParticles(now: number): void {
    const normal = this.particleGraphicsNormal;
    const additive = this.particleGraphicsAdditive;
    normal.clear();
    additive.clear();
    for (const particle of this.particles) {
      const age = now - particle.bornAt;
      const alpha = Math.max(0, Math.min(1, 1 - age / particle.ttlMs));
      if (alpha <= 0) continue;
      const graphics = particle.additive ? additive : normal;
      graphics
        .circle(particle.x, particle.y - particle.z, particle.size)
        .fill({ color: particle.color, alpha });
    }
  }

  private updateDamageFloats(now: number): void {
    const remaining: DamageFloat[] = [];
    for (const damageFloat of this.damageFloats) {
      const age = now - damageFloat.bornAt;
      if (age >= DAMAGE_FLOAT_TTL_MS) {
        damageFloat.text.destroy();
        continue;
      }
      const progress = age / DAMAGE_FLOAT_TTL_MS;
      damageFloat.text.position.y = damageFloat.baseY - DAMAGE_FLOAT_RISE_PX * progress;
      damageFloat.text.alpha = 1 - progress;
      remaining.push(damageFloat);
    }
    this.damageFloats = remaining;
  }

  // --- input ---------------------------------------------------------------

  private handlePointerDown(event: PointerEvent): void {
    const cell = this.cellFromPointer(event);
    if (!cell) return;
    const button: 'primary' | 'secondary' = event.button === 2 ? 'secondary' : 'primary';
    this.callbacks.onCellClick(cell, button);
  }

  private handlePointerMove(event: PointerEvent): void {
    const cell = this.cellFromPointer(event);
    if (!cell) {
      this.callbacks.onCellHover(null);
      return;
    }
    this.callbacks.onCellHover({ cell, clientX: event.clientX, clientY: event.clientY });
  }

  private cellFromPointer(event: PointerEvent): { x: number; y: number } | null {
    const app = this.app;
    if (!app) return null;
    const view = this.buildView(app);
    return cellAtScreen(view, event.offsetX, event.offsetY, this.floorWidth, this.floorHeight);
  }

  // --- geometry ------------------------------------------------------------

  /** Iso-local (camera- and zoom-agnostic) pixel position of a grid cell's diamond anchor. The
   * world/overlay/light containers carry the camera translation and zoom, so children use this. */
  private isoLocal(x: number, y: number): readonly [number, number] {
    return [(x - y) * TILE_HALF_W * BAKE_SCALE, (x + y) * TILE_HALF_H * BAKE_SCALE];
  }
}
