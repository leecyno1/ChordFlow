import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateArrangement } from "../engine/generate";
import { applySectionProgression } from "../engine/progressionInput";
import { buildVoicingPlan } from "../domain/voicing";
import { DEFAULT_RIFF, buildRiffNotes, buildRiffExcerpt } from "../engine/riff";
import { auditionProgression, playArrangement, stopPlayback } from "./player";

const instruments = vi.hoisted(() => [] as {
  release: number;
  triggerAttackRelease: ReturnType<typeof vi.fn>;
  releaseAll: ReturnType<typeof vi.fn>;
}[]);

const startAudio = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("tone", () => ({
  start: startAudio, Synth: class {},
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
  startAudio.mockReset().mockResolvedValue(undefined);
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
  it("plays excerpt harmony and bass using the song's actual voicings", async () => {
    const generated = source();
    const arrangement = applySectionProgression({ ...generated,
      production: { ...generated.production, voicingMode: "dramatic" }
    }, 0, ["I", "vi", "IV"]);
    const excerpt = buildRiffExcerpt(arrangement, 1);
    const duration = await playArrangement(excerpt.arrangement, undefined, false, undefined, false, excerpt.riffNotes, excerpt.voicingPlan);
    await vi.advanceTimersByTimeAsync(duration);
    const chords = instruments.find(instrument => instrument.release === 1.3)!;
    expect(chords.triggerAttackRelease.mock.calls.map(call => call[0])).toEqual(
      buildVoicingPlan(arrangement).sections[1].map(chord => [chord.bassNote, ...chord.noteNames])
    );
  });

  it("plays boundary chords in order and cancels the remaining attacks on stop", async () => {
    expect(await auditionProgression(["C", "Dm", "G"])).toBe(2110);
    const chords = instruments.find(instrument => instrument.release === 1.3)!;
    await vi.advanceTimersByTimeAsync(49);
    expect(chords.triggerAttackRelease).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(chords.triggerAttackRelease).toHaveBeenLastCalledWith(["C3", "E3", "G3"], 0.66);
    await vi.advanceTimersByTimeAsync(700);
    expect(chords.triggerAttackRelease).toHaveBeenLastCalledWith(["D3", "F3", "A3"], 0.66);
    stopPlayback();
    await vi.advanceTimersByTimeAsync(3000);
    expect(chords.triggerAttackRelease).toHaveBeenCalledTimes(2);
  });

  it("does not start an old boundary preview after a newer preview finishes audio startup", async () => {
    let ready!: () => void;
    startAudio.mockImplementationOnce(() => new Promise<void>(resolve => { ready = resolve; }));
    const pending = auditionProgression(["C", "F"]);
    await vi.advanceTimersByTimeAsync(0);
    const duration = await auditionProgression(["Dm", "G"]);
    ready();
    expect(await pending).toBe(0);
    await vi.advanceTimersByTimeAsync(duration);
    const chords = instruments.find(instrument => instrument.release === 1.3)!;
    expect(chords.triggerAttackRelease.mock.calls).toEqual([
      [["D3", "F3", "A3"], 0.66], [["G3", "B3", "D4"], 0.66]
    ]);
  });

  it("cancels queued notes in both directions when switching boundary and riff previews", async () => {
    await auditionProgression(["C", "F", "G"]);
    const duration = await playArrangement(source(), undefined, true);
    await vi.advanceTimersByTimeAsync(duration);
    const chords = instruments.find(instrument => instrument.release === 1.3)!;
    const lead = instruments.find(instrument => instrument.release === 0.04)!;
    expect(chords.triggerAttackRelease).not.toHaveBeenCalled();
    await playArrangement(source(), undefined, true);
    const played = lead.triggerAttackRelease.mock.calls.length;
    await auditionProgression(["Dm", "G"]);
    await vi.runAllTimersAsync();
    expect(lead.triggerAttackRelease).toHaveBeenCalledTimes(played);
    expect(chords.triggerAttackRelease).toHaveBeenCalledTimes(2);
  });

  it("leaves no scheduled attacks after audio startup fails and allows retry", async () => {
    startAudio.mockRejectedValueOnce(new Error("audio unavailable"));
    await expect(auditionProgression(["C", "F"])).rejects.toThrow("audio unavailable");
    const duration = await auditionProgression(["G"]);
    await vi.advanceTimersByTimeAsync(duration);
    const chords = instruments.find(instrument => instrument.release === 1.3)!;
    expect(chords.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(chords.triggerAttackRelease).toHaveBeenCalledWith(["G3", "B3", "D4"], 0.66);
  });

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

  it.each(["original", "pulse", "offbeat"] as const)("uses a short-release lead with generated pitches, durations and %s dynamics", async accent => {
    const a = source();
    const arrangement = { ...a, riff: { ...a.riff, accent } };
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
