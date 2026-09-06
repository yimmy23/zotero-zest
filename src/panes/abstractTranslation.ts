import { config } from "../../package.json";
import { http } from "../core/http";
import { clearTimeout, setTimeout } from "../utils/timers";

export interface AbstractTranslationResult {
  kind: "ok" | "error" | "throttled" | "unreachable" | "cancelled";
  text?: string;
  provider?: string;
}

interface Provider {
  id: string;
  label: string;
  api?: object;
  translate?: (...args: any[]) => Promise<unknown>;
}

const FROM = "en-US";
const TO = "zh-CN";
const BING_URL =
  `https://edge.microsoft.com/translate/translatetext?from=${FROM}&to=${TO}` +
  "&isEnterpriseClient=false";
const MAX_SOURCE = 40_000;
const MAX_RESULT = 80_000;
const MAX_CACHE = 32;
const MAX_PENDING = 4;
const TIMEOUT = 30_000;
const CACHE_TTL = 60 * 60 * 1000;
let generation = 0;
const completed = new Map<
  string,
  { text: string; at: number; translate: Provider["translate"] }
>();
const pending = new Map<
  string,
  {
    consumers: Set<() => boolean>;
    promise: Promise<AbstractTranslationResult>;
  }
>();
const cooldown = new Map<
  string,
  { until: number; kind: "error" | "throttled" | "unreachable" }
>();
const cancellations = new Set<() => void>();

function provider(): Provider {
  try {
    const api = (Zotero as any).PDFTranslate?.api;
    if (typeof api?.translate === "function")
      return {
        id: "pdftranslate",
        label: "Translate for Zotero",
        api,
        translate: api.translate,
      };
  } catch {
    // A missing/disabled plugin is not a configured provider failure.
  }
  return { id: "bing", label: "Microsoft Translator" };
}

/** Discovery is read-only. No translation runs until translateAbstract is called. */
export function translationProvider(): { id: string; label: string } {
  const { id, label } = provider();
  return { id, label };
}

function plainText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string" || raw.length > max) return undefined;
  // Treat all markup-looking content literally; never parse a translation as HTML.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(raw))
    return undefined;
  const text = raw.replace(/\r\n?/g, "\n").trim();
  return text || undefined;
}

const BING_HEADINGS: Readonly<Record<string, string>> = {
  background: "背景",
  methods: "方法",
  results: "结果",
  conclusions: "结论",
  objective: "目的",
  objectives: "目的",
};

function bingSource(text: string): string {
  // A standalone "Results" was observed to become "election results". Keep
  // known section labels unambiguous while sending the full body once, in
  // context. Same-line prose, drug names and statistical expressions stay exact.
  return text.replace(
    /^([\t ]*)(Background|Methods|Results|Conclusions|Objectives?)([\t ]*[:：]?[\t ]*)$/gim,
    (_, before: string, heading: string, after: string) =>
      before + BING_HEADINGS[heading.toLowerCase()] + after,
  );
}

/** Bound uncancellable third-party tasks and discard results after cancellation. */
function bounded(
  task: Promise<AbstractTranslationResult>,
  valid: () => boolean,
): Promise<AbstractTranslationResult> {
  return new Promise((resolve) => {
    const deadline = Date.now() + TIMEOUT;
    let timer: number | undefined;
    let settled = false;
    const finish = (result: AbstractTranslationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cancellations.delete(cancel);
      resolve(valid() ? result : { kind: "cancelled" });
    };
    const cancel = () => finish({ kind: "cancelled" });
    const check = () => {
      if (!valid()) return cancel();
      if (Date.now() >= deadline) return finish({ kind: "unreachable" });
      timer = setTimeout(check, 200);
    };
    cancellations.add(cancel);
    task.then(finish, () => finish({ kind: "error" }));
    check();
  });
}

async function requestTranslation(
  selected: Provider,
  text: string,
  valid: () => boolean,
): Promise<AbstractTranslationResult> {
  if (!valid()) return { kind: "cancelled" };
  try {
    let translated: unknown;
    if (selected.translate) {
      // Official custom API: no itemID and explicit languages avoid item-field
      // inference/writes. Never inspect/log the secret-bearing task on failure.
      const task = (await selected.translate.call(selected.api, text, {
        pluginID: config.addonID,
        langfrom: FROM,
        langto: TO,
      })) as { status?: unknown; result?: unknown } | null;
      if (task?.status !== "success") return { kind: "error" };
      translated = task.result;
    } else {
      const response = await http.requestResult("POST", BING_URL, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([bingSource(text)]),
        responseType: "json",
        secret: true,
        noCache: true,
        retries: 0,
        timeout: 20_000,
        shouldContinue: valid,
      });
      if (response.kind !== "ok")
        return {
          kind: response.kind === "not-found" ? "error" : response.kind,
        };
      const rows = response.value;
      if (!Array.isArray(rows) || rows.length !== 1) return { kind: "error" };
      if (!Array.isArray(rows[0]?.translations)) return { kind: "error" };
      translated = rows[0]?.translations?.[0]?.text;
    }
    const result = plainText(translated, MAX_RESULT);
    return result
      ? { kind: "ok", text: result, provider: selected.label }
      : { kind: "error" };
  } catch {
    // Provider errors may contain request bodies, task secrets or credentials.
    return { kind: valid() ? "error" : "cancelled" };
  }
}

/** Explicit user action only. Memory cache, never Zotero fields or disk storage. */
export async function translateAbstract(
  source: string,
  options: { shouldContinue?: () => boolean } = {},
): Promise<AbstractTranslationResult> {
  const selected = provider();
  const epoch = generation;
  const valid = () => {
    try {
      const current = provider();
      return (
        epoch === generation &&
        addon.data.alive &&
        options.shouldContinue?.() !== false &&
        current.id === selected.id &&
        current.translate === selected.translate
      );
    } catch {
      return false;
    }
  };
  if (!valid()) return { kind: "cancelled" };
  const text = plainText(source, MAX_SOURCE);
  if (!text) return { kind: "error" };
  // Keep the entire source in the key: equal prefixes are not equal abstracts.
  const key = `${selected.id}\0${FROM}\0${TO}\0${source}`;
  const hit = completed.get(key);
  if (
    hit &&
    hit.translate === selected.translate &&
    Date.now() - hit.at < CACHE_TTL
  ) {
    completed.delete(key);
    completed.set(key, hit);
    return { kind: "ok", text: hit.text, provider: selected.label };
  }
  completed.delete(key);
  const backoff = cooldown.get(selected.id);
  if (backoff && backoff.until > Date.now()) return { kind: backoff.kind };
  let job = pending.get(key);
  if (!job || ![...job.consumers].some((consumer) => consumer())) {
    if (!job && pending.size >= MAX_PENDING) return { kind: "throttled" };
    const consumers = new Set([valid]);
    const wanted = () => [...consumers].some((consumer) => consumer());
    job = {
      consumers,
      promise: Promise.resolve().then(async () => {
        const result = await bounded(
          requestTranslation(selected, text, wanted),
          wanted,
        );
        if (!wanted()) return { kind: "cancelled" };
        if (result.kind === "ok" && result.text) {
          completed.set(key, {
            text: result.text,
            at: Date.now(),
            translate: selected.translate,
          });
          while (completed.size > MAX_CACHE)
            completed.delete(completed.keys().next().value!);
        } else if (
          result.kind === "error" ||
          result.kind === "unreachable" ||
          result.kind === "throttled"
        ) {
          cooldown.set(selected.id, {
            kind: result.kind,
            until: Date.now() + (result.kind === "throttled" ? 30_000 : 5_000),
          });
        }
        return result;
      }),
    };
    pending.set(key, job);
  } else job.consumers.add(valid);
  try {
    const result = await job.promise;
    return valid() ? { ...result } : { kind: "cancelled" };
  } catch {
    return { kind: valid() ? "error" : "cancelled" };
  } finally {
    job.consumers.delete(valid);
    if (!job.consumers.size && pending.get(key) === job) pending.delete(key);
  }
}

/** Release sensitive source/result memory and invalidate all pending consumers. */
export function stopAbstractTranslations(): void {
  generation++;
  completed.clear();
  pending.clear();
  for (const cancel of [...cancellations]) cancel();
}
