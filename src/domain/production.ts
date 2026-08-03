import type {
  ProductionSettings,
  TimeSignature,
  VoicingMode
} from "./types";

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  tempoBpm: 92,
  timeSignature: "4/4",
  barsPerSection: 4,
  voicingMode: "flowing"
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
  const voicingMode = VOICING_PROFILES.some(
    (profile) => profile.id === settings?.voicingMode
  )
    ? (settings?.voicingMode as VoicingMode)
    : DEFAULT_PRODUCTION_SETTINGS.voicingMode;

  return {
    tempoBpm: Math.min(180, Math.max(50, tempo)),
    timeSignature: meter,
    barsPerSection: SECTION_BAR_OPTIONS.includes(bars)
      ? bars
      : DEFAULT_PRODUCTION_SETTINGS.barsPerSection,
    voicingMode
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
