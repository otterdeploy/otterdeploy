/**
 * A breadth-first explicit-state checker: every reachable state of a finite
 * model, each state checked against invariants and each transition against
 * edge checks, with the shortest trace to the first violation. No sampling and
 * no depth cutoff; a state budget turns an unexpectedly large model into a
 * failure instead of a silent partial search.
 */
export interface Edge<S> {
  action: string;
  state: S;
}

export interface Model<S> {
  initial: S[];
  next: (state: S) => Edge<S>[];
  invariants: { id: string; test: (state: S) => boolean }[];
  edgeChecks?: { id: string; test: (before: S, edge: Edge<S>) => boolean }[];
  witnesses?: Record<string, (state: S) => boolean>;
}

export type CheckResult =
  | { status: "holds"; states: number; edges: number; missingWitnesses: string[] }
  | { status: "violated"; invariant: string; states: number; trace: string[]; last: unknown };

export function check<S>(model: Model<S>, budget = 500_000): CheckResult {
  const states: { state: S; parent: number; action: string }[] = [];
  const seen = new Map<string, number>();
  const found = new Set<string>();
  let edges = 0;
  const trace = (i: number, last?: string): string[] => {
    const out: string[] = [];
    for (let k = i; k >= 0; k = states[k]?.parent ?? -1) out.push(states[k]?.action ?? "?");
    out.reverse();
    if (last) out.push(last);
    return out;
  };
  for (const s of model.initial) {
    const key = JSON.stringify(s);
    if (!seen.has(key)) {
      seen.set(key, states.length);
      states.push({ state: s, parent: -1, action: "initial" });
    }
  }
  for (let i = 0; i < states.length; i++) {
    const cur = states[i];
    if (!cur) break;
    for (const inv of model.invariants) {
      if (!inv.test(cur.state)) {
        return {
          status: "violated",
          invariant: inv.id,
          states: states.length,
          trace: trace(i),
          last: cur.state,
        };
      }
    }
    for (const [name, w] of Object.entries(model.witnesses ?? {})) {
      if (!found.has(name) && w(cur.state)) found.add(name);
    }
    for (const e of model.next(cur.state)) {
      edges++;
      for (const ec of model.edgeChecks ?? []) {
        if (!ec.test(cur.state, e)) {
          return {
            status: "violated",
            invariant: ec.id,
            states: states.length,
            trace: trace(i, e.action),
            last: e.state,
          };
        }
      }
      const key = JSON.stringify(e.state);
      if (!seen.has(key)) {
        seen.set(key, states.length);
        states.push({ state: e.state, parent: i, action: e.action });
      }
    }
    if (states.length > budget) throw new Error(`state budget ${budget} exceeded: not exhaustive`);
  }
  const missingWitnesses = Object.keys(model.witnesses ?? {}).filter((w) => !found.has(w));
  return { status: "holds", states: states.length, edges, missingWitnesses };
}
