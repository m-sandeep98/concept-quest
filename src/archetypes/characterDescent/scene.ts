// PixiJS renderer for the character-descent archetype. This is the RENDERER, not
// the logic: it consumes the pure engine's `TraceEvent[]` and animates a character
// down/up a well. All game truth lives in engine.ts; this file only draws it.
//
// Written as a plain imperative controller (no React) so the component stays a thin
// wrapper. It self-hosts everything Pixi needs — no network, no CDN (works offline).

import { Application, Container, Graphics, Text } from "pixi.js";
import type { TraceEvent } from "./engine";

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const TAG_FONT = '"JetBrains Mono","SFMono-Regular",monospace';

export interface SceneConfig {
  actorIcon: string; // the character glyph, from theme.visual.actorIcon (DATA)
  coreIcon: string; // the treasure/base-case glyph, from theme.visual.coreIcon (DATA)
  accent: number; // 0xRRGGBB, parsed from theme.visual.accent (DATA)
  depthLabel: string; // vocab.depthLabel, e.g. "n"
  reducedMotion: boolean;
}

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeIn = (p: number) => p * p;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// A single animation beat, expanded from a TraceEvent with resolved positions.
interface Beat {
  ev: TraceEvent;
  toY: number;
  dur: number;
  dwell: number;
}

export class DescentScene {
  private app: Application | null = null;
  private destroyed = false;

  private readonly root = new Container(); // shaken as a whole on overflow
  private readonly world = new Container(); // ledges + shaft
  private readonly ledgeG = new Graphics();
  private readonly highlight = new Graphics();
  private readonly ring = new Graphics(); // gem-grab shockwave
  private readonly flash = new Graphics(); // red overflow vignette
  private core!: Text;
  private actor!: Text;
  private tag!: Text;

  private readonly W = 660;
  private readonly H = 384;
  private readonly topY = 60;
  private readonly botMargin = 56;
  private startDepth = 1;
  private centerX = this.W / 2;

  // playback
  private queue: Beat[] = [];
  private beat: Beat | null = null;
  private fromY = 0;
  private t = 0;
  private waiting = 0;
  private onDone: (() => void) | null = null;
  private playing = false;

  // effects
  private idleT = 0;
  private shake = 0;
  private ringT = -1; // -1 = inactive, else 0..1
  private flashA = 0;
  private grabbed = false;
  private glow = 0;

  constructor(private cfg: SceneConfig) {}

  async init(container: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      width: this.W,
      height: this.H,
      backgroundAlpha: 0, // sit on the panel's dark backdrop
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    if (this.destroyed) {
      // Unmounted before async init resolved — tear the fresh app down immediately.
      app.destroy(true, { children: true });
      return;
    }
    this.app = app;
    const canvas = app.canvas;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.maxWidth = `${this.W}px`;
    canvas.style.display = "block";
    canvas.style.margin = "0 auto";
    container.appendChild(canvas);

    this.core = this.makeText(this.cfg.coreIcon, 30);
    this.actor = this.makeText(this.cfg.actorIcon, 40);
    this.tag = new Text({
      text: "",
      style: { fontFamily: TAG_FONT, fontSize: 13, fill: this.cfg.accent, fontWeight: "700" },
    });
    this.tag.anchor.set(0, 0.5);

    this.world.addChild(this.ledgeG, this.highlight, this.core);
    this.root.addChild(this.world, this.ring, this.actor, this.tag, this.flash);
    app.stage.addChild(this.root);

    app.ticker.add((tk) => this.tick(tk.deltaMS));
  }

  private makeText(str: string, size: number): Text {
    const t = new Text({ text: str, style: { fontFamily: EMOJI_FONT, fontSize: size } });
    t.anchor.set(0.5);
    return t;
  }

  /** Vertical position of well level `depth`. depth=startDepth is at top, 0 at bottom. */
  private yFor(depth: number): number {
    const usable = this.H - this.topY - this.botMargin;
    const gap = usable / Math.max(this.startDepth, 1);
    return this.topY + (this.startDepth - depth) * gap;
  }

  /** Draw the static well for a given depth, character resting at the top. */
  idle(startDepth: number): void {
    this.startDepth = Math.max(1, startDepth);
    this.resetEffects();
    this.playing = false;
    this.queue = [];
    this.beat = null;
    this.drawWell();
    this.grabbed = false;
    this.core.alpha = 0.32;
    this.actor.alpha = 1;
    this.actor.scale.set(1);
    this.placeActor(this.startDepth);
    this.highlight.visible = false;
  }

  private drawWell(): void {
    const g = this.ledgeG;
    g.clear();
    const w = 300;
    const x = this.centerX - w / 2;

    // Shaft walls — two faint verticals connecting all levels.
    const top = this.yFor(this.startDepth);
    const bot = this.yFor(0);
    g.moveTo(x + 16, top).lineTo(x + 16, bot).stroke({ width: 2, color: this.cfg.accent, alpha: 0.14 });
    g.moveTo(x + w - 16, top).lineTo(x + w - 16, bot).stroke({ width: 2, color: this.cfg.accent, alpha: 0.14 });

    // A ledge per level, bottom one is the core chamber.
    for (let d = this.startDepth; d >= 0; d -= 1) {
      const y = this.yFor(d);
      const isCore = d === 0;
      g.roundRect(x, y - 15, w, 30, 8)
        .fill({ color: isCore ? 0x111834 : 0x0a0f1e, alpha: 0.92 })
        .stroke({ width: 1.5, color: this.cfg.accent, alpha: isCore ? 0.6 : 0.28 });
    }
    // Position the core glyph on the bottom ledge.
    this.core.position.set(this.centerX, this.yFor(0));
    // Depth tags are drawn live on the following tag (single tag) — clear leftover.
  }

  private placeActor(depth: number): void {
    this.actor.position.set(this.centerX, this.yFor(depth) - 22);
    this.tag.text = `${this.cfg.depthLabel} = ${depth}`;
    this.tag.position.set(this.centerX + 26, this.yFor(depth) - 22);
    this.highlight.visible = true;
    this.drawHighlight(depth);
  }

  private drawHighlight(depth: number): void {
    const w = 300;
    const x = this.centerX - w / 2;
    const y = this.yFor(depth);
    this.highlight.clear();
    this.highlight.roundRect(x - 3, y - 18, w + 6, 36, 10).stroke({ width: 2, color: this.cfg.accent, alpha: 0.95 });
  }

  /** Play an engine trace. Resolves via `onDone` after the last beat settles. */
  play(trace: TraceEvent[], onDone: () => void): void {
    this.resetEffects();
    this.onDone = onDone;
    this.grabbed = false;
    this.core.alpha = 0.32;
    this.actor.alpha = 1;
    this.actor.scale.set(1);

    const rm = this.cfg.reducedMotion;
    const moveDur = rm ? 1 : 340;
    const beats: Beat[] = trace.map((ev) => {
      if (ev.type === "overflow") {
        return { ev, toY: this.H + 140, dur: rm ? 1 : 620, dwell: rm ? 60 : 260 };
      }
      const restY = this.yFor(ev.depth) - 22;
      if (ev.type === "base") return { ev, toY: restY, dur: 1, dwell: rm ? 120 : 520 };
      return { ev, toY: restY, dur: moveDur, dwell: rm ? 80 : 150 };
    });

    // Start the character at the top level so the first descent reads clearly.
    this.placeActor(this.startDepth);
    this.actor.y = this.yFor(this.startDepth) - 22;
    this.queue = beats;
    this.beat = null;
    this.waiting = 0;
    this.playing = true;
    this.nextBeat();
  }

  private nextBeat(): void {
    const next = this.queue.shift();
    if (!next) {
      this.playing = false;
      const cb = this.onDone;
      this.onDone = null;
      if (cb) cb();
      return;
    }
    this.beat = next;
    this.fromY = this.actor.y;
    this.t = 0;
    // Update the depth tag/highlight to the level being acted on.
    if (next.ev.type !== "overflow") {
      this.tag.text = `${this.cfg.depthLabel} = ${next.ev.depth}`;
      this.drawHighlight(next.ev.depth);
      this.highlight.visible = true;
    }
  }

  private finishBeat(b: Beat): void {
    if (b.ev.type === "base") {
      this.grabbed = true;
      this.core.alpha = 1;
      this.ringT = 0; // fire the shockwave
    } else if (b.ev.type === "overflow") {
      this.shake = this.cfg.reducedMotion ? 0 : 1;
      this.flashA = this.cfg.reducedMotion ? 0 : 0.5;
      this.actor.alpha = 0.15;
      this.highlight.visible = false;
    }
  }

  private resetEffects(): void {
    this.shake = 0;
    this.ringT = -1;
    this.flashA = 0;
    this.glow = 0;
    this.ring.clear();
    this.flash.clear();
    this.root.position.set(0, 0);
  }

  private tick(dtMS: number): void {
    if (!this.app) return;
    const dt = Math.min(dtMS, 50); // clamp on tab-refocus so nothing teleports

    // Idle bob when not actively playing.
    if (!this.playing) {
      this.idleT += dt / 1000;
      const baseY = this.yFor(this.startDepth) - 22;
      if (this.actor && !this.grabbed) this.actor.y = baseY + Math.sin(this.idleT * 2) * 3;
    }

    // Advance the current beat / dwell.
    if (this.playing) {
      if (this.beat) {
        const b = this.beat;
        this.t += dt;
        const p = Math.min(this.t / b.dur, 1);
        const eased = b.ev.type === "overflow" ? easeIn(p) : easeInOut(p);
        this.actor.y = lerp(this.fromY, b.toY, eased);
        // little squash as the character lands a descent step
        if (b.ev.type === "call") this.actor.scale.set(1, lerp(1, 0.86, Math.sin(p * Math.PI)));
        if (p >= 1) {
          this.actor.scale.set(1);
          this.finishBeat(b);
          this.beat = null;
          this.waiting = b.dwell;
        }
      } else if (this.waiting > 0) {
        this.waiting -= dt;
      } else {
        this.nextBeat();
      }
    }

    // Gem-grab shockwave ring.
    if (this.ringT >= 0) {
      this.ringT += dt / 520;
      if (this.ringT >= 1) {
        this.ringT = -1;
        this.ring.clear();
      } else {
        const r = lerp(10, 70, this.ringT);
        this.ring.clear();
        this.ring.circle(this.centerX, this.yFor(0), r).stroke({ width: 3, color: this.cfg.accent, alpha: 1 - this.ringT });
      }
    }
    // Grabbed core pulse.
    if (this.grabbed && this.core) {
      this.glow += dt / 1000;
      this.core.scale.set(1 + Math.sin(this.glow * 4) * 0.12);
    }

    // Overflow screen shake (decaying).
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt / 520);
      const amp = 10 * this.shake;
      this.root.position.set(Math.sin(this.shake * 60) * amp, Math.cos(this.shake * 47) * amp * 0.6);
    } else if (this.root.position.x !== 0 || this.root.position.y !== 0) {
      this.root.position.set(0, 0);
    }
    // Red overflow flash fade.
    if (this.flashA > 0) {
      this.flashA = Math.max(0, this.flashA - dt / 900);
      this.flash.clear();
      this.flash.rect(0, 0, this.W, this.H).fill({ color: 0xff2b4d, alpha: this.flashA * 0.5 });
    } else if (this.flash.width > 0) {
      this.flash.clear();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
  }
}
