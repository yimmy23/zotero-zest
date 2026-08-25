/**
 * Per-copy identity for method wrappers (collection counts, the reveal
 * guard, …). An in-place upgrade overlaps the outgoing copy's teardown with
 * the incoming copy's startup, so a wrapper on e.g. `collectionsView.
 * renderItem` may belong to a copy that is still alive. Stripping it (or
 * blindly restoring "the original" over it) hands the window a dead paint
 * path — the exact class of bug views/itemFilter.ts solves with its alive
 * set. This is that pattern, shared:
 *
 *  - every copy registers a Symbol in a set that lives on `Zotero` (the one
 *    object all copies see);
 *  - `mark()` tags a wrapper with its copy's symbol and its base function;
 *  - `stripStale()` walks back ONLY over wrappers whose copy has retired —
 *    a live copy's wrapper (this one's, or a newer one's) is left alone;
 *  - uninstall restores the base only when the CURRENT function is this
 *    copy's own wrapper (referential identity), never by overwriting
 *    whatever happens to be installed.
 */

export interface WrapGuard {
  /** tag a wrapper as this copy's, remembering its base */
  mark(wrapper: unknown, original: unknown): void;
  /** unwind wrappers left by retired copies; live wrappers stay */
  stripStale<T>(current: T): T;
  /** true when `fn` is a wrapper made by THIS copy */
  isOwn(fn: unknown): boolean;
  /** this copy stops wrapping for good (plugin shutdown) */
  retire(): void;
}

export function createWrapGuard(globalKey: string): WrapGuard {
  const instance = Symbol(globalKey);
  const alive = (): Set<symbol> => {
    const z = Zotero as any;
    if (!z[globalKey]) z[globalKey] = new Set<symbol>();
    return z[globalKey] as Set<symbol>;
  };
  alive().add(instance);
  return {
    mark(wrapper: unknown, original: unknown) {
      // re-adding keeps the copy alive even if a feature was toggled off
      // (retire + re-enable) earlier in the session
      alive().add(instance);
      (wrapper as any).__zestOriginal = original;
      (wrapper as any).__zestWrapInstance = instance;
    },
    stripStale<T>(current: T): T {
      let fn: any = current;
      let hops = 0;
      while (
        fn?.__zestWrapInstance &&
        !alive().has(fn.__zestWrapInstance) &&
        hops++ < 5
      ) {
        fn = fn.__zestOriginal;
      }
      return fn as T;
    },
    isOwn(fn: unknown) {
      return (fn as any)?.__zestWrapInstance === instance;
    },
    retire() {
      alive().delete(instance);
    },
  };
}
