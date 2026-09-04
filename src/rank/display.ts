import { getString } from "../utils/locale";
import type { RankValue } from "./types";

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
  // Current default: CAS -> JCR -> IF
  "sciup,sci,sciif",
]);

/**
 * Canonicalize both the current and legacy shipped defaults by locale. This
 * gives existing Chinese users the new CAS -> JCR -> IF order without
 * rewriting their preference, while English keeps JCR -> CAS -> IF. Any other
 * field order is user-authored and always wins.
 */
export function rankFieldsForDisplay(fields: string[]): string[] {
  const normalized = fields.map((field) => field.toLowerCase()).join(",");
  if (!SHIPPED_RANK_FIELD_ORDERS.has(normalized)) return fields;
  return chineseUI() ? ["sciUp", "sci", "sciif"] : ["sci", "sciUp", "sciif"];
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

function isCasField(field: string): "upgraded" | "basic" | null {
  const key = field.toLowerCase();
  if (/^sciup(?:small|top)?$/.test(key)) return "upgraded";
  if (key === "scibase") return "basic";
  return null;
}

function isKnownLocalizedField(field: string): boolean {
  return OFFICIAL_EASYSCHOLAR_FIELDS.has(field.toLowerCase());
}

function zoneDisplay(
  field: string,
  category: CategoryDisplay | null,
  zone: string,
): RankValueDisplay {
  const edition = isCasField(field);
  if (edition && category) {
    return {
      text: getString("rank-value-cas-zone-short", {
        args: { category: category.short, zone },
      }),
      description: getString(
        edition === "upgraded"
          ? "rank-value-cas-upgraded-zone-long"
          : "rank-value-cas-basic-zone-long",
        { args: { category: category.long, zone } },
      ),
    };
  }
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
  field: string,
  category: CategoryDisplay,
  grade: string,
): RankValueDisplay {
  const cas = !!isCasField(field);
  return {
    text: getString(
      cas ? "rank-value-cas-grade-short" : "rank-value-category-grade-short",
      { args: { category: category.short, grade } },
    ),
    description: getString(
      cas ? "rank-value-cas-grade-long" : "rank-value-category-grade-long",
      { args: { category: category.long, grade } },
    ),
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
): RankValueDisplay {
  const raw = String(value.value ?? "");
  if (!raw || !isKnownLocalizedField(sourceField)) {
    return original(raw);
  }
  // Chinese users keep the source wording byte-for-byte, including source
  // punctuation. Other Zotero locales fall back to the bundled English FTL.
  if (chineseUI()) return original(raw);

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
      return zoneDisplay(
        sourceField,
        category,
        CHINESE_TIERS[zoned[2]] || zoned[2],
      );
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
      return gradeDisplay(
        sourceField,
        category,
        categoryGrade[2].toUpperCase(),
      );
    }
  }
  const gradeCategory = cleaned.match(
    /^(TOP|T[1-5]|A(?:\+\+|\+|-)?|[B-E](?:\+|-)?)(.+)$/i,
  );
  if (gradeCategory) {
    const category = categoryDisplay(gradeCategory[2]);
    if (category) {
      return gradeDisplay(
        sourceField,
        category,
        gradeCategory[1].toUpperCase(),
      );
    }
  }

  return original(raw);
}
