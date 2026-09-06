/**
 * DOM state outlives a plugin sandbox during an in-place upgrade. A new copy
 * takes over the state while preserving its original restoration callback;
 * an outgoing copy must not undo a claim the new copy now owns.
 */
interface Claim {
  owner: symbol;
  restore: () => void;
}

export function createDOMOwnership() {
  const owner = Symbol("zest-dom-owner");
  const z = Zotero as any;
  const claims: WeakMap<object, Map<string, Claim>> = (z.__zestDOMClaims ??=
    new WeakMap<object, Map<string, Claim>>());
  return {
    claim(target: object, key: string, restore: () => void) {
      let state = claims.get(target);
      if (!state) {
        state = new Map();
        claims.set(target, state);
      }
      const original = state.get(key)?.restore ?? restore;
      state.set(key, { owner, restore: original });
    },
    owns(target: object, key: string): boolean {
      return claims.get(target)?.get(key)?.owner === owner;
    },
    release(target: object, key: string): boolean {
      const state = claims.get(target);
      const claim = state?.get(key);
      if (!claim || claim.owner !== owner) return false;
      state!.delete(key);
      claim.restore();
      return true;
    },
  };
}
