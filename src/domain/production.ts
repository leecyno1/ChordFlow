import type {
  Arrangement,
  ProductionSettings,
  SectionProductionOverride,
  SongSection,
  TimeSignature,
  VoicingMode
} from "./types";

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  tempoBpm: 92,
  timeSignature: "4/4",
  barsPerSection: 4,
  voicingMode: "flowing",
  sectionOverrides: {}
};

export const TIME_SIGNATURES: TimeSignature[] = ["4/4", "3/4", "6/8"];
export const SECTION_BAR_OPTIONS = [2, 4, 8];
export const VOICING_PROFILES: Array<{
  id: VoicingMode;
  label: string;
  code: string;
  directionEn: string;
  directionZh: string;
}> = [
  {
    id: "stable",
    label: "稳定",
    code: "ROOT",
    directionEn: "stable root-position voicings and a clear root bass line",
    directionZh: "稳定原位和弦与清晰根音低音线"
  },
  {
    id: "flowing",
    label: "流动",
    code: "VOICE",
    directionEn: "smooth close voice-leading with selective chord inversions",
    directionZh: "平滑近距离声部连接，并选择性使用转位"
  },
  {
    id: "dramatic",
    label: "戏剧",
    code: "WIDE",
    directionEn: "contrasting inversions, wider register motion and a cinematic bass path",
    directionZh: "对比性转位、更宽的音区运动与电影感低音路径"
  }
];

export interface EffectiveSectionProduction
  extends SectionProductionOverride {
  locked: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVoicingMode(value: unknown): value is VoicingMode {
  return VOICING_PROFILES.some((profile) => profile.id === value);
}

function normalizeEnergy(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeSectionOverrides(
  value: unknown
): Record<string, SectionProductionOverride> {
  if (!isRecord(value)) return {};
  const entries: Array<[string, SectionProductionOverride]> = [];

  Object.entries(value).forEach(([key, rawOverride]) => {
    if (!/^[A-D]:\d+$/.test(key) || !isRecord(rawOverride)) return;
    const energy = rawOverride.energy;
    const voicingMode = rawOverride.voicingMode;
    if (
      typeof energy !== "number" ||
      !Number.isFinite(energy) ||
      !isVoicingMode(voicingMode)
    ) {
      return;
    }
    entries.push([key, { energy: normalizeEnergy(energy), voicingMode }]);
  });

  return Object.fromEntries(entries);
}

export function normalizeProductionSettings(
  settings?: Partial<ProductionSettings>
): ProductionSettings {
  const tempo = Math.round(
    settings?.tempoBpm ?? DEFAULT_PRODUCTION_SETTINGS.tempoBpm
  );
  const bars = Math.round(
    settings?.barsPerSection ?? DEFAULT_PRODUCTION_SETTINGS.barsPerSection
  );
  const meter = TIME_SIGNATURES.includes(
    settings?.timeSignature as TimeSignature
  )
    ? (settings?.timeSignature as TimeSignature)
    : DEFAULT_PRODUCTION_SETTINGS.timeSignature;
  const voicingMode = isVoicingMode(settings?.voicingMode)
    ? (settings?.voicingMode as VoicingMode)
    : DEFAULT_PRODUCTION_SETTINGS.voicingMode;

  return {
    tempoBpm: Math.min(180, Math.max(50, tempo)),
    timeSignature: meter,
    barsPerSection: SECTION_BAR_OPTIONS.includes(bars)
      ? bars
      : DEFAULT_PRODUCTION_SETTINGS.barsPerSection,
    voicingMode,
    sectionOverrides: normalizeSectionOverrides(settings?.sectionOverrides)
  };
}

export function sectionProductionKey(
  section: Pick<SongSection, "symbol" | "occurrence">
): string {
  return `${section.symbol.toUpperCase()}:${section.occurrence}`;
}

export function pruneSectionProductionOverrides(
  production: ProductionSettings,
  sections: Array<Pick<SongSection, "symbol" | "occurrence">>
): ProductionSettings {
  const availableKeys = new Set(sections.map(sectionProductionKey));
  const sectionOverrides = Object.fromEntries(
    Object.entries(production.sectionOverrides).filter(([key]) =>
      availableKeys.has(key)
    )
  );
  if (
    Object.keys(sectionOverrides).length ===
    Object.keys(production.sectionOverrides).length
  ) {
    return production;
  }
  return { ...production, sectionOverrides };
}

export function effectiveSectionProductionAt(
  arrangement: Arrangement,
  sectionIndex: number
): EffectiveSectionProduction {
  const section = arrangement.sections[sectionIndex];
  const override = section
    ? arrangement.production.sectionOverrides[sectionProductionKey(section)]
    : undefined;

  return {
    energy: override?.energy ?? section?.energy ?? 50,
    voicingMode:
      override?.voicingMode ?? arrangement.production.voicingMode,
    locked: override !== undefined
  };
}

export function setSectionProductionOverride(
  arrangement: Arrangement,
  sectionIndex: number,
  override: SectionProductionOverride | null
): Arrangement {
  const section = arrangement.sections[sectionIndex];
  if (!section) return arrangement;

  const key = sectionProductionKey(section);
  const sectionOverrides = { ...arrangement.production.sectionOverrides };
  if (override === null) {
    if (!(key in sectionOverrides)) return arrangement;
    delete sectionOverrides[key];
  } else {
    const nextOverride = {
      energy: normalizeEnergy(override.energy),
      voicingMode: isVoicingMode(override.voicingMode)
        ? override.voicingMode
        : arrangement.production.voicingMode
    };
    const current = sectionOverrides[key];
    if (
      current?.energy === nextOverride.energy &&
      current.voicingMode === nextOverride.voicingMode
    ) {
      return arrangement;
    }
    sectionOverrides[key] = nextOverride;
  }

  return {
    ...arrangement,
    production: {
      ...arrangement.production,
      sectionOverrides
    }
  };
}

export function getVoicingProfile(mode: VoicingMode) {
  return (
    VOICING_PROFILES.find((profile) => profile.id === mode) ??
    VOICING_PROFILES[1]
  );
}

export function timeSignatureParts(
  timeSignature: TimeSignature
): [number, number] {
  const [numerator, denominator] = timeSignature.split("/").map(Number);
  return [numerator, denominator];
}

export function quarterNotesPerBar(timeSignature: TimeSignature): number {
  const [numerator, denominator] = timeSignatureParts(timeSignature);
  return numerator * (4 / denominator);
}

export function chordLengthInBars(
  production: ProductionSettings,
  chordCount: number
): number {
  return production.barsPerSection / Math.max(1, chordCount);
}

export function harmonicRhythmLabel(
  production: ProductionSettings,
  chordCount: number
): string {
  const bars = chordLengthInBars(production, chordCount);
  if (bars === 1) return "1 bar per chord";
  if (bars > 1) return `${bars} bars per chord`;
  return `${Math.round(1 / bars)} chords per bar`;
}
