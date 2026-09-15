import { getString } from "../utils/locale";

export interface BatchResult {
  ok: number;
  fail: number;
  stopped: number;
  /** A cancelled in-flight target remains part of stopped, never ok/fail. */
  cancelled?: true;
}

/**
 * Generic batch runner with the two safeguards every bulk action needs:
 * an explicit confirmation (count) and a way to stop midway — clicking the
 * progress window cancels; remaining items are left untouched.
 */
export async function runBatch<T>(
  title: string,
  targets: T[],
  work: (
    target: T,
    index: number,
    shouldContinue: () => boolean,
  ) => Promise<void | "cancelled">,
  options: {
    confirmMessage?: string;
    label?: (target: T) => string;
    /** skip the confirmation dialog (already confirmed by the caller) */
    skipConfirm?: boolean;
    /** Dependent operations must not continue after a prerequisite failed. */
    stopOnError?: boolean | ((error: unknown) => boolean);
  } = {},
): Promise<BatchResult | null> {
  if (!targets.length) return null;
  const win = Zotero.getMainWindow();
  if (!options.skipConfirm) {
    const confirmed = Services.prompt.confirm(
      win as any,
      title,
      options.confirmMessage ||
        getString("batch-confirm-count", { args: { count: targets.length } }),
    );
    if (!confirmed) return null;
  }
  let cancelled = false;
  let closed = false;
  const alive = () => addon.data.alive && !win?.closed;
  if (!alive()) return null;
  const shouldContinue = () => {
    if (!alive()) cancelled = true;
    return !cancelled;
  };
  const pw = new ztoolkit.ProgressWindow(title, {
    closeTime: -1,
    closeOnClick: true,
    closeOtherProgressWindows: true,
  }).createLine({ text: `0/${targets.length}`, type: "default", progress: 0 });
  const inner = pw.win as any;
  const origClose = inner.close;
  inner.close = () => {
    cancelled = true;
    closed = true;
    origClose.call(inner);
  };
  pw.show();
  try {
    inner.addDescription?.(getString("batch-cancel-hint"));
  } catch {
    // cosmetic
  }
  let ok = 0;
  let fail = 0;
  let i = 0;
  for (; i < targets.length; i++) {
    if (!shouldContinue()) break;
    let stopOnFailure = false;
    try {
      const result = await work(targets[i], i, shouldContinue);
      if (result === "cancelled") {
        cancelled = true;
        break;
      }
      ok++;
    } catch (e) {
      fail++;
      stopOnFailure =
        typeof options.stopOnError === "function"
          ? options.stopOnError(e)
          : options.stopOnError === true;
      ztoolkit.log("[batch] item failed", e);
    }
    // Closing the progress window or unloading this plugin invalidates the
    // pending operation's guard. Do not repaint a closed/stale window.
    if (!shouldContinue()) break;
    const label = options.label ? options.label(targets[i]) : "";
    pw.changeLine({
      text: `${i + 1}/${targets.length}${label ? " " + label : ""}`,
      progress: ((i + 1) / targets.length) * 100,
    });
    if (stopOnFailure) break;
  }
  const stopped = targets.length - ok - fail;
  if (!closed && alive()) {
    pw.changeLine({
      text: cancelled
        ? getString("batch-cancelled", { args: { ok, left: stopped } })
        : `✓ ${ok}  ✗ ${fail}${stopped ? `  · ${getString("batch-stopped", { args: { count: stopped } })}` : ""}`,
      type: cancelled ? "default" : fail ? "fail" : "success",
      progress: 100,
    });
    pw.startCloseTimer(3000);
  }
  return {
    ok,
    fail,
    stopped,
    ...(cancelled ? { cancelled: true as const } : {}),
  };
}
