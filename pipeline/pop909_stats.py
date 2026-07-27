#!/usr/bin/env python3
"""Build corpus-grounded harmonic statistics from the POP909 annotations.

The pipeline intentionally uses only the Python standard library. It reads each
song once, normalizes chord roots against the active key, collapses consecutive
duplicates, and computes:

- chord-event share
- duration share
- song coverage
- conditional next-chord probability
- exact named-progression coverage

The result is a compact JSON artifact consumed directly by the ChordFlow UI.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


PITCH_CLASS = {
    "C": 0,
    "B#": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "Fb": 4,
    "E#": 5,
    "F": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
    "Cb": 11,
}

MAJOR_DEGREES = {
    0: "I",
    1: "bII",
    2: "II",
    3: "bIII",
    4: "III",
    5: "IV",
    6: "#IV",
    7: "V",
    8: "bVI",
    9: "VI",
    10: "bVII",
    11: "VII",
}

MINOR_DEGREES = {
    0: "I",
    1: "bII",
    2: "II",
    3: "III",
    4: "#III",
    5: "IV",
    6: "bV",
    7: "V",
    8: "VI",
    9: "#VI",
    10: "VII",
    11: "#VII",
}

NAMED_PROGRESSIONS = {
    "axis": ["I", "V", "vi", "IV"],
    "sensitive-loop": ["vi", "IV", "I", "V"],
    "doo-wop": ["I", "vi", "IV", "V"],
    "royal-road": ["IV", "V", "iii", "vi"],
    "canon": ["I", "V", "vi", "iii", "IV", "I", "IV", "V"],
    "one-six-two-five": ["I", "vi", "ii", "V"],
    "two-five-one": ["ii", "V", "I"],
    "dream-borrow": ["I", "iii", "IV", "iv"],
    "plagal-fall": ["I", "IV", "iv", "I"],
    "chromatic-mediant": ["I", "bIII", "bVI", "V"],
    "minor-cinema": ["i", "VI", "III", "VII"],
    "andalusian": ["i", "VII", "VI", "V"],
    "minor-plagal": ["i", "iv", "VI", "V"],
}


@dataclass(frozen=True)
class KeySegment:
    start: float
    end: float
    tonic_pc: int
    mode: str
    label: str


@dataclass(frozen=True)
class ChordEvent:
    start: float
    end: float
    roman: str

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


def parse_tsv(path: Path) -> Iterable[tuple[float, float, str]]:
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            columns = line.split("\t")
            if len(columns) < 3:
                continue
            try:
                yield float(columns[0]), float(columns[1]), columns[2].strip()
            except ValueError:
                continue


def parse_key_label(label: str) -> tuple[int, str] | None:
    if ":" not in label:
        return None
    tonic, quality = label.split(":", 1)
    tonic_pc = PITCH_CLASS.get(tonic)
    if tonic_pc is None:
        return None
    mode = "minor" if quality.lower().startswith("min") else "major"
    return tonic_pc, mode


def load_key_segments(path: Path) -> list[KeySegment]:
    segments: list[KeySegment] = []
    for start, end, label in parse_tsv(path):
        parsed = parse_key_label(label)
        if parsed is None:
            continue
        tonic_pc, mode = parsed
        segments.append(KeySegment(start, end, tonic_pc, mode, label))
    return sorted(segments, key=lambda item: item.start)


def active_key(midpoint: float, segments: list[KeySegment]) -> KeySegment | None:
    if not segments:
        return None
    for segment in segments:
        if segment.start <= midpoint <= segment.end:
            return segment
    return min(
        segments,
        key=lambda segment: min(
            abs(midpoint - segment.start), abs(midpoint - segment.end)
        ),
    )


def lower_numeral(numeral: str) -> str:
    prefix_length = 0
    while prefix_length < len(numeral) and numeral[prefix_length] in {"b", "#"}:
        prefix_length += 1
    return numeral[:prefix_length] + numeral[prefix_length:].lower()


def chord_to_roman(label: str, key: KeySegment) -> str | None:
    if label in {"N", "X"} or ":" not in label:
        return None
    root, quality_with_bass = label.split(":", 1)
    root_pc = PITCH_CLASS.get(root)
    if root_pc is None:
        return None

    quality = quality_with_bass.split("/", 1)[0].lower()
    delta = (root_pc - key.tonic_pc) % 12
    numeral = (
        MAJOR_DEGREES[delta] if key.mode == "major" else MINOR_DEGREES[delta]
    )

    is_minor = quality.startswith("min") or quality.startswith("hdim")
    is_diminished = quality.startswith("dim") or quality.startswith("hdim")
    if is_minor or is_diminished:
        numeral = lower_numeral(numeral)
    if quality.startswith("hdim"):
        numeral += "ø"
    elif quality.startswith("dim"):
        numeral += "°"
    return numeral


def load_song_events(song_dir: Path) -> tuple[list[ChordEvent], int]:
    chord_path = song_dir / "chord_midi.txt"
    key_path = song_dir / "key_audio.txt"
    if not chord_path.exists() or not key_path.exists():
        return [], 0

    keys = load_key_segments(key_path)
    events: list[ChordEvent] = []
    skipped = 0
    for start, end, label in parse_tsv(chord_path):
        if label in {"N", "X"}:
            continue
        key = active_key((start + end) / 2, keys)
        if key is None:
            skipped += 1
            continue
        roman = chord_to_roman(label, key)
        if roman is None:
            skipped += 1
            continue
        events.append(ChordEvent(start, end, roman))
    return events, skipped


def collapse_sequence(events: list[ChordEvent]) -> list[str]:
    sequence: list[str] = []
    for event in events:
        if not sequence or sequence[-1] != event.roman:
            sequence.append(event.roman)
    return sequence


def count_pattern(sequence: list[str], pattern: list[str]) -> int:
    size = len(pattern)
    if size == 0 or len(sequence) < size:
        return 0
    return sum(
        1
        for index in range(len(sequence) - size + 1)
        if sequence[index : index + size] == pattern
    )


def source_commit(source_root: Path) -> str:
    try:
        return (
            subprocess.check_output(
                ["git", "-C", str(source_root), "rev-parse", "HEAD"],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            .strip()
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def build_statistics(source_root: Path) -> dict:
    songs_root = source_root / "POP909"
    if not songs_root.exists():
        raise FileNotFoundError(
            f"POP909 directory not found under {source_root}. "
            "Run the sparse checkout described in pipeline/README.md."
        )

    chord_event_counts: Counter[str] = Counter()
    chord_duration: Counter[str] = Counter()
    chord_song_sets: dict[str, set[str]] = defaultdict(set)
    transition_counts: Counter[tuple[str, str]] = Counter()
    transition_song_sets: dict[tuple[str, str], set[str]] = defaultdict(set)
    progression_counts: Counter[str] = Counter()
    progression_song_sets: dict[str, set[str]] = defaultdict(set)

    songs_analyzed = 0
    skipped_labels = 0
    total_annotated_duration = 0.0
    total_collapsed_events = 0

    for song_dir in sorted(path for path in songs_root.iterdir() if path.is_dir()):
        events, song_skipped = load_song_events(song_dir)
        skipped_labels += song_skipped
        if not events:
            continue

        song_id = song_dir.name
        songs_analyzed += 1
        sequence = collapse_sequence(events)
        total_collapsed_events += len(sequence)

        for event in events:
            chord_duration[event.roman] += event.duration
            total_annotated_duration += event.duration

        for roman in sequence:
            chord_event_counts[roman] += 1
            chord_song_sets[roman].add(song_id)

        song_transitions = set()
        for source, target in zip(sequence, sequence[1:]):
            transition_counts[(source, target)] += 1
            song_transitions.add((source, target))
        for transition in song_transitions:
            transition_song_sets[transition].add(song_id)

        for progression_id, pattern in NAMED_PROGRESSIONS.items():
            occurrences = count_pattern(sequence, pattern)
            if occurrences:
                progression_counts[progression_id] += occurrences
                progression_song_sets[progression_id].add(song_id)

    transitions_by_source: dict[str, list[dict]] = defaultdict(list)
    outgoing_totals: Counter[str] = Counter()
    for (source, _), count in transition_counts.items():
        outgoing_totals[source] += count

    for (source, target), count in transition_counts.items():
        transitions_by_source[source].append(
            {
                "to": target,
                "count": count,
                "probability": round(count / outgoing_totals[source], 6),
                "songCount": len(transition_song_sets[(source, target)]),
                "songCoverage": round(
                    len(transition_song_sets[(source, target)])
                    / max(1, songs_analyzed),
                    6,
                ),
            }
        )

    for source in transitions_by_source:
        transitions_by_source[source].sort(
            key=lambda item: (-item["count"], item["to"])
        )
        transitions_by_source[source] = transitions_by_source[source][:12]

    chord_stats = {}
    for roman, count in chord_event_counts.most_common():
        chord_stats[roman] = {
            "eventCount": count,
            "eventShare": round(count / max(1, total_collapsed_events), 6),
            "durationSeconds": round(chord_duration[roman], 3),
            "durationShare": round(
                chord_duration[roman] / max(0.000001, total_annotated_duration), 6
            ),
            "songCount": len(chord_song_sets[roman]),
            "songCoverage": round(
                len(chord_song_sets[roman]) / max(1, songs_analyzed), 6
            ),
        }

    progression_stats = {}
    for progression_id, pattern in NAMED_PROGRESSIONS.items():
        song_count = len(progression_song_sets[progression_id])
        progression_stats[progression_id] = {
            "pattern": pattern,
            "occurrenceCount": progression_counts[progression_id],
            "songCount": song_count,
            "songCoverage": round(song_count / max(1, songs_analyzed), 6),
        }

    return {
        "metadata": {
            "source": "POP909",
            "sourceUrl": "https://github.com/music-x-lab/POP909-Dataset",
            "sourceCommit": source_commit(source_root),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "songCount": songs_analyzed,
            "collapsedChordEventCount": total_collapsed_events,
            "transitionCount": sum(transition_counts.values()),
            "annotatedDurationSeconds": round(total_annotated_duration, 3),
            "skippedLabelCount": skipped_labels,
            "license": "MIT repository license; retain citation and verify downstream data-distribution requirements.",
            "method": (
                "Key-relative Roman numerals; consecutive duplicate chords collapsed; "
                "song coverage counted once per song; exact contiguous progression matching."
            ),
            "scope": "909 Chinese pop arrangements; not a global usage estimate.",
        },
        "chords": chord_stats,
        "transitions": dict(sorted(transitions_by_source.items())),
        "progressions": progression_stats,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("data/sources/pop909-repo"),
        help="Path to the sparse POP909 repository checkout.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src/data/pop909-stats.json"),
        help="Output JSON consumed by the frontend.",
    )
    args = parser.parse_args()

    statistics = build_statistics(args.source.resolve())
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(statistics, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    metadata = statistics["metadata"]
    print(
        f"Wrote {output} — {metadata['songCount']} songs, "
        f"{metadata['collapsedChordEventCount']} chord events, "
        f"{metadata['transitionCount']} transitions."
    )


if __name__ == "__main__":
    main()
