import {
  FORM_PRESETS,
  PROGRESSIONS,
  ROLE_META,
  roleForSymbol
} from "../domain/catalog";
import {
  pickBassOverridesForSections,
  removeBassOverride,
  removeBassOverridesForSections,
  transposeBassOverrides
} from "../domain/bass";
import { getCorpusTransitions } from "../domain/corpus";
import { romanDegree, romanToChord } from "../domain/music";
import { normalizeProductionSettings } from "../domain/production";
import type {
  Arrangement,
  ChordCandidate,
  Mode,
  ProductionSettings,
  ProgressionTemplate,
  SectionRole
} from "../domain/types";

function mulberry32(seed: number) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function selectTemplate(
  mode: Mode,
  role: SectionRole,
  style: string,
  surprise: number,
  random: () => number,
  excludedIds: string[] = []
): ProgressionTemplate {
  const targetEnergy = ROLE_META[role].targetEnergy;
  const targetFamiliarity = 96 - surprise * 0.68;
  const candidates = PROGRESSIONS.filter(
    (item) => item.modes.includes(mode) && !excludedIds.includes(item.id)
  );

  const ranked = candidates
    .map((item) => {
      const roleBoost = item.suitableRoles.includes(role) ? 36 : 0;
      const styleBoost = item.genres.includes(style) ? 22 : 0;
      const energyFit = 22 - Math.abs(item.energy - targetEnergy) * 0.3;
      const familiarityFit =
        24 - Math.abs(item.familiarityIndex - targetFamiliarity) * 0.22;
      const noveltyBoost = surprise * (100 - item.familiarityIndex) * 0.004;
      return {
        item,
        score:
          roleBoost +
          styleBoost +
          energyFit +
          familiarityFit +
          noveltyBoost +
          random() * 14
      };
    })
    .sort((a, b) => b.score - a.score);

  const pool = ranked.slice(0, Math.min(4, ranked.length));
  return pool[Math.floor(random() * pool.length)]?.item ?? candidates[0];
}

function variationFor(
  numerals: string[],
  occurrence: number,
  mode: Mode,
  isFinalSection: boolean
): { numerals: string[]; label?: string } {
  if (occurrence === 0) return { numerals: [...numerals] };
  const result = [...numerals];
  const tonic = mode === "major" ? "I" : "i";
  const dominant = "V";

  if (isFinalSection) {
    result[result.length - 1] = tonic;
    return { numerals: result, label: "终止变体" };
  }

  if (result.length > 2) {
    result[result.length - 1] = dominant;
    return { numerals: result, label: "开放式回转" };
  }

  return { numerals: result, label: "再现" };
}

export function generateArrangement(options: {
  formId: string;
  customPattern?: string;
  key: string;
  mode: Mode;
  style: string;
  surprise: number;
  seed: number;
  production?: Partial<ProductionSettings>;
}): Arrangement {
  const random = mulberry32(options.seed);
  const preset = FORM_PRESETS.find((item) => item.id === options.formId);
  const pattern = (options.customPattern || preset?.pattern || "ABABCB")
    .toUpperCase()
    .replace(/[^A-D]/g, "")
    .slice(0, 9);
  const symbols = [...(pattern || "ABA")];
  const identityTemplates = new Map<string, ProgressionTemplate>();
  const counts = new Map<string, number>();

  const sections = symbols.map((symbol, index) => {
    const occurrence = counts.get(symbol) ?? 0;
    counts.set(symbol, occurrence + 1);
    const role = roleForSymbol(symbol);
    let template = identityTemplates.get(symbol);
    if (!template) {
      template = selectTemplate(
        options.mode,
        role,
        options.style,
        options.surprise,
        random,
        [...identityTemplates.values()].map((item) => item.id)
      );
      identityTemplates.set(symbol, template);
    }

    const variation = variationFor(
      template.numerals,
      occurrence,
      options.mode,
      index === symbols.length - 1
    );
    const titleBase = ROLE_META[role].title;

    return {
      id: symbol + "-" + index + "-" + options.seed,
      symbol,
      occurrence,
      role,
      title: occurrence === 0 ? titleBase : titleBase + " " + (occurrence + 1),
      templateId: template.id,
      numerals: variation.numerals,
      chords: variation.numerals.map((roman) =>
        romanToChord(options.key, options.mode, roman)
      ),
      energy: Math.round(
        (template.energy + ROLE_META[role].targetEnergy) / 2
      ),
      variationLabel: variation.label
    };
  });

  return {
    title: "未命名和声轨道",
    key: options.key,
    mode: options.mode,
    formId: options.formId,
    formPattern: pattern || "ABA",
    style: options.style,
    surprise: options.surprise,
    seed: options.seed,
    lockedSymbols: [],
    bassOverrides: {},
    production: normalizeProductionSettings(options.production),
    sections,
    generatedAt: new Date().toISOString()
  };
}

export function regenerateSectionIdentity(
  arrangement: Arrangement,
  rawSymbol: string,
  seed: number
): Arrangement {
  const symbol = rawSymbol.toUpperCase();
  const targetSections = arrangement.sections.filter(
    (section) => section.symbol === symbol
  );
  if (
    targetSections.length === 0 ||
    arrangement.lockedSymbols.includes(symbol)
  ) {
    return arrangement;
  }

  const random = mulberry32(seed);
  const role = targetSections[0].role;
  const targetSectionIds = new Set(targetSections.map((section) => section.id));
  const excludedIds = [...new Set(
    arrangement.sections.map((section) => section.templateId)
  )];
  const template = selectTemplate(
    arrangement.mode,
    role,
    arrangement.style,
    arrangement.surprise,
    random,
    excludedIds
  );

  return {
    ...arrangement,
    seed,
    bassOverrides: removeBassOverridesForSections(
      arrangement.bassOverrides,
      targetSectionIds
    ),
    sections: arrangement.sections.map((section, index) => {
      if (section.symbol !== symbol) return section;
      const variation = variationFor(
        template.numerals,
        section.occurrence,
        arrangement.mode,
        index === arrangement.sections.length - 1
      );
      return {
        ...section,
        templateId: template.id,
        numerals: variation.numerals,
        chords: variation.numerals.map((roman) =>
          romanToChord(arrangement.key, arrangement.mode, roman)
        ),
        energy: Math.round(
          (template.energy + ROLE_META[role].targetEnergy) / 2
        ),
        variationLabel: variation.label,
        transitionLabel: undefined
      };
    }),
    generatedAt: new Date().toISOString()
  };
}

export function preserveLockedSections(
  current: Arrangement,
  regenerated: Arrangement
): Arrangement {
  const locked = new Set(current.lockedSymbols);
  const lockedSections = new Map(
    current.sections
      .filter((section) => locked.has(section.symbol))
      .map(
        (section): [string, typeof section] => [
          `${section.symbol}:${section.occurrence}`,
          section
        ]
      )
  );
  const lockedSectionIds = new Set(
    current.sections
      .filter((section) => locked.has(section.symbol))
      .map((section) => section.id)
  );

  return {
    ...regenerated,
    lockedSymbols: [...current.lockedSymbols],
    bassOverrides: pickBassOverridesForSections(
      current.bassOverrides,
      lockedSectionIds
    ),
    sections: regenerated.sections.map(
      (section) =>
        lockedSections.get(`${section.symbol}:${section.occurrence}`) ?? section
    )
  };
}

const MAJOR_TRANSITIONS: Record<number, string[]> = {
  1: ["V", "vi", "IV", "ii"],
  2: ["V", "vii°", "IV", "I"],
  3: ["vi", "IV", "ii", "V"],
  4: ["V", "I", "ii", "iv"],
  5: ["I", "vi", "IV", "bVI"],
  6: ["IV", "ii", "V", "I"],
  7: ["I", "iii", "V", "vi"]
};

const MINOR_TRANSITIONS: Record<number, string[]> = {
  1: ["VI", "iv", "V", "VII"],
  2: ["V", "i", "VI", "iv"],
  3: ["VI", "iv", "VII", "V"],
  4: ["V", "i", "VII", "VI"],
  5: ["i", "VI", "III", "iv"],
  6: ["VII", "iv", "V", "i"],
  7: ["III", "i", "VI", "V"]
};

const REASONS = [
  "功能方向最清楚，适合作为安全落点",
  "保留共同音，同时改变段落明暗",
  "增加向前推动力，不会立刻结束句子",
  "较少见的色彩选择，适合制造转折"
];

export function getNextCandidates(
  currentRoman: string,
  mode: Mode
): ChordCandidate[] {
  const corpusTransitions = getCorpusTransitions(currentRoman).slice(0, 4);
  if (corpusTransitions.length >= 4) {
    return corpusTransitions.map((item, index) => ({
      roman: item.to,
      weight: Number((item.probability * 100).toFixed(1)),
      label: index === 0 ? "语料首选" : "POP909 分支",
      reason:
        "在 POP909 中记录 " +
        item.count +
        " 次，覆盖 " +
        item.songCount +
        " 首歌曲",
      source: "POP909",
      count: item.count,
      songCount: item.songCount,
      songCoverage: item.songCoverage
    }));
  }

  const degree = romanDegree(currentRoman);
  const transitions =
    (mode === "major" ? MAJOR_TRANSITIONS : MINOR_TRANSITIONS)[degree] ??
    (mode === "major" ? ["I", "V", "vi", "IV"] : ["i", "VI", "iv", "V"]);
  const weights = [92, 74, 56, 34];
  return transitions.map((roman, index) => ({
    roman,
    weight: weights[index],
    label: index === 0 ? "自然延续" : index === 3 ? "意外染色" : "可行分支",
    reason: REASONS[index],
    source: "功能规则"
  }));
}

export function replaceChord(
  arrangement: Arrangement,
  sectionIndex: number,
  chordIndex: number,
  roman: string
): Arrangement {
  const section = arrangement.sections[sectionIndex];
  const replaced = {
    ...arrangement,
    sections: arrangement.sections.map((section, index) => {
      if (index !== sectionIndex) return section;
      const numerals = [...section.numerals];
      numerals[chordIndex] = roman;
      return {
        ...section,
        numerals,
        chords: numerals.map((item) =>
          romanToChord(arrangement.key, arrangement.mode, item)
        ),
        variationLabel: "手动改写"
      };
    })
  };
  return section
    ? removeBassOverride(replaced, section.id, chordIndex)
    : replaced;
}

export function transposeArrangement(
  arrangement: Arrangement,
  key: string
): Arrangement {
  return {
    ...arrangement,
    key,
    bassOverrides: transposeBassOverrides(
      arrangement.bassOverrides,
      arrangement.key,
      key
    ),
    sections: arrangement.sections.map((section) => ({
      ...section,
      chords: section.numerals.map((roman) =>
        romanToChord(key, arrangement.mode, roman)
      )
    }))
  };
}
