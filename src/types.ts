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

/** A deeper-dive concept the learner can spin off into its OWN separate game. */
export interface Subtopic {
  /** Short display title for the deeper-dive. */
  title: string;
  /** The concept a sub-game teaches — fed straight back into topic authoring. */
  concept: string;
  /** One-line pitch for why it's worth exploring. */
  blurb?: string;
}

export interface Graph {
  shape: string;
  themes: string[];
  spine: string[];
  nodes: GraphNode[];
  /** Optional adjacent concepts the player can author into their own sub-game. */
  subtopics?: Subtopic[];
}

// ============================================================================
// Learning-loop beats — optional narration the SHELL sequences around the game.
// All fields optional; the shell degrades to today's behavior when absent.
// Authored per theme node (speaks the theme's language for concreteness fading).
// ============================================================================

export interface LearnReveal {
  /** The abstract idea the concrete level just enacted. Defaults to the node's `concept`. */
  concept?: string;
  /** 1–3 short lines bridging the played experience to the abstract concept. */
  body: string;
  /** Optional: the same idea "in the wild" — a real-world or code echo. */
  inTheWild?: string;
}

export interface LearnBeats {
  /** FRAME (pre-play): primes the question. When present, the shell shows a brief frame card before the game. */
  frame?: string;
  /** REVEAL (post-win): names the pattern, fades concrete → abstract. */
  reveal?: LearnReveal;
  /** MICRO-EXPLAIN: signal tag → a short just-in-time explanation, surfaced in the reveal when that gap fired during play. */
  insights?: Record<string, string>;
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
  /** Optional learning-loop beats the shell layers around the game (frame/reveal/insights). */
  learn?: LearnBeats;
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
