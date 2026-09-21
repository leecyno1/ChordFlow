import { chordPitchClasses } from "../domain/music";
import { quarterNotesPerBar, effectiveSectionProductionAt } from "../domain/production";
import type { Arrangement, RiffSettings } from "../domain/types";
import { riffRhythmSlots, riffContour, RIFF_VARIANT_COUNT } from "./riffMotif";

export const DEFAULT_RIFF: RiffSettings = {
  style: "hook", bars: 2, density: "sparse", register: "high",
  variation: 1, rhythmSeed: 0, pitchSeed: 0
};
export const RIFF_NAMES = { arpeggio: "舒缓分解", syncopated: "切分律动", hook: "旋律钩子" };

export interface RiffNote {
  midi: number;
  beat: number;
  duration: number;
  velocity: number;
  sectionIndex: number;
  chordIndex: number;
  kind?: "passing" | "resolution" | "anticipation";
  phrase?: "call" | "response";
}

export function riffMotifBars(settings: RiffSettings): 1 | 2 {
  return settings.phrase === "call-response" ? 2 : settings.bars;
}

export function normalizeRiff(value: unknown): RiffSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (!["arpeggio", "syncopated", "hook"].includes(String(item.style))) return undefined;
  const integer = (name: string, fallback: number) =>
    typeof item[name] === "number" && Number.isFinite(item[name]) ? Math.round(item[name] as number) : fallback;
  return {
    style: item.style as RiffSettings["style"], bars: item.phrase !== "call-response" && item.bars === 1 ? 1 : 2,
    density: item.density === "full" ? "full" : "sparse",
    register: item.register === "low" ? "low" : "high",
    variation: Math.max(0, Math.min(2, integer("variation", 1))),
    rhythmSeed: Math.abs(integer("rhythmSeed", 0)) % 100000,
    pitchSeed: Math.abs(integer("pitchSeed", 0)) % 100000,
    ...(item.rhythmVersion === 2 ? { rhythmVersion: 2 as const } : {}),
    ...(item.pitchVersion === 2 ? { pitchVersion: 2 as const } : {}),
    ...(item.ornament === "off" || item.ornament === "passing" ? { ornament: item.ornament } : {}),
    ...(item.ending === "open" || item.ending === "resolve" ? { ending: item.ending } : {}),
    ...(item.phrase === "repeat" || item.phrase === "call-response" ? { phrase: item.phrase } : {}),
    ...(item.connection === "off" || item.connection === "anticipate" ? { connection: item.connection } : {})
  };
}

export function riffSettingsAt(arrangement: Arrangement, sectionIndex: number): RiffSettings | undefined {
  const symbol = arrangement.sections[sectionIndex]?.symbol;
  const override = arrangement.riffThemes?.[symbol];
  return override === null ? undefined : override ?? arrangement.riff;
}

export function normalizeRiffThemes(value: unknown, sections: Arrangement["sections"]): Arrangement["riffThemes"] {
  if (!value || typeof value !== "object") return undefined;
  const entries = [...new Set(sections.map(section => section.symbol))].flatMap(symbol => {
    const raw = (value as Record<string, unknown>)[symbol];
    const settings = raw === null ? null : normalizeRiff(raw);
    return settings === undefined ? [] : [[symbol, settings] as const];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

// undefined restores inheritance; null mutes the theme; settings pin its motif.
export function setThemeRiff(arrangement: Arrangement, symbol: string, settings: RiffSettings | null | undefined): Arrangement {
  const themes = { ...arrangement.riffThemes };
  if (settings === undefined) delete themes[symbol]; else themes[symbol] = settings;
  return { ...arrangement, riffThemes: normalizeRiffThemes(themes, arrangement.sections) };
}

// Beats are quarter notes throughout, including 6/8 (three quarters per bar).
// One motif is reused across chords; only its pitch realization follows harmony.
export function buildRiffNotes(arrangement: Arrangement): RiffNote[] {
  const barBeats = quarterNotesPerBar(arrangement.production.timeSignature);
  const slotsPerBar = barBeats * 2;
  const sectionSlots = slotsPerBar * arrangement.production.barsPerSection;
  const pulse = arrangement.production.timeSignature === "6/8" ? 3 : 2;
  const result: RiffNote[] = [];
  arrangement.sections.forEach((section, sectionIndex) => {
    const settings = riffSettingsAt(arrangement, sectionIndex);
    if (!settings) return;
    const callResponse = settings.phrase === "call-response";
    const motifSlots = slotsPerBar * riffMotifBars(settings);
    const contour = riffContour(settings);
    const production = effectiveSectionProductionAt(arrangement, sectionIndex);
    const center = (settings.register === "high" ? 72 : 60) + chordPitchClasses(arrangement.key)[0] + (section.role === "chorus" ? 3 : 0);
    const events: { slot: number; motifSlot: number; answerEnding?: boolean }[] = [];
    const scaledMask = riffRhythmSlots(settings, slotsPerBar);
    for (let slot = 0; slot < sectionSlots; slot++) {
      const motifSlot = slot % motifSlots;
      const local = motifSlot % slotsPerBar;
      const base = scaledMask.includes(local);
      const extra = settings.density === "full" && local % pulse === 1;
      if (callResponse && local >= slotsPerBar - pulse) {
        // A call leaves its final pulse silent. Its answer holds a root there;
        // with fast harmony, delay that anchor until the bar's last chord.
        const barEnd = slot - local + slotsPerBar;
        const lastChord = Math.ceil(barEnd / sectionSlots * section.chords.length) - 1;
        const landing = Math.max(barEnd - pulse, Math.ceil(lastChord * sectionSlots / section.chords.length));
        if (motifSlot >= slotsPerBar && slot === landing) events.push({ slot, motifSlot, answerEnding: true });
        continue;
      }
      if (base || extra) events.push({ slot, motifSlot });
    }
    const finalChordSlot = Math.ceil(sectionSlots * (section.chords.length - 1) / section.chords.length);
    if (settings.ending === "resolve" && events.at(-1)!.slot < finalChordSlot) {
      events.push({ slot: finalChordSlot, motifSlot: finalChordSlot % motifSlots });
    }
    let previous = center;
    const sectionNotes: RiffNote[] = [];
    events.forEach(({ slot, motifSlot, answerEnding }, index) => {
      const chordIndex = Math.min(section.chords.length - 1, Math.floor(slot / sectionSlots * section.chords.length));
      const pcs = chordPitchClasses(section.chords[chordIndex]);
      const local = motifSlot % slotsPerBar;
      const motifIndex = callResponse
        ? events.filter(event => event.slot < slotsPerBar && event.slot <= local).length - 1
        : events.filter(event => event.slot < motifSlots && event.slot <= motifSlot).length - 1;
      const tail = !callResponse && slot >= sectionSlots - slotsPerBar && settings.variation > 0;
      const offset = contour[Math.max(0, motifIndex) % contour.length] + (tail ? settings.variation : 0);
      const resolving = answerEnding || (settings.ending === "resolve" && index === events.length - 1);
      const target = resolving ? previous : center + offset;
      const pool = Array.from({ length: 25 }, (_, i) => center - 12 + i).filter(note => pcs.includes(note % 12));
      const choices = resolving ? pool.filter(note => note % 12 === pcs[0]) : pool;
      const midi = choices.sort((a, b) =>
        (Math.abs(a - target) * 1.5 + Math.abs(a - previous) * 0.5) -
        (Math.abs(b - target) * 1.5 + Math.abs(b - previous) * 0.5) || a - b
      )[0];
      previous = midi;
      const boundary = (chordIndex + 1) * sectionSlots / section.chords.length;
      const next = events[index + 1]?.slot ?? sectionSlots;
      const phrase = motifSlot < slotsPerBar ? "call" : "response";
      const phraseBoundary = callResponse && phrase === "call" ? slot - local + slotsPerBar - pulse : sectionSlots;
      sectionNotes.push({
        midi, sectionIndex, chordIndex,
        beat: (sectionIndex * sectionSlots + slot) / 2,
        duration: Math.min(next - slot, boundary - slot, phraseBoundary - slot, answerEnding ? pulse : 2) / 2 * 0.85,
        velocity: Math.min(0.95, 0.4 + production.energy * 0.004 + (slot % pulse === 0 ? 0.08 : 0)),
        ...(resolving ? { kind: "resolution" as const } : {}),
        ...(callResponse ? { phrase } : {})
      });
    });
    if (settings.ornament === "passing") {
      const tonic = chordPitchClasses(arrangement.key)[0];
      const scale = (arrangement.mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]).map(pc => (pc + tonic) % 12);
      const anchors = [...sectionNotes];
      for (let i = 0; i < anchors.length - 1; i++) {
        const from = anchors[i];
        const to = anchors[i + 1];
        const beat = to.beat - 0.5;
        const localSlot = (beat - sectionIndex * sectionSlots / 2) * 2;
        if (callResponse && Math.floor(from.beat / barBeats) !== Math.floor(to.beat / barBeats)) continue;
        if (from.chordIndex !== to.chordIndex || to.beat - from.beat < 1 || localSlot % pulse === 0) continue;
        const pcs = chordPitchClasses(section.chords[from.chordIndex]);
        const direction = Math.sign(to.midi - from.midi);
        const midi = [from.midi + direction, from.midi + direction * 2].find(note =>
          (note - from.midi) * (to.midi - note) > 0 && Math.abs(to.midi - note) <= 2 &&
          scale.includes(note % 12) && !pcs.includes(note % 12)
        );
        if (midi === undefined) continue;
        from.duration = Math.min(from.duration, (beat - from.beat) * 0.85);
        sectionNotes.push({ ...from, midi, beat, duration: 0.425, velocity: from.velocity * 0.8, kind: "passing" });
      }
    }
    const ordered = sectionNotes.sort((a, b) => a.beat - b.beat);
    result.push(...(settings.connection === "anticipate" ? addAnticipations(ordered, arrangement, sectionIndex) : ordered));
  });
  return result;
}

export function nextRiffVariation(arrangement: Arrangement, sectionIndex: number, settings: RiffSettings, dimension: "rhythm" | "pitch"): RiffSettings {
  const excerpt = { ...arrangement, sections: [arrangement.sections[sectionIndex]], riffThemes: undefined };
  const signature = (riff: RiffSettings) => buildRiffNotes({ ...excerpt, riff })
    .filter(note => note.kind !== "passing" && note.kind !== "anticipation")
    .map(note => dimension === "rhythm" ? note.beat : note.midi);
  const current = signature(settings);
  const seed = dimension === "rhythm" ? settings.rhythmSeed : settings.pitchSeed;
  const expanded = (dimension === "rhythm" ? settings.rhythmVersion : settings.pitchVersion) === 2;
  const start = expanded ? seed % RIFF_VARIANT_COUNT : seed % 3;
  for (let step = 1; step <= RIFF_VARIANT_COUNT; step++) {
    const nextSeed = (start + step) % RIFF_VARIANT_COUNT;
    const candidate: RiffSettings = dimension === "rhythm"
      ? { ...settings, rhythmVersion: 2, rhythmSeed: nextSeed }
      : { ...settings, pitchVersion: 2, pitchSeed: nextSeed };
    const next = signature(candidate);
    if (next.length !== current.length || next.some((value, i) => value !== current[i])) return candidate;
  }
  return settings;
}

// Anticipate an actual upcoming anchor, not an invented next-chord melody.
// Keep this section-local so isolated previews and exported excerpts agree.
function addAnticipations(notes: RiffNote[], arrangement: Arrangement, sectionIndex: number): RiffNote[] {
  const section = arrangement.sections[sectionIndex];
  const barBeats = quarterNotesPerBar(arrangement.production.timeSignature);
  const sectionBeats = barBeats * arrangement.production.barsPerSection;
  const sectionStart = sectionIndex * sectionBeats;
  const pulseSlots = arrangement.production.timeSignature === "6/8" ? 3 : 2;
  const callResponse = riffSettingsAt(arrangement, sectionIndex)?.phrase === "call-response";
  let result = [...notes];
  for (let chordIndex = 1; chordIndex < section.chords.length; chordIndex++) {
    const boundary = sectionStart + chordIndex * sectionBeats / section.chords.length;
    const beat = boundary - 0.5;
    const slot = (beat - sectionStart) * 2;
    // Only eighth-note-grid boundaries with an off-pulse anticipation.
    if (!Number.isInteger(slot) || slot % pulseSlots === 0) continue;
    const localBar = Math.floor((beat - sectionStart) / barBeats);
    const withinBar = (beat - sectionStart) % barBeats;
    if (callResponse && localBar % 2 === 0 && withinBar >= barBeats - pulseSlots / 2) continue;
    const target = notes.find(note => Math.abs(note.beat - boundary) < 1e-9 && note.chordIndex === chordIndex);
    if (!target || target.kind === "passing") continue;
    const previous = result.filter(note => note.beat < beat).at(-1);
    if (!previous || previous.chordIndex !== chordIndex - 1 || previous.kind === "resolution") continue;
    // Distinguish anticipation from common-tone repetition; avoid a large leap.
    if (chordPitchClasses(section.chords[chordIndex - 1]).includes(target.midi % 12) || Math.abs(previous.midi - target.midi) > 2) continue;
    const occupied = result.find(note => Math.abs(note.beat - beat) < 1e-9);
    if (occupied?.kind === "resolution") continue;
    result = result.filter(note => note !== occupied).map(note => note === previous
      ? { ...note, duration: Math.min(note.duration, (beat - note.beat) * 0.85) } : note);
    result.push({ ...previous, midi: target.midi, beat, duration: 0.425, velocity: previous.velocity * 0.8, kind: "anticipation" });
    result.sort((a, b) => a.beat - b.beat);
  }
  return result;
}
