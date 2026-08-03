import type { ProductionSettings, TimeSignature } from "./types";

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  tempoBpm: 92,
  timeSignature: "4/4",
  barsPerSection: 4
};

export const TIME_SIGNATURES: TimeSignature[] = ["4/4", "3/4", "6/8"];
export const SECTION_BAR_OPTIONS = [2, 4, 8];

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

  return {
    tempoBpm: Math.min(180, Math.max(50, tempo)),
    timeSignature: meter,
    barsPerSection: SECTION_BAR_OPTIONS.includes(bars)
      ? bars
      : DEFAULT_PRODUCTION_SETTINGS.barsPerSection
  };
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
