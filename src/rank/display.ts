import { getString } from "../utils/locale";
import { valueOf, type JournalRecord, type RankValue } from "./types";

/**
 * Locale-aware text for rank badges. The cached/API value stays untouched:
 * this module is the final, UI-only boundary for source labels that arrive in
 * Chinese from easyScholar.
 */
export interface RankValueDisplay {
  /** Compact text used inside the badge. */
  text: string;
  /** Expanded text used in the badge tooltip. */
  description: string;
}

const CATEGORY_IDS = {
  医学: ["rank-category-medicine", "rank-category-medicine-short"],
  "医学：内科": [
    "rank-category-internal-medicine",
    "rank-category-internal-medicine-short",
  ],
  临床医学: [
    "rank-category-clinical-medicine",
    "rank-category-clinical-medicine-short",
  ],
  综合性期刊: [
    "rank-category-multidisciplinary",
    "rank-category-multidisciplinary-short",
  ],
  多学科: [
    "rank-category-multidisciplinary",
    "rank-category-multidisciplinary-short",
  ],
  综合性医疗卫生: [
    "rank-category-general-medicine-health",
    "rank-category-general-medicine-health-short",
  ],
  数学: ["rank-category-mathematics", "rank-category-mathematics-short"],
  物理与天体物理: [
    "rank-category-physics-astronomy",
    "rank-category-physics-astronomy-short",
  ],
  化学: ["rank-category-chemistry", "rank-category-chemistry-short"],
  材料科学: [
    "rank-category-materials-science",
    "rank-category-materials-science-short",
  ],
  地球科学: ["rank-category-geosciences", "rank-category-geosciences-short"],
  地学: ["rank-category-geosciences", "rank-category-geosciences-short"],
  环境科学与生态学: [
    "rank-category-environment-ecology",
    "rank-category-environment-ecology-short",
  ],
  农林科学: [
    "rank-category-agriculture-forestry",
    "rank-category-agriculture-forestry-short",
  ],
  工程技术: [
    "rank-category-engineering-technology",
    "rank-category-engineering-technology-short",
  ],
  生物学: ["rank-category-biology", "rank-category-biology-short"],
  社会科学: [
    "rank-category-social-sciences",
    "rank-category-social-sciences-short",
  ],
  管理学: ["rank-category-management", "rank-category-management-short"],
} as const;

const EXACT_VALUE_IDS = {
  核心库: "rank-value-core-collection",
  中国科技核心期刊: "rank-value-china-st-core",
  国内一级学术期刊: "rank-value-national-tier-one",
  学科群一流期刊: "rank-value-first-class-discipline",
  超一流期刊: "rank-value-premier-journal",
  顶尖期刊: "rank-value-top-journal",
} as const;

const CHINESE_TIERS: Record<string, string> = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
};

/**
 * Fixed field identifiers returned by easyScholar's `officialRank.all`.
 * Custom datasets share the same source stamp but use an arbitrary `abbName`,
 * so provenance alone cannot decide whether a Chinese value is safe to
 * localize. Keeping the known official keys here prevents a custom field such
 * as `myCustom=医学1区` from being rewritten behind the user's back.
 */
const OFFICIAL_EASYSCHOLAR_FIELDS = new Set([
  "ahci",
  "ajg",
  "ccf",
  "cju",
  "cpu",
  "cqu",
  "cscd",
  "cssci",
  "cufe",
  "cug",
  "eii",
  "esi",
  "fdu",
  "fms",
  "ft50",
  "hhu",
  "jci",
  "nju",
  "pku",
  "ruc",
  "sci",
  "scibase",
  "sciif",
  "sciif5",
  "sciup",
  "sciupsmall",
  "sciuptop",
  "sciwarn",
  "scu",
  "sdufe",
  "sjtu",
  "ssci",
  "swjtu",
  "swufe",
  "uibe",
  "utd24",
  "xdu",
  "xju",
  "xmu",
  "xr",
  "xrsmall",
  "xrtop",
  "xrwarn",
  "zhongguokejihexin",
  "zju",
]);

function original(value: string): RankValueDisplay {
  return { text: value, description: value };
}

function chineseUI(): boolean {
  return /^zh(?:-|$)/i.test(String((Zotero as any).locale || ""));
}

const SHIPPED_RANK_FIELD_ORDERS = new Set([
  // 1.0.9 and earlier: CAS -> IF -> JCR
  "sciup,sciif,sci",
  // Previous default: CAS -> JCR -> IF
  "sciup,sci,sciif",
  // Current default: XinRui (CAS fallback) -> JCR -> IF
  "xr,sci,sciif",
]);

/**
 * Missing/unknown values must not suppress a usable CAS fallback. Preserve
 * unfamiliar subject names and ranking labels rather than trying to guess
 * their meaning; only explicit missing sentinels and malformed values fail.
 */
function usableXinRui(rec: JournalRecord | undefined): boolean {
  const value = valueOf(rec, "xr")?.value;
  if (typeof value !== "string") return false;
  const text = value.trim().normalize("NFKC").replace(/\s+/g, "");
  if (!text || /^[{[]/.test(text)) return false;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return /^[1-5]$/.test(text);
  const zone = text.match(
    /([+-]?(?:\d+(?:\.\d*)?|\.\d+)|[零〇一二两三四五六七八九十百千万亿壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬億]+)区[。.!！]*$/,
  );
  if (zone) {
    const number = Number(zone[1]);
    return Number.isNaN(number)
      ? /^[一二两三四五壹贰貳叁參肆伍]$/.test(zone[1])
      : Number.isInteger(number) && number >= 1 && number <= 5;
  }
  return !/^(?:n\/?a|n\.a\.?|none|null|undefined|unknown|nan|[+-]?infinity|false|true|not(?:available|found|ranked)|暂无(?:数据|分区|排名)?|无(?:数据|分区|排名)?|未知|未(?:分区|收录|评级)|不(?:适用|详)|[-—–/?？]+)$/i.test(
    text,
  );
}

/**
 * Resolve the one primary partition slot in shipped defaults without writing
 * preferences or modifying the record. Chinese puts XinRui (or CAS) first;
 * English keeps JCR first. All other field lists are user-authored and win,
 * including lists that explicitly request both ranking systems. Resolve
 * before Map so a user-hidden field stays hidden instead of reviving CAS.
 */
export function rankFieldsForDisplay(
  fields: string[],
  rec?: JournalRecord,
): string[] {
  const normalized = fields.map((field) => field.toLowerCase()).join(",");
  if (!SHIPPED_RANK_FIELD_ORDERS.has(normalized)) return fields;
  const primary = usableXinRui(rec) ? "xr" : "sciUp";
  return chineseUI() ? [primary, "sci", "sciif"] : ["sci", primary, "sciif"];
}

interface CategoryDisplay {
  short: string;
  long: string;
}

function categoryDisplay(raw: string): CategoryDisplay | null {
  const key = raw
    .replace(/\s+/g, "")
    .replace(/:/g, "：") as keyof typeof CATEGORY_IDS;
  const ids = CATEGORY_IDS[key];
  return ids ? { long: getString(ids[0]), short: getString(ids[1]) } : null;
}

function rankingSystem(field: string): "xr" | "cas" | null {
  const key = field.toLowerCase();
  if (/^xr(?:small|top|warn)?$/.test(key)) return "xr";
  if (/^sciup(?:small|top)?$/.test(key) || key === "scibase") return "cas";
  return null;
}

function isKnownLocalizedField(field: string): boolean {
  return OFFICIAL_EASYSCHOLAR_FIELDS.has(field.toLowerCase());
}

function zoneDisplay(
  category: CategoryDisplay | null,
  zone: string,
): RankValueDisplay {
  if (category) {
    return {
      text: getString("rank-value-category-zone-short", {
        args: { category: category.short, zone },
      }),
      description: getString("rank-value-category-zone-long", {
        args: { category: category.long, zone },
      }),
    };
  }
  return {
    text: getString("rank-value-zone-short", { args: { zone } }),
    description: getString("rank-value-zone-long", { args: { zone } }),
  };
}

function gradeDisplay(
  category: CategoryDisplay,
  grade: string,
): RankValueDisplay {
  return {
    text: getString("rank-value-category-grade-short", {
      args: { category: category.short, grade },
    }),
    description: getString("rank-value-category-grade-long", {
      args: { category: category.long, grade },
    }),
  };
}

/**
 * Translate only recognised standard labels. Migrated caches can mark the
 * same CAS/easyScholar fields as `dataset`, so known field semantics matter
 * more than the provenance stamp. Unknown custom fields remain verbatim.
 */
export function rankValueDisplay(
  value: RankValue,
  sourceField = value.field,
  customized = false,
): RankValueDisplay {
  const raw = String(value.value ?? "");
  if (!raw || customized || !isKnownLocalizedField(sourceField)) {
    return original(raw);
  }
  // Source wording stays intact in Chinese; locale templates choose whether
  // the compact badge includes a ranking-system prefix.
  const display = chineseUI() ? original(raw) : localizedValueDisplay(raw);
  const system = rankingSystem(sourceField);
  if (!system) return display;
  return {
    text: getString(
      system === "xr" ? "rank-value-xr-short" : "rank-value-cas-short",
      { args: { value: display.text } },
    ),
    description: getString(
      system === "xr" ? "rank-value-xr-long" : "rank-value-cas-long",
      { args: { value: display.description } },
    ),
  };
}

/** Translate recognized labels only; unknown subject names remain verbatim. */
function localizedValueDisplay(raw: string): RankValueDisplay {
  const cleaned = raw.trim().replace(/[。．]+$/, "");
  const exact = EXACT_VALUE_IDS[cleaned as keyof typeof EXACT_VALUE_IDS];
  if (exact) {
    const text = getString(exact);
    return { text, description: text };
  }

  const categoryOnly = categoryDisplay(cleaned);
  if (categoryOnly) {
    return { text: categoryOnly.short, description: categoryOnly.long };
  }

  // CAS/easyScholar values commonly combine a broad category with its zone:
  // “医学1区”, “综合性期刊1区”, or “医学：内科1区。”.
  const zoned = cleaned.match(/^(.*?)([1-5一二三四五])\s*区$/);
  if (zoned) {
    const category = zoned[1] ? categoryDisplay(zoned[1]) : null;
    if (!zoned[1] || category) {
      return zoneDisplay(category, CHINESE_TIERS[zoned[2]] || zoned[2]);
    }
  }

  const classed = cleaned.match(/^([A-E](?:\+\+|\+|-)?|[1-5])\s*类$/i);
  if (classed) {
    const text = getString("rank-value-class", {
      args: { grade: classed[1].toUpperCase() },
    });
    return { text, description: text };
  }

  // Other known systems append TOP/T1/A to the same broad-category names.
  const categoryGrade = cleaned.match(
    /^(.+?)(TOP|T[1-5]|A(?:\+\+|\+|-)?|[B-E](?:\+|-)?)$/i,
  );
  if (categoryGrade) {
    const category = categoryDisplay(categoryGrade[1]);
    if (category) {
      return gradeDisplay(category, categoryGrade[2].toUpperCase());
    }
  }
  const gradeCategory = cleaned.match(
    /^(TOP|T[1-5]|A(?:\+\+|\+|-)?|[B-E](?:\+|-)?)(.+)$/i,
  );
  if (gradeCategory) {
    const category = categoryDisplay(gradeCategory[2]);
    if (category) {
      return gradeDisplay(category, gradeCategory[1].toUpperCase());
    }
  }

  return original(raw);
}
