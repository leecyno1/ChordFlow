import { coarseRoman } from "../domain/corpus";
import { romanToChord } from "../domain/music";
import { removeBassOverride } from "../domain/bass";
import type {
  Arrangement,
  SongSection,
  TransitionSuggestion
} from "../domain/types";

function contextualColor(complexity: number): string {
  return ["#817f7c", "#f4b860", "#4ed8d0", "#b388ff"][complexity] ?? "#817f7c";
}

export function getTransitionSuggestions(
  arrangement: Arrangement,
  sectionIndex: number
): TransitionSuggestion[] {
  const section = arrangement.sections[sectionIndex];
  const nextSection = arrangement.sections[sectionIndex + 1];
  if (!section || !nextSection) return [];

  const currentChord = section.chords.at(-1) ?? arrangement.key;
  const currentRoman = section.numerals.at(-1) ?? "I";
  const targetChord = nextSection.chords[0] ?? arrangement.key;
  const targetRoman = coarseRoman(nextSection.numerals[0] ?? "I").replace(
    /[°ø]/g,
    ""
  );
  const dominantRoman = "V7/" + targetRoman;
  const diminishedRoman = "vii°7/" + targetRoman;
  const modalRoman =
    arrangement.mode === "major"
      ? ["I", "i", "vi"].includes(targetRoman)
        ? "iv6"
        : "bVII"
      : "VI";

  const make = (
    id: string,
    name: string,
    nameEn: string,
    technique: string,
    roman: string,
    description: string,
    complexity: number,
    tension: number
  ): TransitionSuggestion => {
    const chord = romanToChord(arrangement.key, arrangement.mode, roman);
    const previewChords =
      roman === currentRoman
        ? [currentChord, targetChord]
        : [currentChord, chord, targetChord];
    return {
      id,
      name,
      nameEn,
      technique,
      roman,
      chord,
      description,
      complexity,
      tension,
      color: contextualColor(complexity),
      previewChords
    };
  };

  return [
    make(
      "direct",
      "原样直达",
      "Direct cut",
      "保持",
      currentRoman,
      "保留原段落结尾，不额外制造方向；适合歌词或节奏已经承担转场的情况。",
      0,
      20
    ),
    make(
      "dominant-gate",
      "属门槛",
      "Secondary dominant",
      "次属和弦",
      dominantRoman,
      "把目标段落临时当作主音，用它的属七和弦提前照亮入口，方向感最明确。",
      1,
      72
    ),
    make(
      "diminished-thread",
      "半音暗线",
      "Diminished approach",
      "导音减七",
      diminishedRoman,
      "从目标根音下方半音靠近，四个音都带有解决倾向，适合紧凑而戏剧化的过门。",
      2,
      88
    ),
    make(
      "modal-veil",
      "调式薄暮",
      "Modal veil",
      "调式借用",
      modalRoman,
      "借用平行调色彩弱化传统属解决，让回归更苦甜、更像镜头切换而不是句号。",
      3,
      58
    )
  ];
}

export function applyTransitionSuggestion(
  arrangement: Arrangement,
  sectionIndex: number,
  suggestion: TransitionSuggestion
): Arrangement {
  const sourceSection = arrangement.sections[sectionIndex];
  const lastIndex = (sourceSection?.chords.length ?? 1) - 1;
  const next = {
    ...arrangement,
    sections: arrangement.sections.map((section, index): SongSection => {
      if (index !== sectionIndex) return section;
      const numerals = [...section.numerals];
      const chords = [...section.chords];
      const lastIndex = numerals.length - 1;
      numerals[lastIndex] = suggestion.roman;
      chords[lastIndex] = suggestion.chord;
      return {
        ...section,
        numerals,
        chords,
        transitionLabel: suggestion.name,
        variationLabel:
          suggestion.id === "direct" ? section.variationLabel : "边界再和声"
      };
    })
  };
  if (!sourceSection || sourceSection.chords[lastIndex] === suggestion.chord) {
    return next;
  }
  return removeBassOverride(next, sourceSection.id, lastIndex);
}
