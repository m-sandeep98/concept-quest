// PixiJS renderer for the binary-search archetype. RENDERER only — all grading lives
// in engine.ts. Unlike the descent (assemble-then-play), this scene is INTERACTIVE:
// each vault is a clickable Pixi container that reports probes back to the component,
// and the still-possible range visibly narrows as feedback comes in.

import { Application, Container, Graphics, Text } from "pixi.js";
import type { Dir } from "./engine";

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const NUM_FONT = '"JetBrains Mono","SFMono-Regular",monospace';

export interface SceneConfig {
  actorIcon: string;
  coreIcon: string; // shown on the found vault
  accent: number; // 0xRRGGBB
  reducedMotion: boolean;
  higherLabel: string; // vocab, e.g. "higher"
  lowerLabel: string; // vocab, e.g. "lower"
}

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Vault {
  cell: Container;
  bg: Graphics;
  label: Text;
  cx: number;
  top: number;
  w: number;
  h: number;
}

type Walk = {
  fromX: number;
  toX: number;
  t: number;
  dur: number;
  index: number;
  dir: Dir;
  lo: number;
  hi: number;
  onDone: () => void;
};

export class SearchScene {
  private app: Application | null = null;
  private destroyed = false;

  private readonly root = new Container();
  private readonly row = new Container();
  private readonly arrow = new Text({ text: "", style: { fontFamily: NUM_FONT, fontSize: 15, fontWeight: "700", fill: 0xffffff } });
  private readonly ring = new Graphics();
  private actor!: Text;

  private readonly W = 680;
  private readonly H = 296;
  private vaults: Vault[] = [];
  private opened = new Set<number>();
  private foundIndex = -1;
  private onProbe: ((i: number) => void) | null = null;
  private busy = false;

  // animation
  private walk: Walk | null = null;
  private dwell = 0;
  private pendingDone: (() => void) | null = null;
  private charBaseY = 0;
  private idleT = 0;
  private arrowT = -1;
  private ringT = -1;
  private ringXY = { x: 0, y: 0 };
  private celebrate = 0;

  constructor(private cfg: SceneConfig) {}

  async init(container: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      width: this.W,
      height: this.H,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    if (this.destroyed) {
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

    this.actor = new Text({ text: this.cfg.actorIcon, style: { fontFamily: EMOJI_FONT, fontSize: 38 } });
    this.actor.anchor.set(0.5, 1);
    this.arrow.anchor.set(0.5, 0.5);
    this.arrow.alpha = 0;

    this.root.addChild(this.row, this.ring, this.arrow, this.actor);
    app.stage.addChild(this.root);
    app.ticker.add((tk) => this.tick(tk.deltaMS));
  }

  /** Build the vault row for a level and enable probing. */
  setup(values: number[], _targetIndex: number, onProbe: (i: number) => void): void {
    this.onProbe = onProbe;
    this.opened.clear();
    this.foundIndex = -1;
    this.busy = false;
    this.walk = null;
    this.dwell = 0;
    this.arrow.alpha = 0;
    this.arrowT = -1;
    this.ringT = -1;
    this.celebrate = 0;
    this.ring.clear();
    this.row.removeChildren();
    this.vaults = [];

    const n = values.length;
    const margin = 34;
    const gap = 8;
    const w = Math.min(74, (this.W - 2 * margin - gap * (n - 1)) / n);
    const h = 64;
    const totalW = n * w + (n - 1) * gap;
    const startX = (this.W - totalW) / 2;
    const rowY = this.H * 0.66;
    const top = rowY - h / 2;
    this.charBaseY = top - 14;

    for (let i = 0; i < n; i += 1) {
      const cx = startX + i * (w + gap) + w / 2;
      const bg = new Graphics();
      const label = new Text({
        text: String(values[i]),
        style: { fontFamily: NUM_FONT, fontSize: Math.min(18, w * 0.34), fontWeight: "700", fill: 0x9fb2d8 },
      });
      label.anchor.set(0.5);
      label.position.set(cx, rowY);
      const cell = new Container();
      cell.addChild(bg, label);
      cell.eventMode = "static";
      cell.cursor = "pointer";
      cell.hitArea = { contains: (x: number, y: number) => x >= cx - w / 2 && x <= cx + w / 2 && y >= top && y <= top + h } as never;
      const idx = i;
      cell.on("pointertap", () => {
        if (!this.busy && this.foundIndex < 0) this.onProbe?.(idx);
      });
      this.row.addChild(cell);
      this.vaults.push({ cell, bg, label, cx, top, w, h });
    }

    // Character waits above the middle vault.
    const mid = this.vaults[Math.floor((n - 1) / 2)];
    this.actor.position.set(mid.cx, this.charBaseY);
    this.restyle(0, n - 1);
  }

  private restyle(lo: number, hi: number): void {
    this.vaults.forEach((v, i) => {
      const excluded = i < lo || i > hi;
      const found = i === this.foundIndex;
      const open = this.opened.has(i);
      let fill = 0x0a0f1e;
      let fillA = 0.95;
      let stroke = this.cfg.accent;
      let strokeA = 0.32;
      let labelColor = 0x9fb2d8;
      let labelA = 1;
      if (found) {
        fill = this.cfg.accent;
        fillA = 0.92;
        strokeA = 1;
        labelColor = 0x041018;
      } else if (excluded) {
        fillA = 0.45;
        strokeA = 0.1;
        labelColor = 0x9fb2d8;
        labelA = 0.28;
      } else if (open) {
        fill = 0x111834;
        strokeA = 0.75;
        labelColor = this.cfg.accent;
      }
      v.bg.clear();
      v.bg.roundRect(v.cx - v.w / 2, v.top, v.w, v.h, 9).fill({ color: fill, alpha: fillA }).stroke({ width: 1.5, color: stroke, alpha: strokeA });
      // a "lid" line so a closed vault reads as shut
      if (!open && !found) {
        v.bg.moveTo(v.cx - v.w / 2 + 6, v.top + 16).lineTo(v.cx + v.w / 2 - 6, v.top + 16).stroke({ width: 1, color: this.cfg.accent, alpha: strokeA * 0.7 });
      }
      v.label.style.fill = labelColor;
      v.label.alpha = labelA;
    });
  }

  /** Animate the character to `index`, open it, show feedback, narrow to [lo,hi]. */
  reveal(index: number, dir: Dir, lo: number, hi: number, onDone: () => void): void {
    this.busy = true;
    const rm = this.cfg.reducedMotion;
    this.walk = {
      fromX: this.actor.x,
      toX: this.vaults[index].cx,
      t: 0,
      dur: rm ? 1 : 360,
      index,
      dir,
      lo,
      hi,
      onDone,
    };
  }

  private landWalk(w: Walk): void {
    this.opened.add(w.index);
    if (w.dir === "found") this.foundIndex = w.index;
    this.restyle(w.lo, w.hi);

    const v = this.vaults[w.index];
    if (w.dir === "found") {
      this.celebrate = this.cfg.reducedMotion ? 0 : 1;
      this.ringXY = { x: v.cx, y: v.top + v.h / 2 };
      this.ringT = this.cfg.reducedMotion ? -1 : 0;
      // swap the label to the treasure glyph
      v.label.text = this.cfg.coreIcon;
      v.label.style.fontFamily = EMOJI_FONT;
      this.arrow.alpha = 0;
    } else {
      const up = w.dir === "higher";
      this.arrow.text = up ? `▲ ${this.cfg.higherLabel}` : `▼ ${this.cfg.lowerLabel}`;
      this.arrow.style.fill = this.cfg.accent;
      this.arrow.position.set(v.cx, v.top - 20);
      this.arrowT = this.cfg.reducedMotion ? 1 : 0;
    }
    this.dwell = this.cfg.reducedMotion ? 40 : w.dir === "found" ? 420 : 300;
    this.pendingDone = w.onDone;
  }

  reset(values: number[], targetIndex: number, onProbe: (i: number) => void): void {
    this.setup(values, targetIndex, onProbe);
  }

  private tick(dtMS: number): void {
    if (!this.app || !this.vaults.length) return;
    const dt = Math.min(dtMS, 50);

    if (this.walk) {
      const w = this.walk;
      w.t += dt;
      const p = Math.min(w.t / w.dur, 1);
      const e = easeInOut(p);
      this.actor.x = lerp(w.fromX, w.toX, e);
      this.actor.y = this.charBaseY - Math.sin(p * Math.PI) * 16; // hop
      if (p >= 1) {
        this.actor.y = this.charBaseY;
        this.walk = null;
        this.landWalk(w);
      }
    } else if (this.dwell > 0) {
      this.dwell -= dt;
      if (this.dwell <= 0 && this.pendingDone) {
        const cb = this.pendingDone;
        this.pendingDone = null;
        this.busy = false;
        cb();
      }
    } else if (this.foundIndex < 0 && this.busy === false) {
      // idle bob while waiting for the player's next probe
      this.idleT += dt / 1000;
      this.actor.y = this.charBaseY + Math.sin(this.idleT * 2) * 2.5;
    }

    // feedback arrow pop-in then hold
    if (this.arrowT >= 0 && this.arrowT < 1) {
      this.arrowT = Math.min(1, this.arrowT + dt / 180);
      this.arrow.alpha = this.arrowT;
      this.arrow.scale.set(lerp(0.6, 1, easeInOut(this.arrowT)));
    }

    // found shockwave
    if (this.ringT >= 0) {
      this.ringT += dt / 560;
      if (this.ringT >= 1) {
        this.ringT = -1;
        this.ring.clear();
      } else {
        const r = lerp(14, 90, this.ringT);
        this.ring.clear();
        this.ring.circle(this.ringXY.x, this.ringXY.y, r).stroke({ width: 3, color: this.cfg.accent, alpha: 1 - this.ringT });
      }
    }
    // winner celebration hop
    if (this.celebrate > 0) {
      this.celebrate = Math.max(0, this.celebrate - dt / 900);
      this.actor.y = this.charBaseY - Math.abs(Math.sin(this.celebrate * 12)) * 14;
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
