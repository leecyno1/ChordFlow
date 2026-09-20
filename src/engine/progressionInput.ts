import { chordPitchClasses, chordRoot, romanToChord } from "../domain/music";
import { removeBassOverridesForSections } from "../domain/bass";
import type { Arrangement, Mode } from "../domain/types";

export function parseProgression(input: string, key: string, mode: Mode): string[] {
  const text = input.trim().replaceAll("♭", "b").replaceAll("♯", "#");
  const degrees = mode === "major" ? ["I", "ii", "iii", "IV", "V", "vi", "vii°"] : ["i", "ii°", "III", "iv", "v", "VI", "VII"];
  const tokens = /^[1-7]+$/.test(text) ? [...text] : text.split(/[\s,，|–—-]+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8) throw new Error("请输入 2–8 个和弦，例如 1645 或 C–Am–F–G");
  return tokens.map(token => {
    if (/^[1-7]$/.test(token)) return degrees[Number(token) - 1];
    if (/^(?:V7|vii°7)\/[b#]?(?:VII|III|VI|IV|II|V|I|vii|iii|vi|iv|ii|v|i)$/.test(token)) return token;
    if (/^[b#]?(?:VII|III|VI|IV|II|V|I|vii|iii|vi|iv|ii|v|i)(?:maj7|m7b5|sus2|sus4|add9|°7|°|7|6)?$/.test(token)) return token;
    if (!/^[A-G][b#]?(?:maj7|m7b5|dim7|dim|sus2|sus4|madd9|add9|m7|m6|m|7|6)?$/.test(token)) {
      throw new Error(`无法识别 ${token}；支持级数、罗马数字和基础和弦名`);
    }
    const root = chordRoot(token);
    const quality = token.slice(root.length);
    const minor = quality.startsWith("m") && !quality.startsWith("maj");
    const suffix = quality === "m7b5" ? "m7b5" : quality.startsWith("dim") ? quality.replace("dim", "°") : minor ? quality.slice(1) : quality;
    for (const accidental of ["", "b", "#"]) {
      for (const degree of ["I", "II", "III", "IV", "V", "VI", "VII"]) {
        const roman = accidental + (minor ? degree.toLowerCase() : degree) + suffix;
        if (chordPitchClasses(romanToChord(key, mode, roman))[0] === chordPitchClasses(token)[0]) return roman;
      }
    }
    throw new Error(`无法换算 ${token}`);
  });
}

export function applySectionProgression(arrangement: Arrangement, sectionIndex: number, numerals: string[], label = "自定义和弦"): Arrangement {
  const section = arrangement.sections[sectionIndex];
  if (!section) return arrangement;
  return {
    ...arrangement,
    bassOverrides: removeBassOverridesForSections(arrangement.bassOverrides, new Set([section.id])),
    sections: arrangement.sections.map((item, index) => index === sectionIndex ? {
      ...item, numerals: [...numerals], chords: numerals.map(roman => romanToChord(arrangement.key, arrangement.mode, roman)),
      templateId: "custom", variationLabel: label, transitionLabel: undefined
    } : item)
  };
}
