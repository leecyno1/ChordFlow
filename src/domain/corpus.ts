import pop909Data from "../data/pop909-stats.json";
import type {
  CorpusChordStat,
  CorpusProgressionStat,
  CorpusStatistics,
  CorpusTransitionStat
} from "./types";

export const POP909_STATS = pop909Data as CorpusStatistics;

export function coarseRoman(roman: string): string {
  const primary = roman.split("/")[0];
  const match = primary.match(/^([b#]*[ivIV]+(?:°|ø)?)/);
  return match?.[1] ?? primary;
}

export function getChordCorpusStat(
  roman: string
): CorpusChordStat | undefined {
  return POP909_STATS.chords[coarseRoman(roman)];
}

export function getProgressionCorpusStat(
  templateId?: string
): CorpusProgressionStat | undefined {
  if (!templateId) return undefined;
  return POP909_STATS.progressions[templateId];
}

export function getCorpusTransitions(
  roman: string
): CorpusTransitionStat[] {
  return POP909_STATS.transitions[coarseRoman(roman)] ?? [];
}

export function formatPercent(value: number, digits = 1): string {
  return (value * 100).toFixed(digits) + "%";
}
