import { FREQUENCY_A4 } from "./music-constants";
import { NOTES } from "./music-scales";
import type { NoteInfo } from "./music-types";

export function midiToName(midi: number) {
  const idx = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return { name: NOTES[idx], octave, index: idx };
}

export function frequencyToNoteInfo(freq: number): NoteInfo | null {
  if (!isFinite(freq) || freq <= 0) return null;

  const exactMidi = 69 + 12 * Math.log2(freq / FREQUENCY_A4);
  const midi = Math.round(exactMidi);
  const { name, octave } = midiToName(midi);
  const cents = Math.round((exactMidi - midi) * 100);

  return { name, midi, octave, cents, frequency: freq };
}

export function midiToFrequency(midi: number): number {
  return FREQUENCY_A4 * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToCentsFromMidi(freq: number, midi: number): number {
  if (!isFinite(freq) || freq <= 0) return 0;
  return Math.round(1200 * Math.log2(freq / midiToFrequency(midi)));
}
