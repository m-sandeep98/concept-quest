// PixiJS renderer for the state-traversal (finite-state-machine) archetype. RENDERER
// only — every verdict lives in engine.ts. It draws the machine as a directed graph:
// states are circles laid out deterministically on an ellipse, transition arrows are
// labeled curves between them, the start state wears an entry stub, accepting states get
// a double ring, and a TAPE across the top shows the input string with a cursor. The
// character (actor) is the token standing on the current state; playHop() glides it along
// a hop. Valid hops taken so far light up in accent; a wrong/stuck attempt draws a red
// dashed arrow to the state the player illegally walked to.

import { Application, Container, Graphics, Text } from "pixi.js";
import type { StateTraversalLevel, StepTrace, Outcome } from "./engine";

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const NUM_FONT = '"JetBrains Mono","SFMono-Regular",monospace';

const OK = 0x3ad0b0; // valid / accepting green
const BAD = 0xff5a6a; // illegal hop / rejection red
const DIM = 0x9fb2d8; // untraveled arrows + idle labels
const PANEL = 0x0a0f1e; // dark fills

export interface StateSceneConfig {
  accent: number; // 0xRRGGBB
  actorIcon: string;
  startLabel: string; // e.g. "start"
  reducedMotion: boolean;
}

/** The play state the scene draws — all of it computed by engine.ts; the scene only paints it. */
export interface FSMViewState {
  /** State the token currently stands on. */
  current: string;
  /** How many input symbols have been consumed (tape pointer). */
  cursor?: number;
  /** Per-step record of the walk so far (valid hops light up; first invalid draws red). */
  trace?: StepTrace[];
  /** Final grade, once known — colors the halted node. */
  outcome?: Outcome | null;
}

type Pt = { x: number; y: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const edgeKey = (from: string, to: string) => `${from}\u0000${to}`;

/** Walk `r` units from `p` toward `q`. */
function toward(p: Pt, q: Pt, r: number): Pt {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / len) * r, y: p.y + (dy / len) * r };
}

export class StateTraversalScene {
  private app: Application | null = null;
  private destroyed = false;

  private readonly root = new Container();
  private readonly tape = new Container();
  private readonly edges = new Container();
  private readonly glowG = new Graphics();
  private readonly nodes = new Container();
  private actor!: Text;

  private readonly W = 680;
  private readonly H = 380;
  private readonly margin = 40;
  private readonly R = 24; // node radius
  private readonly tapeY = 14;
  private readonly tapeH = 34;
  private readonly bottomPad = 22;

  private readonly pos = new Map<string, Pt>();
  private tokenPos: Pt = { x: this.W / 2, y: this.H / 2 };
  private currentPos: Pt | null = null;

  // token glide
  private hop: { from: Pt; to: Pt; t: number; dur: number; done: () => void } | null = null;
  // idle halo phase
  private phase = 0;

  constructor(private cfg: StateSceneConfig) {}

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

    this.actor = new Text({ text: this.cfg.actorIcon, style: { fontFamily: EMOJI_FONT, fontSize: 26 } });
    this.actor.anchor.set(0.5, 0.5);
    this.actor.position.set(this.tokenPos.x, this.tokenPos.y);

    this.root.addChild(this.tape, this.edges, this.glowG, this.nodes, this.actor);
    app.stage.addChild(this.root);
    app.ticker.add((tk) => this.tick(tk.deltaMS));
  }

  /** Full redraw of the machine + tape for the current play state. */
  draw(level: StateTraversalLevel, state: FSMViewState): void {
    if (!this.app) return;
    this.layout(level);

    const cursor = state.cursor ?? state.trace?.length ?? 0;
    const trace = state.trace ?? [];
    const traveled = new Set<string>();
    let invalid: StepTrace | null = null;
    for (const st of trace) {
      if (st.valid) traveled.add(edgeKey(st.from, st.to));
      else if (!invalid) invalid = st;
    }

    this.drawTape(level, cursor);
    this.drawEdges(level, traveled, invalid);
    this.drawNodes(level, state);

    // Park the token on the current state (unless it's mid-glide).
    const here = this.pos.get(state.current);
    if (here && !this.hop) {
      this.tokenPos = { ...here };
      this.actor.position.set(here.x, here.y);
    }
    this.currentPos = here ? { ...here } : null;
  }

  /** Glide the token from where it stands to `toState`, then resolve. Renderer motion only. */
  playHop(toState: string, onDone: () => void): void {
    const target = this.pos.get(toState);
    if (this.cfg.reducedMotion || !this.app || !target) {
      if (target) {
        this.tokenPos = { ...target };
        this.actor.position.set(target.x, target.y);
      }
      onDone();
      return;
    }
    this.hop = { from: { ...this.tokenPos }, to: { ...target }, t: 0, dur: 420, done: onDone };
  }

  // ---- layout --------------------------------------------------------------

  private layout(level: StateTraversalLevel): void {
    this.pos.clear();
    const graphTop = this.tapeY + this.tapeH + 20;
    const cx = this.W / 2;
    const cy = graphTop + (this.H - this.bottomPad - graphTop) / 2;
    const n = level.states.length;

    if (n === 1) {
      this.pos.set(level.states[0], { x: cx, y: cy });
      return;
    }
    if (n === 2) {
      const dx = this.W / 2 - this.margin - this.R;
      this.pos.set(level.states[0], { x: cx - dx * 0.72, y: cy });
      this.pos.set(level.states[1], { x: cx + dx * 0.72, y: cy });
      return;
    }
    const rx = this.W / 2 - this.margin - this.R;
    const ry = (this.H - this.bottomPad - graphTop) / 2 - this.R;
    for (let i = 0; i < n; i += 1) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      this.pos.set(level.states[i], { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
  }

  // ---- tape ----------------------------------------------------------------

  private drawTape(level: StateTraversalLevel, cursor: number): void {
    this.tape.removeChildren();
    const k = Math.max(1, level.input.length);
    const gap = 6;
    const boxW = Math.min(30, (this.W - 2 * this.margin - gap * (k - 1)) / k);
    const totalW = k * boxW + (k - 1) * gap;
    const startX = (this.W - totalW) / 2;

    for (let i = 0; i < level.input.length; i += 1) {
      const x = startX + i * (boxW + gap);
      const consumed = i < cursor;
      const reading = i === cursor;
      const stroke = reading ? this.cfg.accent : consumed ? OK : DIM;
      const cell = new Graphics();
      cell
        .roundRect(x, this.tapeY, boxW, this.tapeH, 6)
        .fill({ color: PANEL, alpha: reading ? 0.85 : 0.5 })
        .stroke({ width: reading ? 2 : 1, color: stroke, alpha: reading ? 0.95 : consumed ? 0.6 : 0.3 });
      this.tape.addChild(cell);

      const sym = new Text({
        text: level.input[i],
        style: {
          fontFamily: NUM_FONT,
          fontSize: 14,
          fontWeight: "700",
          fill: reading ? this.cfg.accent : consumed ? OK : DIM,
        },
      });
      sym.anchor.set(0.5, 0.5);
      sym.position.set(x + boxW / 2, this.tapeY + this.tapeH / 2);
      this.tape.addChild(sym);
    }
  }

  // ---- edges ---------------------------------------------------------------

  private drawEdges(
    level: StateTraversalLevel,
    traveled: Set<string>,
    invalid: StepTrace | null,
  ): void {
    this.edges.removeChildren();

    // Group parallel arrows (same from→to) so their symbols share one label.
    const groups = new Map<string, { from: string; to: string; syms: string[] }>();
    for (const t of level.transitions) {
      const key = edgeKey(t.from, t.to);
      const g = groups.get(key) ?? { from: t.from, to: t.to, syms: [] };
      g.syms.push(t.on);
      groups.set(key, g);
    }

    for (const g of groups.values()) {
      const on = g.syms.slice().sort().join(",");
      const color = traveled.has(edgeKey(g.from, g.to)) ? this.cfg.accent : DIM;
      if (g.from === g.to) this.drawSelfLoop(g.from, on, color);
      else this.drawArrow(g.from, g.to, on, color, false);
    }

    // The start-state entry stub.
    this.drawStartStub(level.start);

    // The illegal move that ended the walk, if any — dashed red into the wrong state.
    if (invalid) this.drawAttempt(invalid.from, invalid.to);
  }

  private drawArrow(from: string, to: string, label: string, color: number, dashed: boolean): void {
    const a = this.pos.get(from);
    const b = this.pos.get(to);
    if (!a || !b) return;

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bow = 26; // perpendicular bow — flips sign for the reverse arrow, so pairs separate
    const c: Pt = { x: mx + nx * bow, y: my + ny * bow };

    const s = toward(a, c, this.R);
    const e = toward(b, c, this.R);

    const g = new Graphics();
    g.moveTo(s.x, s.y).quadraticCurveTo(c.x, c.y, e.x, e.y).stroke({
      width: dashed ? 1.5 : 2,
      color,
      alpha: 0.85,
    });
    const ang = Math.atan2(e.y - c.y, e.x - c.x);
    this.arrowhead(g, e.x, e.y, ang, color);
    this.edges.addChild(g);

    this.labelChip(label, c.x + nx * 8, c.y + ny * 8, color);
  }

  private drawSelfLoop(id: string, label: string, color: number): void {
    const p = this.pos.get(id);
    if (!p) return;
    const cx = p.x;
    const cy = p.y - this.R - 13;
    const rad = 13;
    const g = new Graphics();
    g.arc(cx, cy, rad, Math.PI * 0.35, Math.PI * 2.65).stroke({ width: 2, color, alpha: 0.85 });
    // Arrowhead where the loop dives back into the node (bottom-right of the loop).
    const end: Pt = { x: cx + rad * Math.cos(Math.PI * 0.35), y: cy + rad * Math.sin(Math.PI * 0.35) };
    this.arrowhead(g, end.x, end.y, Math.PI * 0.85, color);
    this.edges.addChild(g);
    this.labelChip(label, cx, cy - rad - 6, color);
  }

  private drawStartStub(start: string): void {
    const p = this.pos.get(start);
    if (!p) return;
    // Point inward from just outside the node, biased left so it reads as an entry.
    const dir: Pt = { x: -1, y: 0.35 };
    const dlen = Math.hypot(dir.x, dir.y);
    const ux = dir.x / dlen;
    const uy = dir.y / dlen;
    const tip: Pt = { x: p.x + ux * this.R, y: p.y + uy * this.R };
    const tail: Pt = { x: p.x + ux * (this.R + 26), y: p.y + uy * (this.R + 26) };
    const g = new Graphics();
    g.moveTo(tail.x, tail.y).lineTo(tip.x, tip.y).stroke({ width: 2, color: OK, alpha: 0.8 });
    this.arrowhead(g, tip.x, tip.y, Math.atan2(-uy, -ux), OK);
    this.edges.addChild(g);

    const lbl = new Text({
      text: this.cfg.startLabel,
      style: { fontFamily: NUM_FONT, fontSize: 10, fontWeight: "700", fill: OK },
    });
    lbl.anchor.set(1, 0.5);
    lbl.position.set(tail.x - 3, tail.y);
    this.edges.addChild(lbl);
  }

  private drawAttempt(from: string, to: string): void {
    const a = this.pos.get(from);
    const b = this.pos.get(to);
    if (!a || !b || from === to) return;
    const s = toward(a, b, this.R);
    const e = toward(b, a, this.R + 4);
    const g = new Graphics();
    this.dashedLine(g, s.x, s.y, e.x, e.y);
    g.stroke({ width: 2, color: BAD, alpha: 0.9 });
    this.arrowhead(g, e.x, e.y, Math.atan2(e.y - s.y, e.x - s.x), BAD);
    this.edges.addChild(g);
  }

  // ---- nodes ---------------------------------------------------------------

  private drawNodes(level: StateTraversalLevel, state: FSMViewState): void {
    this.nodes.removeChildren();
    const accepting = new Set(level.accepting);
    const bad =
      state.outcome === "stuck" || state.outcome === "wrong-transition" || state.outcome === "rejected";

    for (const id of level.states) {
      const p = this.pos.get(id);
      if (!p) continue;
      const isCurrent = id === state.current;
      const ring = isCurrent ? (state.outcome === "success" ? OK : bad ? BAD : this.cfg.accent) : DIM;

      const g = new Graphics();
      g.circle(p.x, p.y, this.R)
        .fill({ color: PANEL, alpha: 0.92 })
        .stroke({ width: isCurrent ? 3 : 1.5, color: ring, alpha: isCurrent ? 1 : 0.55 });
      if (accepting.has(id)) {
        g.circle(p.x, p.y, this.R - 4).stroke({ width: 1.5, color: OK, alpha: 0.85 });
      }
      this.nodes.addChild(g);

      const lbl = new Text({
        text: id,
        style: {
          fontFamily: NUM_FONT,
          fontSize: 13,
          fontWeight: "700",
          fill: isCurrent ? 0xffffff : 0xd6e2ff,
        },
      });
      lbl.anchor.set(0.5, 0.5);
      lbl.position.set(p.x, p.y);
      this.nodes.addChild(lbl);
    }
  }

  // ---- small drawing helpers ----------------------------------------------

  private arrowhead(g: Graphics, x: number, y: number, angle: number, color: number, size = 8): void {
    const back = angle + Math.PI;
    const spread = 0.45;
    const p1x = x + size * Math.cos(back + spread);
    const p1y = y + size * Math.sin(back + spread);
    const p2x = x + size * Math.cos(back - spread);
    const p2y = y + size * Math.sin(back - spread);
    g.moveTo(x, y).lineTo(p1x, p1y).lineTo(p2x, p2y).closePath().fill({ color });
  }

  private dashedLine(g: Graphics, ax: number, ay: number, bx: number, by: number): void {
    const dash = 7;
    const gap = 5;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    for (let d = 0; d < len; d += dash + gap) {
      const x1 = ax + ux * d;
      const y1 = ay + uy * d;
      const seg = Math.min(d + dash, len);
      g.moveTo(x1, y1).lineTo(ax + ux * seg, ay + uy * seg);
    }
  }

  private labelChip(text: string, x: number, y: number, color: number): void {
    const t = new Text({
      text,
      style: { fontFamily: NUM_FONT, fontSize: 11, fontWeight: "700", fill: color },
    });
    t.anchor.set(0.5, 0.5);
    t.position.set(x, y);
    const bg = new Graphics();
    bg.roundRect(x - t.width / 2 - 4, y - t.height / 2 - 1, t.width + 8, t.height + 2, 4).fill({
      color: PANEL,
      alpha: 0.85,
    });
    this.edges.addChild(bg, t);
  }

  // ---- ticker --------------------------------------------------------------

  private tick(dtMS: number): void {
    if (!this.app) return;
    const dt = Math.min(dtMS, 50);

    // Token glide.
    if (this.hop) {
      this.hop.t = Math.min(1, this.hop.t + dt / this.hop.dur);
      const e = this.hop.t < 0.5 ? 2 * this.hop.t * this.hop.t : 1 - Math.pow(-2 * this.hop.t + 2, 2) / 2;
      // Arc the glide slightly so it reads as walking an arrow, not teleporting.
      const arc = Math.sin(this.hop.t * Math.PI) * 14;
      this.tokenPos = {
        x: lerp(this.hop.from.x, this.hop.to.x, e),
        y: lerp(this.hop.from.y, this.hop.to.y, e) - arc,
      };
      this.actor.position.set(this.tokenPos.x, this.tokenPos.y);
      if (this.hop.t >= 1) {
        this.tokenPos = { ...this.hop.to };
        this.currentPos = { ...this.hop.to };
        this.actor.position.set(this.tokenPos.x, this.tokenPos.y);
        const cb = this.hop.done;
        this.hop = null;
        cb();
      }
    }

    // Idle halo pulsing around the current state.
    this.glowG.clear();
    if (this.currentPos && !this.cfg.reducedMotion) {
      this.phase += dt / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(this.phase * 2.4);
      this.glowG
        .circle(this.currentPos.x, this.currentPos.y, this.R + 4 + pulse * 5)
        .stroke({ width: 2, color: this.cfg.accent, alpha: 0.12 + pulse * 0.25 });
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
