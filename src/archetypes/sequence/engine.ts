// Pure, deterministic sequence executor. The player produces an ordering of
// steps; we walk it and break at the first step whose prerequisites haven't
// happened yet. The break position determines the gap signal.

export interface Step {
  id: string;
  needs: string[];
}

export interface SequenceLevel {
  steps: Step[];
}

export type SeqEvent =
  | { type: "ok"; stepId: string; index: number }
  | { type: "break"; stepId: string; index: number; missing: string[] };

export interface SeqRun {
  events: SeqEvent[];
  outcome: "success" | "broken";
  breakIndex: number | null;
  signals: string[];
}

export function runSequence(order: string[], steps: Step[]): SeqRun {
  const needsById = new Map(steps.map((s) => [s.id, s.needs]));
  const done = new Set<string>();
  const events: SeqEvent[] = [];
  const signals = new Set<string>();
  let outcome: "success" | "broken" = "success";
  let breakIndex: number | null = null;

  for (let i = 0; i < order.length; i += 1) {
    const id = order[i];
    const needs = needsById.get(id) ?? [];
    const missing = needs.filter((n) => !done.has(n));
    if (missing.length > 0) {
      events.push({ type: "break", stepId: id, index: i, missing });
      outcome = "broken";
      breakIndex = i;
      // Broke at the very first step -> began in the wrong place.
      // Broke later -> got the start right but violated a dependency.
      signals.add(i === 0 ? "wrong-start" : "dependency-violation");
      break;
    }
    events.push({ type: "ok", stepId: id, index: i });
    done.add(id);
  }

  return { events, outcome, breakIndex, signals: [...signals] };
}
