import { Midi } from "@tonejs/midi";
import { chordNoteNames } from "../domain/music";
import {
  chordLengthInBars,
  effectiveSectionProductionAt,
  quarterNotesPerBar,
  timeSignatureParts
} from "../domain/production";
import { buildVoicingPlan } from "../domain/voicing";
import type { Arrangement } from "../domain/types";
import { buildRiffNotes } from "../engine/riff";

let synth: any = null;
let toneModule: any = null;
let playbackRun = 0;
let playbackTimers: number[] = [];

function energyVelocity(energy: number, floor: number): number {
  return Math.min(1, floor + Math.min(100, Math.max(0, energy)) * 0.005);
}

export interface ArrangementPlaybackStep {
  sectionIndex: number;
  chordIndex: number;
  offsetMs: number;
  durationSeconds: number;
  velocity: number;
  notes: string[];
}

export interface ArrangementPlaybackSchedule {
  durationMs: number;
  steps: ArrangementPlaybackStep[];
}

export function buildPlaybackSchedule(
  arrangement: Arrangement,
  startDelayMs = 80
): ArrangementPlaybackSchedule {
  const voicingPlan = buildVoicingPlan(arrangement);
  const steps: ArrangementPlaybackStep[] = [];
  let elapsedSeconds = 0;

  arrangement.sections.forEach((section, sectionIndex) => {
    const sectionProduction = effectiveSectionProductionAt(
      arrangement,
      sectionIndex
    );
    const stepDuration =
      (60 / arrangement.production.tempoBpm) *
      quarterNotesPerBar(arrangement.production.timeSignature) *
      chordLengthInBars(arrangement.production, section.chords.length);
    section.chords.forEach((_chord, chordIndex) => {
      const voicing = voicingPlan.sections[sectionIndex][chordIndex];
      steps.push({
        sectionIndex,
        chordIndex,
        offsetMs: startDelayMs + elapsedSeconds * 1000,
        durationSeconds: stepDuration,
        velocity: energyVelocity(sectionProduction.energy, 0.38),
        notes: [voicing.bassNote, ...voicing.noteNames]
      });
      elapsedSeconds += stepDuration;
    });
  });

  return {
    durationMs: startDelayMs + elapsedSeconds * 1000,
    steps
  };
}

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

export async function auditionArrangementChord(
  arrangement: Arrangement,
  sectionIndex: number,
  chordIndex: number
): Promise<void> {
  const voicing = buildVoicingPlan(arrangement).sections[sectionIndex]?.[
    chordIndex
  ];
  if (!voicing) return;
  const instrument = await getSynth();
  instrument.triggerAttackRelease(
    [voicing.bassNote, ...voicing.noteNames],
    "2n"
  );
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
  onStep?: (sectionIndex: number, chordIndex: number) => void,
  riffOnly = false,
  onRiffNote?: (beat: number) => void,
  matchVoiceLevel = false
): Promise<number> {
  stopPlayback();
  const run = playbackRun;
  const instrument = await getSynth();
  if (run !== playbackRun) return 0;
  instrument.releaseAll();
  // The synth has a 1.3s release. Blind excerpts must not inherit the
  // previous candidate's tail when the listener switches A/B quickly.
  const startDelayMs = matchVoiceLevel ? 1400 : 80;
  const schedule = buildPlaybackSchedule(arrangement, startDelayMs);

  schedule.steps.forEach((step) => {
    const timer = window.setTimeout(() => {
      if (playbackRun !== run) return;
      if (!riffOnly) instrument.triggerAttackRelease(
        step.notes,
        step.durationSeconds * 0.9,
        undefined,
        matchVoiceLevel ? comparisonVelocity(step.velocity, step.notes.length) : step.velocity
      );
      onStep?.(step.sectionIndex, step.chordIndex);
    }, step.offsetMs);
    playbackTimers.push(timer);
  });

  const secondsPerBeat = 60 / arrangement.production.tempoBpm;
  buildRiffNotes(arrangement).forEach(note => {
    const timer = window.setTimeout(() => {
      if (playbackRun !== run) return;
      instrument.triggerAttackRelease(440 * 2 ** ((note.midi - 69) / 12), note.duration * secondsPerBeat, undefined, note.velocity);
      onRiffNote?.(note.beat);
    }, startDelayMs + note.beat * secondsPerBeat * 1000);
    playbackTimers.push(timer);
  });

  return schedule.durationMs;
}

export function stopPlayback(): void {
  playbackRun += 1;
  playbackTimers.forEach((timer) => window.clearTimeout(timer));
  playbackTimers = [];
  synth?.releaseAll();
}

export function comparisonVelocity(velocity: number, voiceCount: number): number {
  return Math.min(1, velocity * Math.sqrt(4 / Math.max(1, voiceCount)));
}

export function downloadBlob(blob: Blob, filename: string) {
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
  midi.header.name = arrangement.title;
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
    const sectionCode = `${section.symbol}${
      section.occurrence > 0 ? section.occurrence + 1 : ""
    }`;
    midi.header.meta.push({
      ticks,
      type: "marker",
      text: `${sectionCode} | ${section.role.toUpperCase()} | ${section.chords.join(" - ")}`
    });
    const sectionProduction = effectiveSectionProductionAt(
      arrangement,
      sectionIndex
    );
    const harmonyVelocity = energyVelocity(sectionProduction.energy, 0.42);
    const bassVelocity = energyVelocity(sectionProduction.energy, 0.36);
    const sectionStart = ticks;
    const sectionTicks = ticksPerBar * arrangement.production.barsPerSection;
    section.chords.forEach((_chord, chordIndex) => {
      const onset = Math.round(chordIndex * sectionTicks / section.chords.length);
      const end = Math.round((chordIndex + 1) * sectionTicks / section.chords.length);
      ticks = sectionStart + onset;
      const durationTicks = end - onset;
      const voicing = voicingPlan.sections[sectionIndex][chordIndex];
      voicing.midiNotes.forEach((midiNote) => {
        harmonyTrack.addNote({
          midi: midiNote,
          ticks,
          durationTicks,
          velocity: harmonyVelocity
        });
      });
      bassTrack.addNote({
        midi: voicing.bassMidi,
        ticks,
        durationTicks,
        velocity: bassVelocity
      });
    });
    ticks = sectionStart + sectionTicks;
  });

  const riffNotes = buildRiffNotes(arrangement);
  if (riffNotes.length) {
    const riffTrack = midi.addTrack();
    riffTrack.name = "ChordFlow Riff";
    riffNotes.forEach(note => riffTrack.addNote({
      midi: note.midi, ticks: Math.round(note.beat * midi.header.ppq),
      durationTicks: Math.max(1, Math.round(note.duration * midi.header.ppq)), velocity: note.velocity
    }));
  }

  return midi;
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const label = (offset: number, text: string) => [...text].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  label(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true);
  label(8, "WAVE"); label(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767)), true));
  return buffer;
}

// A lightweight reference rendering for downstream audio upload, not a sampled piano.
export async function exportReferenceWav(arrangement: Arrangement, riffOnly = false): Promise<void> {
  const schedule = buildPlaybackSchedule(arrangement);
  const sampleRate = 44100;
  const context = new OfflineAudioContext(1, Math.ceil((schedule.durationMs / 1000 + 0.2) * sampleRate), sampleRate);
  const notes: { midi: number; seconds: number; duration: number; gain: number }[] = [];
  if (!riffOnly) {
    const voicings = buildVoicingPlan(arrangement);
    schedule.steps.forEach(step => {
      const voice = voicings.sections[step.sectionIndex][step.chordIndex];
      [voice.bassMidi, ...voice.midiNotes].forEach(midi => notes.push({ midi, seconds: step.offsetMs / 1000, duration: step.durationSeconds * 0.9, gain: 0.06 * step.velocity }));
    });
  }
  buildRiffNotes(arrangement).forEach(note => notes.push({ midi: note.midi, seconds: 0.08 + note.beat * 60 / arrangement.production.tempoBpm, duration: note.duration * 60 / arrangement.production.tempoBpm, gain: note.velocity * 0.16 }));
  for (const note of notes) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((note.midi - 69) / 12);
    envelope.gain.setValueAtTime(0, note.seconds);
    envelope.gain.linearRampToValueAtTime(note.gain, note.seconds + Math.min(0.01, note.duration / 2));
    envelope.gain.linearRampToValueAtTime(0, note.seconds + note.duration);
    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(note.seconds);
    oscillator.stop(note.seconds + note.duration);
  }
  const audio = await context.startRendering();
  downloadBlob(new Blob([encodeWav(audio.getChannelData(0), sampleRate)], { type: "audio/wav" }), "chordflow-riff-reference.wav");
}

export function exportMidi(arrangement: Arrangement, filename = "chordflow-" + arrangement.formPattern.toLowerCase() + ".mid"): void {
  const midi = buildMidi(arrangement);

  downloadBlob(
    new Blob([midi.toArray()], { type: "audio/midi" }),
    filename
  );
}
