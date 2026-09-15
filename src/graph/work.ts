/** Cooperative work shared by graph construction and library author lookups. */
export interface WorkOptions {
  shouldContinue?: () => boolean;
  /** Elapsed-time budget; a single Zotero accessor is the smallest work unit. */
  sliceMs?: number;
  maxSteps?: number;
  /** Diagnostics: duration of each uninterrupted computation slice. */
  onSlice?: (milliseconds: number) => void;
}

export class WorkCancelled extends Error {
  constructor() {
    super("Graph work cancelled");
    this.name = "WorkCancelled";
  }
}

export function runSync<T>(work: Generator<void, T>): T {
  let next = work.next();
  while (!next.done) next = work.next();
  return next.value;
}

export async function runSliced<T>(
  work: Generator<void, T>,
  options: WorkOptions = {},
): Promise<T> {
  const budget = Math.max(1, options.sliceMs ?? 8);
  const maxSteps = Math.max(1, options.maxSteps ?? 4096);
  const valid = () => options.shouldContinue?.() !== false;
  let start = Date.now();
  let steps = 0;
  try {
    while (true) {
      if (!valid()) throw new WorkCancelled();
      const next = work.next();
      if (next.done) {
        options.onSlice?.(Date.now() - start);
        return next.value;
      }
      if (++steps >= maxSteps || Date.now() - start >= budget) {
        options.onSlice?.(Date.now() - start);
        // Zotero's process-wide promise delay survives main-window closure.
        // The fallback is for isolated source harnesses without Zotero.Promise.
        if (Zotero.Promise?.delay) await Zotero.Promise.delay(0);
        else await new Promise<void>((resolve) => setTimeout(resolve, 0));
        start = Date.now();
        steps = 0;
      }
    }
  } finally {
    work.return(undefined as T);
  }
}

/** Stable merge sort so a large same-surname bucket also remains cancellable. */
export function* sortSteps<T>(
  input: T[],
  compare: (a: T, b: T) => number,
): Generator<void, T[]> {
  let from = input;
  let into: T[] = [];
  for (let width = 1; width < input.length; width *= 2) {
    for (let start = 0; start < input.length; start += 2 * width) {
      const middle = Math.min(start + width, input.length);
      const end = Math.min(start + 2 * width, input.length);
      let left = start;
      let right = middle;
      for (let at = start; at < end; at++) {
        into[at] =
          left < middle &&
          (right >= end || compare(from[left], from[right]) <= 0)
            ? from[left++]
            : from[right++];
        yield;
      }
    }
    from = into;
    into = [];
  }
  return from;
}
