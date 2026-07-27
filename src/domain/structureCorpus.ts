import harmonixData from "../data/harmonix-stats.json";
import type {
  StructureFamilyStat,
  StructurePatternStat,
  StructureRole,
  StructureRoleStat,
  StructureStatistics,
  StructureTransitionStat
} from "./types";

export const HARMONIX_STATS = harmonixData as StructureStatistics;

export const STRUCTURE_ROLE_LABELS: Record<StructureRole, string> = {
  intro: "前奏",
  verse: "主歌",
  prechorus: "预副歌",
  chorus: "副歌",
  postchorus: "后副歌",
  bridge: "桥段",
  solo: "独奏",
  instrumental: "器乐段",
  breakdown: "击穿段",
  interlude: "间奏",
  outro: "尾奏",
  silence: "静默",
  other: "其他"
};

export interface StructureFamilyMatch {
  family: StructureFamilyStat;
  similarity: number;
  exactPreset: boolean;
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current.push(
        Math.min(
          current[current.length - 1] + 1,
          previous[rightIndex] + 1,
          previous[rightIndex - 1] +
            (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
        )
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function patternSimilarity(left: string, right: string): number {
  const maxLength = Math.max(1, left.length, right.length);
  return 1 - editDistance(left, right) / maxLength;
}

export function getStructureFamily(
  pattern: string
): StructureFamilyMatch | undefined {
  const normalized = pattern.toUpperCase();
  const direct = HARMONIX_STATS.formFamilies[normalized];
  if (direct) {
    return { family: direct, similarity: 1, exactPreset: true };
  }

  const nearest = Object.values(HARMONIX_STATS.formFamilies)
    .map((family) => ({
      family,
      similarity: patternSimilarity(normalized, family.pattern)
    }))
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        left.family.pattern.length - right.family.pattern.length
    )[0];

  return nearest ? { ...nearest, exactPreset: false } : undefined;
}

export function getExactStructurePattern(
  pattern: string
): StructurePatternStat | undefined {
  const normalized = pattern.toUpperCase();
  const family = HARMONIX_STATS.formFamilies[normalized];
  if (family) {
    return {
      pattern: normalized,
      songCount: family.exactSongCount,
      songCoverage: family.exactCoverage,
      examples: family.examples
    };
  }
  return HARMONIX_STATS.topPatterns.find(
    (item) => item.pattern === normalized
  );
}

export function getStructureRole(
  role: StructureRole
): StructureRoleStat | undefined {
  return HARMONIX_STATS.roles[role];
}

export function getStructureTransitions(
  role: StructureRole
): StructureTransitionStat[] {
  return HARMONIX_STATS.transitions[role] ?? [];
}
