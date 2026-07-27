import { Midi } from "@tonejs/midi";
import { chordNoteNames, noteNameToMidi } from "../domain/music";
import type { Arrangement } from "../domain/types";

let synth: any = null;
let toneModule: any = null;

async function getTone(): Promise<any> {
  if (!toneModule) {
    toneModule = await import("tone");
  }
  return toneModule;
}

async function getSynth(): Promise<any> {
  const Tone = await getTone();
  await Tone.start();
  if (!synth) {
    const filter = new Tone.Filter({
      frequency: 2800,
      type: "lowpass",
      rolloff: -12
    }).toDestination();
    synth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 20,
      volume: -10,
      oscillator: { type: "triangle8" },
      envelope: {
        attack: 0.035,
        decay: 0.28,
        sustain: 0.45,
        release: 1.3
      }
    }).connect(filter);
  }
  return synth;
}

export async function auditionChord(chord: string): Promise<void> {
  const instrument = await getSynth();
  instrument.triggerAttackRelease(chordNoteNames(chord, 3), "2n");
}

export async function auditionProgression(chords: string[]): Promise<void> {
  const instrument = await getSynth();
  const Tone = await getTone();
  instrument.releaseAll();
  const start = Tone.now() + 0.05;
  chords.forEach((chord, index) => {
    instrument.triggerAttackRelease(
      chordNoteNames(chord, 3),
      0.66,
      start + index * 0.7
    );
  });
}

export async function playArrangement(
  arrangement: Arrangement,
  onStep?: (sectionIndex: number, chordIndex: number) => void
): Promise<number> {
  const instrument = await getSynth();
  const Tone = await getTone();
  instrument.releaseAll();
  const start = Tone.now() + 0.08;
  const stepDuration = 0.72;
  let step = 0;

  arrangement.sections.forEach((section, sectionIndex) => {
    section.chords.forEach((chord, chordIndex) => {
      const time = start + step * stepDuration;
      instrument.triggerAttackRelease(
        chordNoteNames(chord, 3),
        stepDuration * 0.82,
        time
      );
      if (onStep) {
        window.setTimeout(
          () => onStep(sectionIndex, chordIndex),
          Math.max(0, (time - Tone.now()) * 1000)
        );
      }
      step += 1;
    });
  });

  return step * stepDuration * 1000;
}

export function stopPlayback(): void {
  synth?.releaseAll();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportJson(arrangement: Arrangement): void {
  downloadBlob(
    new Blob([JSON.stringify(arrangement, null, 2)], {
      type: "application/json"
    }),
    "chordflow-" + arrangement.formPattern.toLowerCase() + ".json"
  );
}

export function exportMidi(arrangement: Arrangement): void {
  const midi = new Midi();
  midi.header.setTempo(92);
  const track = midi.addTrack();
  track.name = "ChordFlow Harmony";
  let time = 0;

  arrangement.sections.forEach((section) => {
    section.chords.forEach((chord) => {
      chordNoteNames(chord, 3).forEach((note) => {
        track.addNote({
          midi: noteNameToMidi(note),
          time,
          duration: 0.88,
          velocity: 0.72
        });
      });
      time += 1;
    });
  });

  downloadBlob(
    new Blob([midi.toArray()], { type: "audio/midi" }),
    "chordflow-" + arrangement.formPattern.toLowerCase() + ".mid"
  );
}
