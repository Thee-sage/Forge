import { computeExpected, type Expected } from "../oracle/oracle.js";
import type { PipelineCase } from "../types.js";

const cache = new WeakMap<PipelineCase, Expected>();

/** Oracle output for a case, computed once per run. */
export function expectedFor(c: PipelineCase): Expected {
  let e = cache.get(c);
  if (!e) {
    e = computeExpected(c.truth, c.scenarios ?? []);
    cache.set(c, e);
  }
  return e;
}
