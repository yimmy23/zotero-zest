import { statSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { log } from "node:console";

// Keep routine releases close to the 296 KiB baseline. Raising this budget is
// an explicit product tradeoff, not a side effect of adding bundled data.
const limit = 350 * 1024;
const file =
  process.argv[2] || new URL("../.scaffold/build/zest.xpi", import.meta.url);
const size = statSync(file).size;
if (size > limit) {
  throw new Error(
    `Zest package is ${(size / 1024).toFixed(1)} KiB; the budget is 350 KiB. Review bundled data before increasing it.`,
  );
}
log(`Package size: ${(size / 1024).toFixed(1)} / 350 KiB`);
