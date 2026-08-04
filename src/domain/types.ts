export type Mode = "major" | "minor";

export type TimeSignature = "4/4" | "3/4" | "6/8";
export type VoicingMode = "stable" | "flowing" | "dramatic";

export interface SectionProductionOverride {
  energy: number;
  voicingMode: VoicingMode;
}

export interface ProductionSettings {
  tempoBpm: number;
  timeSignature: TimeSignature;
  barsPerSection: number;
  voicingMode: VoicingMode;
  sectionOverrides: Record<string, SectionProductionOverride>;
}

export type SectionRole =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "outro";

export type HarmonicFunction =
  | "tonic"
  | "predominant"
  | "dominant"
  | "chromatic";

export interface FormPreset {
  id: string;
  name: string;
  pattern: string;
  description: string;
}

export interface ProgressionTemplate {
  id: string;
  nameZh: string;
  nameEn: string;
  numerals: string[];
  description: string;
  moods: string[];
  genres: string[];
  suitableRoles: SectionRole[];
  modes: Mode[];
  energy: number;
  familiarityIndex: number;
  clicheRisk: number;
  sourceNote: string;
}

export interface SongSection {
  id: string;
  symbol: string;
  occurrence: number;
  role: SectionRole;
  title: string;
  templateId: string;
  numerals: string[];
  chords: string[];
  energy: number;
  variationLabel?: string;
  transitionLabel?: string;
}

export interface Arrangement {
  title: string;
  key: string;
  mode: Mode;
  formId: string;
  formPattern: string;
  style: string;
  surprise: number;
  seed: number;
  lockedSymbols: string[];
  bassOverrides: Record<string, number>;
  production: ProductionSettings;
  sections: SongSection[];
  generatedAt: string;
}

export interface ChordCandidate {
  roman: string;
  weight: number;
  label: string;
  reason: string;
  source?: string;
  count?: number;
  songCount?: number;
  songCoverage?: number;
}

export interface CorpusChordStat {
  eventCount: number;
  eventShare: number;
  durationSeconds: number;
  durationShare: number;
  songCount: number;
  songCoverage: number;
}

export interface CorpusTransitionStat {
  to: string;
  count: number;
  probability: number;
  songCount: number;
  songCoverage: number;
}

export interface CorpusProgressionStat {
  pattern: string[];
  occurrenceCount: number;
  songCount: number;
  songCoverage: number;
}

export interface CorpusStatistics {
  metadata: {
    source: string;
    sourceUrl: string;
    sourceCommit: string;
    generatedAt: string;
    songCount: number;
    collapsedChordEventCount: number;
    transitionCount: number;
    annotatedDurationSeconds: number;
    skippedLabelCount: number;
    license: string;
    method: string;
    scope: string;
  };
  chords: Record<string, CorpusChordStat>;
  transitions: Record<string, CorpusTransitionStat[]>;
  progressions: Record<string, CorpusProgressionStat>;
}

export type StructureRole =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "postchorus"
  | "bridge"
  | "solo"
  | "instrumental"
  | "breakdown"
  | "interlude"
  | "outro"
  | "silence"
  | "other";

export interface StructureRoleStat {
  segmentCount: number;
  songCount: number;
  songCoverage: number;
  averageDurationSeconds: number;
  medianDurationSeconds: number;
  averageStartPosition: number;
  averageOccurrencesPerContainingSong: number;
}

export interface StructureTransitionStat {
  to: StructureRole;
  count: number;
  probability: number;
  songCount: number;
  songCoverage: number;
}

export interface StructureExample {
  title: string;
  artist: string;
  genre: string;
}

export interface StructureFamilyStat {
  pattern: string;
  exactSongCount: number;
  exactCoverage: number;
  familySongCount: number;
  familyCoverage: number;
  averageFamilySimilarity: number;
  examples: StructureExample[];
}

export interface StructurePatternStat {
  pattern: string;
  songCount: number;
  songCoverage: number;
  examples: StructureExample[];
}

export interface StructureStatistics {
  metadata: {
    source: string;
    sourceUrl: string;
    sourceCommit: string;
    generatedAt: string;
    songCount: number;
    segmentCount: number;
    license: string;
    method: string;
    scope: string;
  };
  roles: Partial<Record<StructureRole, StructureRoleStat>>;
  transitions: Partial<Record<StructureRole, StructureTransitionStat[]>>;
  formFamilies: Record<string, StructureFamilyStat>;
  topPatterns: StructurePatternStat[];
  genres: Array<{
    genre: string;
    songCount: number;
    songCoverage: number;
  }>;
}

export interface TransitionSuggestion {
  id: string;
  name: string;
  nameEn: string;
  technique: string;
  roman: string;
  chord: string;
  description: string;
  complexity: number;
  tension: number;
  color: string;
  previewChords: string[];
}
