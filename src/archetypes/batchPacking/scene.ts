// PixiJS renderer for the batch-packing archetype. RENDERER only — all grading lives in
// engine.ts. It draws the current assignment as a set of batch columns: requests stack
// as blocks (height ∝ size), a dashed CAPACITY line marks the memory ceiling (anything
// above it overflows, drawn red), and a BUDGET divider marks the throughput target
// (columns past it are wasted batches). A light sweep animates a "run".

import { Application, Container, Graphics, Text } from "pixi.js";
import type { BatchPackingLevel, Assignment } from "./engine";

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const NUM_FONT = '"JetBrains Mono","SFMono-Regular",monospace';

const OVER = 0xff5a6a; // over-capacity red
export const BATCH_HUES = [0x35e0ff, 0x8b7bff, 0x3ad0b0, 0xffb454, 0xff6b9d, 0x9fe870, 0x5aa9ff, 0xf0c674];

export interface BatchSceneConfig {
  accent: number; // 0xRRGGBB
  actorIcon: string;
  unitLabel: string; // e.g. "KV-blocks"
  capacityLabel: string; // e.g. "VRAM"
  batchLabel: string; // e.g. "batch"
  reducedMotion: boolean;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class BatchScene {
  private app: Application | null = null;
  private destroyed = false;

  private readonly root = new Container();
  private readonly cols = new Container();
  private readonly sweepG = new Graphics();
  private actor!: Text;

  private readonly W = 680;
  private readonly H = 300;
  private readonly margin = 44;
  private readonly topPad = 48;
  private readonly bottomPad = 28;

  // run sweep
  private sweeping = false;
  private sweepT = 0;
  private sweepDone: (() => void) | null = null;

  constructor(private cfg: BatchSceneConfig) {}

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

    this.actor = new Text({ text: this.cfg.actorIcon, style: { fontFamily: EMOJI_FONT, fontSize: 30 } });
    this.actor.anchor.set(0.5, 0.5);
    this.actor.position.set(this.margin * 0.55, this.topPad * 0.5);

    this.root.addChild(this.cols, this.sweepG, this.actor);
    app.stage.addChild(this.root);
    app.ticker.add((tk) => this.tick(tk.deltaMS));
  }

  /** Full redraw of the batch columns for the current assignment. */
  draw(level: BatchPackingLevel, assignment: Assignment): void {
    if (!this.app) return;
    this.cols.removeChildren();

    const K = Math.max(1, level.requests.length);
    const baselineY = this.H - this.bottomPad;
    const usableH = this.H - this.topPad - this.bottomPad;
    const capH = usableH * 0.72;
    const pxPerUnit = capH / level.capacity;
    const capacityY = baselineY - capH;

    const gap = 10;
    const colW = Math.min(92, (this.W - 2 * this.margin - gap * (K - 1)) / K);
    const totalW = K * colW + (K - 1) * gap;
    const startX = (this.W - totalW) / 2;

    const byBatch = new Map<number, { id: string; size: number }[]>();
    for (const r of level.requests) {
      const b = assignment[r.id];
      if (typeof b !== "number" || b < 0) continue;
      const arr = byBatch.get(b) ?? [];
      arr.push(r);
      byBatch.set(b, arr);
    }

    // Column floors + headers.
    for (let c = 0; c < K; c += 1) {
      const x = startX + c * (colW + gap);
      const cx = x + colW / 2;
      const overBudget = c >= level.budget;
      const hue = BATCH_HUES[c % BATCH_HUES.length];

      const floor = new Graphics();
      floor
        .roundRect(x, this.topPad, colW, baselineY - this.topPad, 8)
        .fill({ color: 0x0a0f1e, alpha: 0.55 })
        .stroke({ width: 1, color: overBudget ? OVER : this.cfg.accent, alpha: overBudget ? 0.4 : 0.18 });
      this.cols.addChild(floor);

      const header = new Text({
        text: `${this.cfg.batchLabel} ${c + 1}`,
        style: { fontFamily: NUM_FONT, fontSize: 11, fontWeight: "700", fill: overBudget ? OVER : 0x9fb2d8 },
      });
      header.anchor.set(0.5, 0);
      header.position.set(cx, 8);
      this.cols.addChild(header);

      // Stack the requests assigned to this batch, from the floor up.
      const items = (byBatch.get(c) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
      let cumBelow = 0;
      for (const it of items) {
        const cumTop = cumBelow + it.size;
        const over = cumTop > level.capacity;
        const blockBottom = baselineY - cumBelow * pxPerUnit;
        const blockTop = baselineY - cumTop * pxPerUnit;
        const h = blockBottom - blockTop;
        const g = new Graphics();
        g.roundRect(x + 5, blockTop, colW - 10, h - 3, 6)
          .fill({ color: over ? OVER : hue, alpha: over ? 0.9 : 0.85 })
          .stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
        this.cols.addChild(g);
        if (h > 16) {
          const lbl = new Text({
            text: `${it.id}·${it.size}`,
            style: { fontFamily: NUM_FONT, fontSize: 11, fontWeight: "700", fill: 0x041018 },
          });
          lbl.anchor.set(0.5, 0.5);
          lbl.position.set(cx, (blockTop + blockBottom) / 2);
          this.cols.addChild(lbl);
        }
        cumBelow = cumTop;
      }
    }

    // Capacity ceiling — dashed line across all columns.
    const capLine = new Graphics();
    const left = startX;
    const right = startX + totalW;
    for (let dx = left; dx < right; dx += 12) {
      capLine.moveTo(dx, capacityY).lineTo(Math.min(dx + 7, right), capacityY);
    }
    capLine.stroke({ width: 1.5, color: OVER, alpha: 0.7 });
    this.cols.addChild(capLine);
    const capLabel = new Text({
      text: `${this.cfg.capacityLabel} · ${level.capacity} ${this.cfg.unitLabel}`,
      style: { fontFamily: NUM_FONT, fontSize: 10, fontWeight: "700", fill: OVER },
    });
    capLabel.anchor.set(0, 1);
    capLabel.position.set(left, capacityY - 3);
    this.cols.addChild(capLabel);

    // Budget divider — vertical dashed line after the budget-th column.
    if (level.budget < K) {
      const divX = startX + level.budget * (colW + gap) - gap / 2;
      const div = new Graphics();
      for (let dy = this.topPad; dy < baselineY; dy += 10) {
        div.moveTo(divX, dy).lineTo(divX, Math.min(dy + 6, baselineY));
      }
      div.stroke({ width: 1.5, color: 0x9fb2d8, alpha: 0.5 });
      this.cols.addChild(div);
      const budgetLbl = new Text({
        text: `target ≤ ${level.budget}`,
        style: { fontFamily: NUM_FONT, fontSize: 10, fontWeight: "700", fill: 0x9fb2d8 },
      });
      budgetLbl.anchor.set(0, 0);
      budgetLbl.position.set(divX + 4, this.topPad + 2);
      this.cols.addChild(budgetLbl);
    }
  }

  /** Animate a left→right sweep across the columns, then resolve. */
  playRun(onDone: () => void): void {
    if (this.cfg.reducedMotion || !this.app) {
      onDone();
      return;
    }
    this.sweeping = true;
    this.sweepT = 0;
    this.sweepDone = onDone;
  }

  private tick(dtMS: number): void {
    if (!this.app || !this.sweeping) return;
    const dt = Math.min(dtMS, 50);
    this.sweepT = Math.min(1, this.sweepT + dt / 620);
    const x = lerp(this.margin, this.W - this.margin, this.sweepT);
    this.sweepG.clear();
    this.sweepG
      .rect(x - 3, this.topPad - 4, 6, this.H - this.topPad - this.bottomPad + 8)
      .fill({ color: this.cfg.accent, alpha: 0.8 * (1 - Math.abs(0.5 - this.sweepT) * 0.6) });
    if (this.sweepT >= 1) {
      this.sweeping = false;
      this.sweepG.clear();
      const cb = this.sweepDone;
      this.sweepDone = null;
      cb?.();
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
