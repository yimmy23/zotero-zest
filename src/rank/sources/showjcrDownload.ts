import { http } from "../../core/http";
import { parseCsvRows, saveShowJCRDataset } from "./localDataset";
import { parseShowJCRRows } from "./showjcr";
import type { DatasetMeta } from "../../core/config";

export const SHOWJCR_YEAR = 2025;
// Pin the reviewed snapshot so an upstream schema/coverage change cannot
// silently replace a complete table. A newer annual table needs an adapter review.
export const SHOWJCR_REVISION = "c8da202c1d39373abdb5b5f936de712bb182ce0b";
export const SHOWJCR_EXPECTED_ROWS = 22643;
export const SHOWJCR_URL =
  `https://raw.githubusercontent.com/hitfyd/ShowJCR/${SHOWJCR_REVISION}/` +
  encodeURIComponent("中科院分区表及JCR原始数据文件") +
  `/JCR${SHOWJCR_YEAR}-UTF8.csv`;
let pending: Promise<DatasetMeta> | undefined;

/** Explicit user action only. Browsing and startup never call this function. */
export function downloadShowJCR(): Promise<DatasetMeta> {
  if (pending) return pending;
  pending = download().finally(() => {
    pending = undefined;
  });
  return pending;
}

async function download(): Promise<DatasetMeta> {
  const valid = () => addon.data.alive;
  const response = await http.requestResult<string>("GET", SHOWJCR_URL, {
    responseType: "text",
    noCache: true,
    retries: 0,
    timeout: 45000,
    shouldContinue: valid,
  });
  if (!valid() || response.kind === "cancelled")
    throw new Error("ShowJCR download cancelled");
  if (response.kind !== "ok" || typeof response.value !== "string")
    throw new Error(
      `ShowJCR download failed (${response.kind}, ${response.status})`,
    );
  if (response.value.length > 16 * 1024 * 1024)
    throw new Error("ShowJCR file exceeds the size limit");
  const parsed = parseShowJCRRows(parseCsvRows(response.value));
  if (!parsed || parsed.rows.length !== SHOWJCR_EXPECTED_ROWS)
    throw new Error("Invalid ShowJCR data; previous table retained");
  if (!valid()) throw new Error("ShowJCR download cancelled");
  return saveShowJCRDataset(parsed);
}
