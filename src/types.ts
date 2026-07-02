import type { FC } from "react";

// ============================================================================
// Content graph — authored by Claude Code, read by the engine. No LLM at play-time.
// ============================================================================

export type NodeType = "level" | "boss" | "sidequest";

export interface FailureMode {
  /** A play-state signal (a `tag`) crossing `minCount` fires this gap. */
  signal: { tag: string; minCount: number };
  /** The concept the learner is actually weak on. */
  gap: string;
  /** "sidequest:<node-id>" (route to an existing node) or "generate:<spec>" (emit a CC ticket). */
  remediation: string;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  /** The ONE thing this node teaches. */
  concept: string;
  role?: string;
  tier: number;
  prereqs: string[];
  hidden?: boolean;
  remediates?: string;
  clearsGap?: string;
  /** Which archetype renders this node. */
  shape: string;
  /** Archetype-specific config; validated by that archetype's module. */
  level: unknown;
  failureModes: FailureMode[];
}

export interface Graph {
  shape: string;
  themes: string[];
  spine: string[];
  nodes: GraphNode[];
}

// ============================================================================
// Themes — skins poured over the SAME structural graph. This is what lets one
// engine + one graph teach different subjects.
// ============================================================================

export interface ThemeNode {
  title: string;
  hook: string;
  winText: string;
  failText?: Record<string, string>;
  /** Archetype-specific per-node theme data (e.g. sequence step labels). The shell ignores it; the archetype interprets it. */
  extra?: Record<string, unknown>;
}

export interface Theme {
  id: string;
  label: string;
  subject: string;
  bossHook: string;
  vocab: Record<string, string>;
  visual: {
    // Shell reads accent + actorIcon; the rest is archetype-specific.
    accent: string;
    actorIcon: string;
    containerShape?: "square" | "round";
    coreIcon?: string;
  };
  nodes: Record<string, ThemeNode>;
}

// ============================================================================
// The GameModule contract — the extensibility primitive. Every archetype
// implements this; the shell knows nothing else about any specific game.
// ============================================================================

export interface GameResult {
  won: boolean;
}

export interface GameProps<L = unknown> {
  level: L;
  theme: Theme;
  themeNode: ThemeNode;
  /** Emit a gap signal from a PLAY state (e.g. the recursion overflowed). */
  onSignal: (tag: string) => void;
  /** Called once, when the node is genuinely mastered. */
  onComplete: (result: GameResult) => void;
}

export interface GameModule<L = unknown> {
  shape: string;
  label: string;
  component: FC<GameProps<L>>;
  /** Guard CC-authored data at the boundary. Throw on malformed input. */
  validate: (level: unknown) => L;
}
