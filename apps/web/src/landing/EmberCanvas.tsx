import { useEffect, useRef, type JSX } from 'react';

export type EmberStyle = 'both' | 'ember' | 'dust';

export interface EmberCanvasProps {
  /** Design-time tweak, per the handoff's `emberStyle` prop: `'both'` mixes sparks and motes,
   * `'ember'` is sparks-only, `'dust'` is motes-only. Defaults to `'both'`. */
  readonly emberStyle?: EmberStyle;
  /** Test-only escape hatch mirroring the handoff's `motion` prop: forces the reduced-motion
   * path regardless of the `prefers-reduced-motion` media query, so tests can assert the canvas
   * renders inertly without depending on jsdom's (nonexistent) media-query evaluation. */
  readonly motion?: boolean;
}

interface Particle {
  spark: boolean;
  x: number;
  y: number;
  r: number;
  vy: number;
  axAmp: number;
  ayAmp: number;
  axF: number;
  ayF: number;
  phX: number;
  phY: number;
  tw: number;
  twF: number;
  peak: number;
  age: number;
  life: number;
}

// Real embers cool as they rise: white-hot -> yellow -> orange -> deep red.
const RAMP: readonly [number, number, number, number][] = [
  [0, 255, 247, 222],
  [0.18, 255, 208, 124],
  [0.42, 249, 160, 70],
  [0.68, 226, 108, 46],
  [1, 152, 48, 26],
];

function heatColor(u: number): string {
  if (u <= 0) return '255,247,222';
  if (u >= 1) return '152,48,26';
  for (let i = 1; i < RAMP.length; i += 1) {
    const [stop, r, g, b] = RAMP[i]!;
    if (u <= stop) {
      const [prevStop, pr, pg, pb] = RAMP[i - 1]!;
      const f = (u - prevStop) / (stop - prevStop);
      return `${Math.round(pr + (r - pr) * f)},${Math.round(pg + (g - pg) * f)},${Math.round(pb + (b - pb) * f)}`;
    }
  }
  return '152,48,26';
}

/**
 * The signature hearth-ember particle system: fixed full-viewport canvas behind the page content,
 * `globalCompositeOperation:'lighter'` additive blending. Particles rise from the bottom of the
 * frame with slow 2-axis sinusoidal sway (never a straight jet), smear into motion-blur streaks
 * proportional to their speed, cool from white-hot to deep red as they age, and fade toward the
 * top of the frame (brightest at the hearth). Re-seeds its particle count on resize; cancels its
 * rAF loop and removes its listeners on unmount, so no stray animation frame outlives the page.
 */
export function EmberCanvas({ emberStyle = 'both', motion }: EmberCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduce =
      motion === false ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
    if (reduce) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sparkChance = emberStyle === 'ember' ? 0.55 : emberStyle === 'dust' ? 0 : 0.42;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];

    const spawn = (seeded: boolean): Particle => {
      const spark = Math.random() < sparkChance;
      const life = spark ? 420 + Math.random() * 420 : 900 + Math.random() * 900;
      return {
        spark,
        x: Math.random() * width,
        y: seeded ? height * 0.5 + Math.random() * height * 0.55 : height + Math.random() * 26 + 4,
        r: spark ? Math.random() * 1.0 + 0.5 : Math.random() * 1.1 + 0.5,
        vy: spark ? -(Math.random() * 0.26 + 0.12) : -(Math.random() * 0.13 + 0.045),
        axAmp: (spark ? 0.11 : 0.16) * (0.5 + Math.random()),
        ayAmp: (spark ? 0.05 : 0.11) * (0.5 + Math.random()),
        axF: 0.004 + Math.random() * 0.01,
        ayF: 0.003 + Math.random() * 0.008,
        phX: Math.random() * Math.PI * 2,
        phY: Math.random() * Math.PI * 2,
        tw: Math.random() * Math.PI * 2,
        twF: spark ? 0.05 + Math.random() * 0.1 : 0.006 + Math.random() * 0.014,
        peak: spark ? Math.random() * 0.42 + 0.45 : Math.random() * 0.14 + 0.09,
        age: seeded ? Math.random() * life : 0,
        life,
      };
    };

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const reseed = () => {
      const count = Math.round(Math.min(100, Math.max(44, width / 15)));
      particles = Array.from({ length: count }, () => spawn(true));
    };
    resize();
    reseed();

    let raf = 0;
    const loop = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        p.age += 1;
        p.phX += p.axF;
        p.phY += p.ayF;
        p.tw += p.twF;
        const px = p.x;
        const py = p.y;
        p.x += Math.cos(p.phX) * p.axAmp;
        p.y += p.vy + Math.sin(p.phY) * p.ayAmp;

        if (p.age >= p.life || p.y < -18 || p.x < -18 || p.x > width + 18) {
          Object.assign(p, spawn(false));
          continue;
        }

        const t = p.age / p.life;
        let envelope = 1;
        if (t < 0.14) envelope = t / 0.14;
        else if (t > 0.72) envelope = Math.max(0, (1 - t) / 0.28);
        const flicker = p.spark
          ? (0.5 + 0.5 * Math.sin(p.tw)) * (0.85 + 0.15 * Math.sin(p.tw * 2.7))
          : 0.78 + 0.22 * Math.sin(p.tw);
        const verticalFalloff = Math.min(1, Math.max(0, p.y / height));
        const alpha =
          p.peak * envelope * flicker * (0.08 + 0.92 * verticalFalloff * verticalFalloff);
        if (alpha <= 0.003) continue;

        const dx = p.x - px;
        const dy = p.y - py;
        const speed = Math.hypot(dx, dy) || 0.0001;
        const col = heatColor(t);
        const streakLen = Math.min(p.spark ? 22 : 5, speed * (p.spark ? 26 : 11));
        if (streakLen > 1.4) {
          const nx = dx / speed;
          const ny = dy / speed;
          const gradient = ctx.createLinearGradient(
            p.x,
            p.y,
            p.x - nx * streakLen,
            p.y - ny * streakLen,
          );
          gradient.addColorStop(0, `rgba(${col},${alpha})`);
          gradient.addColorStop(1, `rgba(${col},0)`);
          ctx.strokeStyle = gradient;
          ctx.lineWidth = Math.max(0.8, p.r * (p.spark ? 1.5 : 1));
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - nx * streakLen, p.y - ny * streakLen);
          ctx.stroke();
        }

        const headRadius = p.r * (p.spark ? 5.5 : 3.4);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, headRadius);
        glow.addColorStop(0, `rgba(${col},${alpha * 0.78})`);
        glow.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, headRadius, 0, Math.PI * 2);
        ctx.fill();

        if (p.spark) {
          ctx.fillStyle = `rgba(255,244,216,${Math.min(1, alpha * 1.05)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => {
      resize();
      reseed();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [emberStyle, motion]);

  return <canvas ref={canvasRef} aria-hidden="true" className="ember-canvas" />;
}
