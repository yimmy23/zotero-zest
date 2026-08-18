/**
 * CSV cell writer shared by every export in the plugin.
 *
 * Two separate jobs, both required:
 *  - RFC 4180 quoting, so a comma or a newline inside an annotation does not
 *    shift the columns;
 *  - a formula guard. Annotation text and item titles are not our text: a PDF
 *    carries its own annotations and a group library carries a collaborator's,
 *    so a cell can legitimately start with "=", "+", "-" or "@" — which Excel
 *    and LibreOffice then EXECUTE (`=HYPERLINK(...)` exfiltrating neighbouring
 *    cells, or a DDE launch). Prefixing with an apostrophe keeps the text
 *    visible and inert.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** one CSV line from already-stringable values */
export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}
