import { Midi } from "@tonejs/midi";
import { chordNoteNames } from "../domain/music";
import {
  chordLengthInBars,
  quarterNotesPerBar,
  timeSignatureParts
} from "../domain/production";
import { buildVoicingPlan } from "../domain/voicing";
import type { Arrangement } from "../domain/types";

let synth: any = null;
let toneModule: any = null;
let playbackRun = 0;
let playbackTimers: number[] = [];

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
  const run = playbackRun + 1;
  playbackRun = run;
  playbackTimers.forEach((timer) => window.clearTimeout(timer));
  playbackTimers = [];
  instrument.releaseAll();
  const startDelayMs = 80;
  const voicingPlan = buildVoicingPlan(arrangement);
  let elapsedSeconds = 0;

  arrangement.sections.forEach((section, sectionIndex) => {
    const stepDuration =
      (60 / arrangement.production.tempoBpm) *
      quarterNotesPerBar(arrangement.production.timeSignature) *
      chordLengthInBars(arrangement.production, section.chords.length);
    section.chords.forEach((_chord, chordIndex) => {
      const voicing = voicingPlan.sections[sectionIndex][chordIndex];
      const timer = window.setTimeout(() => {
        if (playbackRun !== run) return;
        instrument.triggerAttackRelease(
          [voicing.bassNote, ...voicing.noteNames],
          stepDuration * 0.9
        );
        onStep?.(sectionIndex, chordIndex);
      }, startDelayMs + elapsedSeconds * 1000);
      playbackTimers.push(timer);
      elapsedSeconds += stepDuration;
    });
  });

  return startDelayMs + elapsedSeconds * 1000;
}

export function stopPlayback(): void {
  playbackRun += 1;
  playbackTimers.forEach((timer) => window.clearTimeout(timer));
  playbackTimers = [];
  synth?.releaseAll();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJson(arrangement: Arrangement): void {
  downloadBlob(
    new Blob([JSON.stringify(arrangement, null, 2)], {
      type: "application/json"
    }),
    "chordflow-" + arrangement.formPattern.toLowerCase() + ".json"
  );
}

export function buildMidi(arrangement: Arrangement): Midi {
  const midi = new Midi();
  midi.header.setTempo(arrangement.production.tempoBpm);
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: timeSignatureParts(arrangement.production.timeSignature)
  });
  midi.header.update();
  const voicingPlan = buildVoicingPlan(arrangement);
  const harmonyTrack = midi.addTrack();
  harmonyTrack.name = "ChordFlow Harmony";
  const bassTrack = midi.addTrack();
  bassTrack.name = "ChordFlow Bass Guide";
  const ticksPerBar =
    midi.header.ppq *
    quarterNotesPerBar(arrangement.production.timeSignature);
  let ticks = 0;

  arrangement.sections.forEach((section, sectionIndex) => {
    const durationTicks = Math.round(
      (ticksPerBar * arrangement.production.barsPerSection) /
        Math.max(1, section.chords.length)
    );
    section.chords.forEach((_chord, chordIndex) => {
      const voicing = voicingPlan.sections[sectionIndex][chordIndex];
      voicing.midiNotes.forEach((midiNote) => {
        harmonyTrack.addNote({
          midi: midiNote,
          ticks,
          durationTicks,
          velocity: 0.72
        });
      });
      bassTrack.addNote({
        midi: voicing.bassMidi,
        ticks,
        durationTicks,
        velocity: 0.68
      });
      ticks += durationTicks;
    });
  });

  return midi;
}

export function exportMidi(arrangement: Arrangement): void {
  const midi = buildMidi(arrangement);

  downloadBlob(
    new Blob([midi.toArray()], { type: "audio/midi" }),
    "chordflow-" + arrangement.formPattern.toLowerCase() + ".mid"
  );
}
