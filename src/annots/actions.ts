import { getString } from "../utils/locale";
import { iconLabelButton } from "../ui/icons";

/** The card and matrix copy the same plain text, without presentation markup. */
export function annotationCopyText(row: {
  text: string;
  comment: string;
  sourceURL?: string;
}): string {
  return (
    [row.text, row.comment].filter((part) => part.trim()).join("\n\n") ||
    row.sourceURL ||
    ""
  );
}

/** Native buttons share labels and keyboard activation across both surfaces. */
export function annotationActionButton(
  doc: Document,
  kind: "copy" | "open",
  className: string,
): HTMLButtonElement {
  const button = iconLabelButton(
    doc,
    kind === "copy" ? "copy" : "book",
    getString(kind === "copy" ? "anno-action-copy" : "matrix-open"),
    `zest-annotation-action ${className}`,
  );
  button.type = "button";
  button.title = getString(kind === "copy" ? "anno-copy" : "matrix-open");
  return button;
}
