import { bassOverrideAt } from "./bass";
import type { Arrangement } from "./types";

export interface ArrangementComparison {
  formChanged: boolean;
  keyChanged: boolean;
  modeChanged: boolean;
  chordDifferences: number;
  bassDifferences: number;
  productionChanged: boolean;
  summary: string;
}

export function compareArrangements(
  left: Arrangement,
  right: Arrangement
): ArrangementComparison {
  const sectionCount = Math.max(left.sections.length, right.sections.length);
  let chordDifferences = 0;
  let bassDifferences = 0;

  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const leftSection = left.sections[sectionIndex];
    const rightSection = right.sections[sectionIndex];
    const chordCount = Math.max(
      leftSection?.numerals.length ?? 0,
      rightSection?.numerals.length ?? 0
    );

    for (let chordIndex = 0; chordIndex < chordCount; chordIndex += 1) {
      if (
        leftSection?.numerals[chordIndex] !==
        rightSection?.numerals[chordIndex]
      ) {
        chordDifferences += 1;
      }
      if (
        bassOverrideAt(left, sectionIndex, chordIndex) !==
        bassOverrideAt(right, sectionIndex, chordIndex)
      ) {
        bassDifferences += 1;
      }
    }
  }

  const formChanged = left.formPattern !== right.formPattern;
  const keyChanged = left.key !== right.key;
  const modeChanged = left.mode !== right.mode;
  const productionChanged =
    JSON.stringify(left.production) !== JSON.stringify(right.production);
  const parts = [
    formChanged ? "曲式" : "",
    keyChanged || modeChanged ? "调性" : "",
    chordDifferences > 0 ? `${chordDifferences} 处和声` : "",
    bassDifferences > 0 ? `${bassDifferences} 处低音` : "",
    productionChanged ? "制作参数" : ""
  ].filter(Boolean);

  return {
    formChanged,
    keyChanged,
    modeChanged,
    chordDifferences,
    bassDifferences,
    productionChanged,
    summary: parts.length > 0 ? parts.join(" · ") : "方案一致"
  };
}
