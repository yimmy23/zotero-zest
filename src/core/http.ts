import { getNumPref, getPref } from "../utils/prefs";
import { setTimeout, clearTimeout } from "../utils/timers";

/**
 * HTTP layer shared by all metadata sources.
 *
 * - de-duplicates identical in-flight requests
 * - memory cache with TTL (bounded, LRU eviction)
 * - per-host concurrency limit so no API gets hammered
 * - host-wide backoff on 429, bounded retries for 5xx / transport failures
 * - body/null compatibility API plus explicit failure outcomes for batch callers
 */

export interface RequestOptions {
  headers?: Record<string, string>;
  body?: string;
  responseType?: "json" | "text";
  /** cache time-to-live in ms; 0 disables caching. Default: pref cacheTTLHours */
  ttl?: number;
  timeout?: number;
  retries?: number;
  noCache?: boolean;
  /**
   * Safe stand-in for the URL in OUR log lines. Set it whenever the real URL
   * carries a credential; requests that set it are never cached, because the
   * cache is keyed by URL and would hold the secret in memory.
   */
  displayURL?: string;
  /**
   * The URL carries a credential. Such a request is sent with a bare
   * XMLHttpRequest instead of `Zotero.HTTP.request`, because Zotero logs every
   * request URL to the debug console and its redaction only covers `key=`.
   */
  secret?: boolean;
  /** Rechecked when a queued request is about to run and after every await. */
  shouldContinue?: () => boolean;
  /** Record service-wide signals even when this consumer was cancelled. */
  observeResponse?: (status: number, value: any) => void;
}

export interface HttpResult<T = any> {
  kind:
    "ok" | "not-found" | "throttled" | "unreachable" | "error" | "cancelled";
  value: T | null;
  status: number;
}

interface TransportResult {
  status: number;
  value: any;
  retryAfter?: string | null;
}

function permitted(options: RequestOptions): boolean {
  try {
    return options.shouldContinue?.() !== false;
  } catch {
    return false;
  }
}

function retryAfterMs(raw: string | null | undefined): number {
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

interface CacheEntry {
  t: number;
  ttl: number;
  v: any;
  bytes: number;
}

const MAX_CACHE_ENTRIES = 500;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT = 15000;
/** never sleep longer than this on a Retry-After, however big it says */
const MAX_RETRY_WAIT = 60000;
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const HOST_LIMITS: Record<string, number> = {
  "api.crossref.org": 3,
  "api.semanticscholar.org": 2,
  "api.openalex.org": 4,
  default: 4,
};

class HostGate {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private limit: number) {}

  async acquire() {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release() {
    // Transfer the occupied slot directly. Decrementing before a waiter wakes
    // lets a new request steal that slot and exceed the concurrency limit.
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
}

const NULL_TTL = 10 * 60 * 1000;

/** hide credentials in anything we log or use as a cache key */
export function redactURL(url: string): string {
  // compound names too: access_token, client_secret, x_api_key, …
  return url.replace(
    /([?&])([a-z0-9_-]*(?:secret|api_?key|apikey|token|password|passwd|mailto)[a-z0-9_-]*)=[^&#]*/gi,
    "$1$2=***",
  );
}

class Http {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<any>>();
  private gates = new Map<string, HostGate>();

  private defaultTTL() {
    return getNumPref("network.cacheTTLHours", 168) * 3600 * 1000;
  }

  private gateFor(url: string) {
    let host = "default";
    try {
      host = new URL(url).host;
    } catch {
      // not a URL — use the default gate
    }
    let gate = this.gates.get(host);
    if (!gate) {
      gate = new HostGate(HOST_LIMITS[host] ?? HOST_LIMITS.default);
      this.gates.set(host, gate);
    }
    return gate;
  }

  private cacheGet(key: string) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.t > entry.ttl) {
      this.cache.delete(key);
      this.cacheBytes -= entry.bytes;
      return undefined;
    }
    // LRU: refresh position
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.v;
  }

  private cacheBytes = 0;

  private cacheSet(key: string, v: any, ttl: number) {
    if (ttl <= 0) return;
    let bytes: number;
    try {
      bytes = typeof v === "string" ? v.length : JSON.stringify(v)?.length || 0;
    } catch {
      bytes = 0;
    }
    if (bytes > MAX_ENTRY_BYTES) return;
    const previous = this.cache.get(key);
    if (previous) {
      this.cacheBytes -= previous.bytes;
      this.cache.delete(key);
    }
    while (
      this.cache.size >= MAX_CACHE_ENTRIES ||
      this.cacheBytes + bytes > MAX_CACHE_BYTES
    ) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cacheBytes -= this.cache.get(oldest)?.bytes || 0;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { t: Date.now(), ttl, v, bytes });
    this.cacheBytes += bytes;
  }

  /**
   * Hosts that told us to back off (429 / 5xx with retries exhausted, or a
   * Retry-After we refused to honour) and when the back-off ends; plus the
   * moment of the last transport failure (offline, timeout). Batch callers
   * read these to stop instead of burning the rest of a batch on refusals.
   */
  private throttledUntil = new Map<string, number>();
  private lastTransportFailure = 0;
  private transportFailures = new Map<string, number>();

  private noteTransportFailure(url: string) {
    this.lastTransportFailure = Date.now();
    this.transportFailures.set(hostOf(url), this.lastTransportFailure);
  }

  /** ms until `url`'s host may be asked again; 0 when it is fine */
  throttledFor(url: string): number {
    const until = this.throttledUntil.get(hostOf(url)) || 0;
    return Math.max(0, until - Date.now());
  }

  /** true when a request failed at the transport level in the last minute */
  recentlyUnreachable(url?: string): boolean {
    const last = url
      ? this.transportFailures.get(hostOf(url))
      : this.lastTransportFailure;
    return last !== undefined && Date.now() - last < 60_000;
  }

  /**
   * One request, answered with the HTTP status only (0 = could not connect).
   * For "is this key valid?" checks in Settings: nothing is cached, nothing is
   * logged, the headers may carry a key.
   */
  probe(
    url: string,
    headers: Record<string, string> = {},
    timeout = 10000,
  ): Promise<number> {
    return new Promise((resolve) => {
      try {
        const win = Zotero.getMainWindow() as any;
        const xhr = new win.XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.timeout = timeout;
        for (const [k, v] of Object.entries(headers))
          xhr.setRequestHeader(k, v);
        xhr.onload = () => resolve(xhr.status);
        xhr.onerror = () => resolve(0);
        xhr.ontimeout = () => resolve(0);
        xhr.send();
      } catch {
        resolve(0);
      }
    });
  }

  async request<T = any>(
    method: "GET" | "POST",
    url: string,
    options: RequestOptions = {},
  ): Promise<T | null> {
    const result = await this.requestResult<T>(method, url, options);
    return result.kind === "ok" ? result.value : null;
  }

  /** Keep transport failures distinct from a source's genuine missing record. */
  async requestResult<T = any>(
    method: "GET" | "POST",
    url: string,
    options: RequestOptions = {},
  ): Promise<HttpResult<T>> {
    if (!permitted(options))
      return { kind: "cancelled", value: null, status: 0 };
    const key = `${method} ${redactURL(url)} ${options.body || ""}`;
    // a secret-bearing response must never sit in the shared cache — today's
    // call sites also pass noCache, but the flag alone has to be enough
    if (options.noCache || options.displayURL || options.secret) {
      return this.doRequest(method, url, options);
    }
    const cached = this.cacheGet(key);
    if (cached !== undefined) return cached;
    // A caller-specific lifetime must not cancel another caller's request.
    // It can still reuse/cache completed public responses safely.
    const pending = !options.shouldContinue && this.inflight.get(key);
    if (pending) return pending;
    const promise = this.doRequest(method, url, options)
      .then((result) => {
        if (result.kind === "ok") {
          this.cacheSet(key, result, options.ttl ?? this.defaultTTL());
        } else if (result.kind === "not-found" && options.ttl !== 0) {
          // Only a genuine missing record is a negative-cache candidate.
          this.cacheSet(key, result, NULL_TTL);
        }
        return result;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    if (!options.shouldContinue) this.inflight.set(key, promise);
    return promise;
  }

  private async doRequest(
    method: "GET" | "POST",
    url: string,
    options: RequestOptions,
  ): Promise<HttpResult> {
    const gate = this.gateFor(url);
    const maxRetries = options.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      if (!permitted(options))
        return { kind: "cancelled", value: null, status: 0 };
      if (this.throttledFor(url))
        return { kind: "throttled", value: null, status: 429 };
      await gate.acquire();
      // every path that falls through to the delay assigns retryWait first
      let retryWait!: number;
      try {
        if (!permitted(options))
          return { kind: "cancelled", value: null, status: 0 };
        if (this.throttledFor(url))
          return { kind: "throttled", value: null, status: 429 };
        const out = options.secret
          ? await rawRequest(method, url, options)
          : await publicRequest(method, url, options);
        const status = out.status;
        const asked = retryAfterMs(out.retryAfter) || 1000 * 2 ** attempt;
        const cancelled = !permitted(options);
        // Cancellation belongs to a consumer. Server back-off still applies
        // to every queued consumer and must survive discarding this body.
        if (
          status === 429 ||
          (status >= 500 &&
            (cancelled || attempt >= maxRetries || asked > MAX_RETRY_WAIT))
        ) {
          this.throttledUntil.set(
            hostOf(url),
            Date.now() + Math.max(asked, 30_000),
          );
        }
        if (status === 0) this.noteTransportFailure(url);
        try {
          options.observeResponse?.(status, out.value);
        } catch {
          // A source observer must not change transport classification.
        }
        if (cancelled) return { kind: "cancelled", value: null, status };
        if (status >= 200 && status < 300) {
          return {
            kind: out.value === null ? "error" : "ok",
            value: out.value,
            status,
          };
        }
        if (status === 429 || status >= 500 || status === 0) {
          // A rate limit applies to the whole host, not just this DOI. Return
          // immediately so the batch stops and queued requests see the block.
          if (
            status !== 429 &&
            attempt < maxRetries &&
            asked <= MAX_RETRY_WAIT
          ) {
            retryWait = asked;
            ztoolkit.log(
              `[http] ${status} ${options.displayURL ?? redactURL(url)}, retry in ${retryWait}ms`,
            );
          } else {
            // retries exhausted, or a server asking us to wait an hour: back
            // off from this host and tell callers so a batch can stop
            ztoolkit.log(
              `[http] ${status} ${options.displayURL ?? redactURL(url)} — backing off`,
            );
            return {
              kind: status === 0 ? "unreachable" : "throttled",
              value: null,
              status,
            };
          }
        } else {
          ztoolkit.log(
            `[http] ${method} ${options.displayURL ?? redactURL(url)} -> ${status}`,
          );
          return {
            kind: status === 404 || status === 410 ? "not-found" : "error",
            value: null,
            status,
          };
        }
      } catch {
        this.noteTransportFailure(url);
        if (!permitted(options))
          return { kind: "cancelled", value: null, status: 0 };
        if (attempt < maxRetries) {
          retryWait = 1000 * 2 ** attempt;
        } else {
          ztoolkit.log(
            `[http] ${method} ${options.displayURL ?? redactURL(url)} failed`,
          );
          return { kind: "unreachable", value: null, status: 0 };
        }
      } finally {
        gate.release();
      }
      await Zotero.Promise.delay(retryWait);
    }
  }
}

/**
 * Both transports return status and body so credentials never change error
 * classification. Only the non-secret transport uses Zotero's logging helper.
 */
async function publicRequest(
  method: "GET" | "POST",
  url: string,
  options: RequestOptions,
): Promise<TransportResult> {
  const xhr = await Zotero.HTTP.request(method, url, {
    headers: options.headers,
    body: options.body,
    responseType: options.responseType ?? "json",
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    successCodes: false,
  });
  return {
    status: xhr.status,
    retryAfter: xhr.getResponseHeader?.("Retry-After"),
    // responseText throws once responseType is "json".
    value:
      (options.responseType ?? "json") === "json"
        ? (xhr.response ?? null)
        : (xhr.response ?? xhr.responseText ?? null),
  };
}

async function rawRequest(
  method: "GET" | "POST",
  url: string,
  options: RequestOptions,
): Promise<TransportResult> {
  const parse = (text: string) => {
    if ((options.responseType ?? "json") !== "json") return text;
    try {
      return JSON.parse(text || "null");
    } catch {
      return null;
    }
  };

  // 1. the main window's XMLHttpRequest (the XPCOM contract id no longer
  //    exposes nsIXMLHttpRequest, so it cannot be constructed directly)
  const win = Zotero.getMainWindow() as any;
  if (win?.XMLHttpRequest) {
    return new Promise((resolve) => {
      try {
        const xhr = new win.XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.timeout = options.timeout ?? DEFAULT_TIMEOUT;
        for (const [k, v] of Object.entries(options.headers || {})) {
          xhr.setRequestHeader(k, v);
        }
        xhr.onload = () => {
          resolve({
            status: xhr.status,
            value: parse(xhr.responseText),
            retryAfter: xhr.getResponseHeader?.("Retry-After"),
          });
        };
        xhr.onerror =
          xhr.ontimeout =
          xhr.onabort =
            () => resolve({ status: 0, value: null });
        xhr.send(options.body ?? undefined);
      } catch {
        resolve({ status: 0, value: null });
      }
    });
  }

  // 2. no window (headless startup): fetch, which the plugin sandbox provides
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeout ?? DEFAULT_TIMEOUT,
  );
  try {
    const res = await fetch(url, {
      method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    return {
      status: res.status,
      retryAfter: res.headers.get("Retry-After"),
      value: parse(await res.text()),
    };
  } catch {
    return { status: 0, value: null };
  } finally {
    clearTimeout(timer);
  }
}

export const http = new Http();

/**
 * Polite-pool email for Crossref / OpenAlex / Unpaywall — empty when the user
 * has not given one. Callers must then omit the parameter entirely: sending a
 * constant fake address is not what the polite pool asks for, and it would
 * make every Zest user look like one client.
 */
export function politeEmail(): string {
  return ((getPref("network.email") as string) || "").trim();
}

/** `?mailto=…` when the user set an address, otherwise nothing */
export function politeParam(prefix: "?" | "&" = "&"): string {
  const email = politeEmail();
  return email ? `${prefix}mailto=${encodeURIComponent(email)}` : "";
}
