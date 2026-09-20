// What counts as a finished scan. The single place that decides.
//
// The rule is "both codes in one frame": a reported pair must have come from
// one captured frame, so two codes shown together were genuinely in view
// together. That is a statement about the *frame*, not about one decode pass —
// real bottles need two different dewarps of the same frame to give up both
// labels, so the sweep merges across candidates within a frame and never
// across frames.

export const MAX_CODES = 2;

// How long to keep sweeping fresh frames after a frame yielded only one code,
// in case a better-aimed frame carries both.
export const SETTLE_MS = 1400;

export function isComplete(results) {
  return results.length >= MAX_CODES;
}

/** Merge decode results from one frame, de-duplicated by payload, capped. */
export function mergeFrameResults(into, found) {
  for (const result of found) {
    if (!into.has(result.text)) into.set(result.text, result);
    if (into.size >= MAX_CODES) break;
  }
  return into;
}

export class PairingPolicy {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.pending = null;
    this.deadline = 0;
  }

  /**
   * Offer one frame's merged results.
   * Returns {action: "accept", results, candidates} | {action: "wait", waitMs} |
   * {action: "none"}.
   */
  offer(results, candidates) {
    if (isComplete(results)) {
      const decision = { action: "accept", results: results.slice(0, MAX_CODES), candidates };
      this.reset();
      return decision;
    }
    if (results.length > 0) {
      // Keep the freshest single so an accepted lone code matches what the
      // camera last actually saw.
      this.pending = { results, candidates };
      if (!this.deadline) this.deadline = this.now() + SETTLE_MS;
      return { action: "wait", waitMs: Math.max(0, this.deadline - this.now()) };
    }
    return { action: "none" };
  }

  /** Settle window elapsed: accept whatever single code is held, if any. */
  expire() {
    if (!this.pending) return { action: "none" };
    const decision = { action: "accept", ...this.pending };
    this.reset();
    return decision;
  }

  reset() {
    this.pending = null;
    this.deadline = 0;
  }
}
