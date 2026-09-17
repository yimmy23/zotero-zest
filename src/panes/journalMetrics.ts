import { resolveImpactFactor } from "../rank/impactFactor";
import type { JournalRecord } from "../rank/types";
import { getString } from "../utils/locale";

/** In-place journal details over the same validated record used by the IF column. */
export function renderJournalMetrics(
  doc: Document,
  record: JournalRecord | undefined,
  preferredField: string,
): HTMLElement | undefined {
  const metric = resolveImpactFactor(record, preferredField);
  if (!metric) return undefined;
  const jcr = metric.jcr;
  if (!jcr) {
    const missing = doc.createElement("div");
    missing.className = "zest-info-jcr zest-info-provenance";
    const value = doc.createElement("div");
    value.className = "zest-info-copyable";
    value.textContent = getString("if-cell-tip", {
      args: {
        field: metric.field,
        value: metric.raw,
        source:
          metric.source === "dataset"
            ? getString("info-jcr-dataset")
            : metric.source === "easyscholar"
              ? "easyScholar"
              : "OpenAlex",
      },
    });
    const explanation = doc.createElement("div");
    explanation.textContent = getString(
      metric.field.toLowerCase() === "sciif"
        ? "if-percentile-missing"
        : "if-percentile-not-applicable",
    );
    missing.append(value, explanation);
    return missing;
  }

  const details = doc.createElement("details");
  details.className = "zest-info-jcr";
  details.open = false;
  const summary = doc.createElement("summary");
  summary.className = "zest-info-jcr-summary";
  summary.textContent = getString("info-jcr-heading", {
    args: { year: String(jcr.year), count: jcr.categories.length },
  });
  details.appendChild(summary);

  const categories = doc.createElement("ul");
  categories.className = "zest-info-jcr-categories";
  for (const category of jcr.categories) {
    const entry = doc.createElement("li");
    entry.className = "zest-info-jcr-category";
    const name = doc.createElement("div");
    name.className = "zest-info-jcr-name zest-info-copyable";
    name.textContent = category.name;
    const values = doc.createElement("dl");
    values.className = "zest-info-jcr-values";
    const rank = doc.createElement("div");
    const rankLabel = doc.createElement("dt");
    rankLabel.className = "zest-info-jcr-label zest-info-copyable";
    rankLabel.textContent = getString("info-jcr-rank");
    const rankValue = doc.createElement("dd");
    rankValue.className = "zest-info-jcr-number zest-info-copyable";
    const position = /^(\d+)\s*\/\s*(\d+)$/.exec(category.rank || "");
    if (position) {
      rankValue.textContent = position[1];
      const total = doc.createElement("span");
      total.className = "zest-info-jcr-total";
      total.textContent = ` / ${position[2]}`;
      rankValue.appendChild(total);
    } else rankValue.textContent = category.rank || "—";
    rank.append(rankLabel, rankValue);
    const percentile = doc.createElement("div");
    const percentileLabel = doc.createElement("dt");
    percentileLabel.className = "zest-info-jcr-label zest-info-copyable";
    percentileLabel.textContent = getString("info-jcr-percentile");
    const percentileValue = doc.createElement("dd");
    percentileValue.className = "zest-info-jcr-number zest-info-copyable";
    percentileValue.textContent = String(
      Number(category.percentile.toFixed(1)),
    );
    percentile.append(percentileLabel, percentileValue);
    values.append(rank, percentile);
    entry.append(name, values);
    categories.appendChild(entry);
  }
  details.appendChild(categories);
  return details;
}
