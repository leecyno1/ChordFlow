import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateArrangement } from "../engine/generate";
import { DEFAULT_RIFF, buildRiffNotes, buildRiffExcerpt } from "../engine/riff";
import { playArrangement, stopPlayback } from "./player";

const instruments = vi.hoisted(() => [] as {
  release: number;
  triggerAttackRelease: ReturnType<typeof vi.fn>;
  releaseAll: ReturnType<typeof vi.fn>;
}[]);

vi.mock("tone", () => ({
  start: async () => {}, Synth: class {},
  Filter: class { toDestination() { return this; } },
  PolySynth: class {
    release: number;
    triggerAttackRelease = vi.fn();
    releaseAll = vi.fn();
    constructor(_type: unknown, options: { envelope: { release: number } }) {
      this.release = options.envelope.release;
      instruments.push(this);
    }
    connect() { return this; }
    toDestination() { return this; }
  }
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  instruments.forEach(instrument => { instrument.triggerAttackRelease.mockClear(); instrument.releaseAll.mockClear(); });
});
afterEach(() => { stopPlayback(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const source = () => ({
  ...generateArrangement({ formId: "aba", key: "C", mode: "major", style: "独立流行", surprise: 35, seed: 12 }),
  riff: { ...DEFAULT_RIFF, phrase: "call-response" as const, connection: "anticipate" as const }
});

describe("riff articulation", () => {
  it("plays the full-song excerpt plan, including its outgoing handoff", async () => {
    const a = source();
    a.sections = a.sections.map((section, i) => ({ ...section, chords: [i === 1 ? "Dm" : "C"] }));
    const arrangement = { ...a, riff: { ...DEFAULT_RIFF, style: "arpeggio" as const, variation: 0, handoff: "pickup" as const } };
    const excerpt = buildRiffExcerpt(arrangement, 0);
    expect(excerpt.riffNotes.at(-1)?.kind).toBe("handoff");
    const onNote = vi.fn();
    const duration = await playArrangement(excerpt.arrangement, undefined, true, onNote, false, excerpt.riffNotes);
    await vi.advanceTimersByTimeAsync(duration);
    const lead = instruments.find(instrument => instrument.release === 0.04)!;
    expect(lead.triggerAttackRelease).toHaveBeenCalledTimes(excerpt.riffNotes.length);
    excerpt.riffNotes.forEach((note, index) => {
      expect(lead.triggerAttackRelease.mock.calls[index]).toEqual([
        440 * 2 ** ((note.midi - 69) / 12), note.duration * 60 / a.production.tempoBpm, undefined, note.velocity
      ]);
      expect(onNote.mock.calls[index]).toEqual([note.beat]);
    });
  });

  it("uses a short-release lead and the generated pitches and durations for solo playback", async () => {
    const arrangement = source();
    const duration = await playArrangement(arrangement, undefined, true);
    await vi.advanceTimersByTimeAsync(duration);
    const chords = instruments.find(instrument => instrument.release === 1.3)!;
    const lead = instruments.find(instrument => instrument.release === 0.04)!;
    expect(chords.triggerAttackRelease).not.toHaveBeenCalled();
    const notes = buildRiffNotes(arrangement);
    expect(lead.triggerAttackRelease).toHaveBeenCalledTimes(notes.length);
    notes.forEach((note, index) => {
      expect(lead.triggerAttackRelease.mock.calls[index]).toEqual([
        440 * 2 ** ((note.midi - 69) / 12), note.duration * 60 / arrangement.production.tempoBpm, undefined, note.velocity
      ]);
    });
  });

  it("cancels pending notes and releases both instruments when stopped", async () => {
    const duration = await playArrangement(source());
    stopPlayback();
    await vi.advanceTimersByTimeAsync(duration);
    instruments.forEach(instrument => {
      expect(instrument.triggerAttackRelease).not.toHaveBeenCalled();
      expect(instrument.releaseAll).toHaveBeenCalled();
    });
  });
});
