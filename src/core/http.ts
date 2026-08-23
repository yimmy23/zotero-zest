import { getNumPref, getPref } from "../utils/prefs";

/**
 * HTTP layer shared by all metadata sources.
 *
 * - de-duplicates identical in-flight requests
 * - memory cache with TTL (bounded, LRU eviction)
 * - per-host concurrency limit so no API gets hammered
 * - retry with backoff on 429 / 5xx (honors Retry-After)
 * - never throws: resolves null on failure (logged)
 */

interface RequestOptions {
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
    this.active++;
  }

  release() {
    this.active--;
    // LIFO: wake the most recently queued waiter first, so the newest
    // user action (e.g. the currently hovered popup) jumps the queue
    const next = this.queue.pop();
    if (next) next();
  }
}

/** cached marker for "this lookup failed recently" */
const NULL_SENTINEL = Object.freeze({ __refsNull: true });
const NULL_TTL = 10 * 60 * 1000;

/** hide credentials in anything we log or use as a cache key */
export function redactURL(url: string): string {
  return url.replace(
    /([?&])(secret_?key|api_?key|apikey|token|password|mailto)=[^&]*/gi,
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

  /** ms until `url`'s host may be asked again; 0 when it is fine */
  throttledFor(url: string): number {
    const until = this.throttledUntil.get(hostOf(url)) || 0;
    return Math.max(0, until - Date.now());
  }

  /** true when a request failed at the transport level in the last minute */
  recentlyUnreachable(): boolean {
    return Date.now() - this.lastTransportFailure < 60_000;
  }

  async request<T = any>(
    method: "GET" | "POST",
    url: string,
    options: RequestOptions = {},
  ): Promise<T | null> {
    const key = `${method} ${redactURL(url)} ${options.body || ""}`;
    if (options.noCache || options.displayURL) {
      return this.doRequest(method, url, options);
    }
    const cached = this.cacheGet(key);
    if (cached === NULL_SENTINEL) return null;
    if (cached !== undefined) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = this.doRequest(method, url, options)
      .then((result) => {
        if (result !== null) {
          this.cacheSet(key, result, options.ttl ?? this.defaultTTL());
        } else if (options.ttl !== 0) {
          // negative cache: a 404 / failed lookup is not retried on every
          // re-hover; short TTL so a transient outage heals itself
          this.cacheSet(key, NULL_SENTINEL, NULL_TTL);
        }
        return result;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  private async doRequest(
    method: "GET" | "POST",
    url: string,
    options: RequestOptions,
  ): Promise<any> {
    const gate = this.gateFor(url);
    const maxRetries = options.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      await gate.acquire();
      // every path that falls through to the delay assigns retryWait first
      let retryWait!: number;
      try {
        if (options.secret) {
          const out = await rawRequest(method, url, options);
          return out;
        }
        const xhr = await Zotero.HTTP.request(method, url, {
          headers: options.headers,
          body: options.body,
          responseType: options.responseType ?? "json",
          timeout: options.timeout ?? DEFAULT_TIMEOUT,
          successCodes: false,
        });
        const status = xhr.status;
        if (status >= 200 && status < 300) {
          // `responseText` throws (InvalidStateError) once responseType is
          // "json"; an empty or non-JSON 2xx body simply has no value
          return (options.responseType ?? "json") === "json"
            ? (xhr.response ?? null)
            : (xhr.response ?? xhr.responseText ?? null);
        }
        if (status === 0) {
          // Zotero resolves the xhr with status 0 on a transport failure
          this.lastTransportFailure = Date.now();
        }
        if (status === 429 || status >= 500) {
          const retryAfter = Number(xhr.getResponseHeader?.("Retry-After"));
          const asked =
            retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
          if (attempt < maxRetries && asked <= MAX_RETRY_WAIT) {
            retryWait = asked;
            ztoolkit.log(
              `[http] ${status} ${options.displayURL ?? redactURL(url)}, retry in ${retryWait}ms`,
            );
          } else {
            // retries exhausted, or a server asking us to wait an hour: back
            // off from this host and tell callers so a batch can stop
            this.throttledUntil.set(
              hostOf(url),
              Date.now() + Math.min(Math.max(asked, 30_000), MAX_RETRY_WAIT),
            );
            ztoolkit.log(
              `[http] ${status} ${options.displayURL ?? redactURL(url)} — backing off`,
            );
            return null;
          }
        } else {
          ztoolkit.log(
            `[http] ${method} ${options.displayURL ?? redactURL(url)} -> ${status}`,
          );
          return null;
        }
      } catch (e) {
        this.lastTransportFailure = Date.now();
        if (attempt < maxRetries) {
          retryWait = 1000 * 2 ** attempt;
        } else {
          ztoolkit.log(
            `[http] ${method} ${options.displayURL ?? redactURL(url)} failed`,
            e,
          );
          return null;
        }
      } finally {
        gate.release();
      }
      await Zotero.Promise.delay(retryWait);
    }
  }
}

/**
 * Minimal XHR for credential-bearing requests: same contract as the Zotero
 * helper (resolve the parsed body, or null), but nothing is logged.
 */
async function rawRequest(
  method: "GET" | "POST",
  url: string,
  options: RequestOptions,
): Promise<any> {
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
          resolve(
            xhr.status >= 200 && xhr.status < 300
              ? parse(xhr.responseText)
              : null,
          );
        };
        xhr.onerror = () => resolve(null);
        xhr.ontimeout = () => resolve(null);
        xhr.send(options.body ?? undefined);
      } catch {
        resolve(null);
      }
    });
  }

  // 2. no window (headless startup): fetch, which the plugin sandbox provides
  try {
    const res = await fetch(url, {
      method,
      headers: options.headers,
      body: options.body,
    });
    if (!res.ok) return null;
    return parse(await res.text());
  } catch {
    return null;
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
