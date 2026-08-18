import { getString } from "../utils/locale";

/**
 * Generic batch runner with the two safeguards every bulk action needs:
 * an explicit confirmation (count) and a way to stop midway — clicking the
 * progress window cancels; remaining items are left untouched.
 */
export async function runBatch<T>(
  title: string,
  targets: T[],
  work: (target: T, index: number) => Promise<void>,
  options: {
    confirmMessage?: string;
    label?: (target: T) => string;
    /** skip the confirmation dialog (already confirmed by the caller) */
    skipConfirm?: boolean;
  } = {},
): Promise<{ ok: number; fail: number; stopped: number } | null> {
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
  const pw = new ztoolkit.ProgressWindow(title, {
    closeTime: -1,
    closeOnClick: true,
    closeOtherProgressWindows: true,
  })
    .createLine({ text: `0/${targets.length}`, type: "default", progress: 0 })
    .show();
  const inner = pw.win as any;
  const origClose = inner.close;
  inner.close = () => {
    cancelled = true;
    origClose.call(inner);
  };
  try {
    inner.addDescription?.(getString("batch-cancel-hint"));
  } catch {
    // cosmetic
  }
  let ok = 0;
  let fail = 0;
  let i = 0;
  for (; i < targets.length; i++) {
    if (cancelled) break;
    try {
      await work(targets[i], i);
      ok++;
    } catch (e) {
      fail++;
      ztoolkit.log("[batch] item failed", e);
    }
    const label = options.label ? options.label(targets[i]) : "";
    pw.changeLine({
      text: `${i + 1}/${targets.length}${label ? " " + label : ""}`,
      progress: ((i + 1) / targets.length) * 100,
    });
  }
  const stopped = targets.length - i;
  if (!cancelled) {
    pw.changeLine({
      text: `✓ ${ok}  ✗ ${fail}`,
      type: fail ? "fail" : "success",
      progress: 100,
    });
    pw.startCloseTimer(3000);
  } else {
    new ztoolkit.ProgressWindow(title, { closeOtherProgressWindows: true })
      .createLine({
        text: getString("batch-cancelled", { args: { ok, left: stopped } }),
        type: "default",
      })
      .show();
  }
  return { ok, fail, stopped };
}
