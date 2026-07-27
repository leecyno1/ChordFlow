#!/usr/bin/env python3
"""Build functional song-form statistics from the Harmonix Set.

Harmonix contains structural annotations, not chord annotations. This pipeline
therefore stays strictly on the form layer: section roles, positions, durations,
role-to-role transitions, and abstract A/B/C identity patterns.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


PRESET_PATTERNS = ["ABA", "AABA", "ABAB", "ABABCB", "ABCBA", "ABACA"]
FAMILY_SIMILARITY_THRESHOLD = 0.70
CORE_ROLES = {"verse", "chorus", "bridge"}
ROLE_ORDER = [
    "intro",
    "verse",
    "prechorus",
    "chorus",
    "postchorus",
    "bridge",
    "solo",
    "instrumental",
    "breakdown",
    "interlude",
    "outro",
    "silence",
    "other",
]


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


def normalize_label(raw_label: str) -> str:
    label = raw_label.strip().lower()
    label = re.sub(r"[\s_-]*\d+[a-z]?$", "", label)
    compact = re.sub(r"[\s_-]+", "", label)

    if compact in {"end", "endofsong"}:
        return "end"
    if compact.startswith("silence"):
        return "silence"
    if compact.startswith(("prechorus", "preverse")):
        return "prechorus"
    if compact.startswith("postchorus"):
        return "postchorus"
    if compact.startswith(
        ("chorus", "refrain", "hook", "altchorus", "quietchorus", "intchorus")
    ):
        return "chorus"
    if compact.startswith(("verse", "slowverse", "miniverse")):
        return "verse"
    if compact.startswith(("bridge", "middle8")):
        return "bridge"
    if compact.startswith(("intro", "opening")):
        return "intro"
    if compact.startswith(("outro", "ending", "coda", "bigoutro", "vocaloutro")):
        return "outro"
    if compact.startswith(("solo", "guitarsolo")):
        return "solo"
    if compact.startswith(
        ("instrumental", "inst", "gtr", "mainriff", "guitar", "synth", "saxobeat")
    ):
        return "instrumental"
    if compact.startswith(("breakdown", "break")):
        return "breakdown"
    if compact.startswith(("interlude", "transition")):
        return "interlude"
    return "other"


def load_metadata(path: Path) -> dict[str, dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return {
            row["File"]: row
            for row in csv.DictReader(handle)
            if row.get("File")
        }


def load_boundaries(path: Path) -> list[tuple[float, str]]:
    boundaries: list[tuple[float, str]] = []
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            columns = raw_line.strip().split(maxsplit=1)
            if len(columns) != 2:
                continue
            try:
                timestamp = float(columns[0])
            except ValueError:
                continue
            boundaries.append((timestamp, normalize_label(columns[1])))
    return sorted(boundaries)


def collapse(sequence: list[str]) -> list[str]:
    result: list[str] = []
    for item in sequence:
        if not result or result[-1] != item:
            result.append(item)
    return result


def identity_pattern(sequence: list[str]) -> str:
    # Repeated verse/chorus boundaries are musically meaningful (AAB, final BB,
    # and so on), so the form layer must preserve them. Only non-core roles are
    # ignored; transition statistics use a separately collapsed sequence.
    core = [role for role in sequence if role in CORE_ROLES]
    identity: dict[str, str] = {}
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    pattern = ""
    for role in core:
        if role not in identity:
            identity[role] = letters[len(identity)]
        pattern += identity[role]
    return pattern


def edit_distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_char in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_char != right_char),
                )
            )
        previous = current
    return previous[-1]


def closest_preset(pattern: str) -> tuple[str, float]:
    candidates = []
    for preset in PRESET_PATTERNS:
        distance = edit_distance(pattern, preset)
        similarity = 1 - distance / max(1, len(pattern), len(preset))
        candidates.append((preset, similarity, distance))
    candidates.sort(key=lambda item: (-item[1], item[2], len(item[0])))
    return candidates[0][0], candidates[0][1]


def safe_float(value: str | None, fallback: float = 0.0) -> float:
    try:
        return float(value or fallback)
    except ValueError:
        return fallback


def build_statistics(source_root: Path) -> dict:
    segments_root = source_root / "dataset" / "segments"
    metadata_path = source_root / "dataset" / "metadata.csv"
    if not segments_root.exists() or not metadata_path.exists():
        raise FileNotFoundError(
            f"Harmonix segments or metadata missing under {source_root}."
        )

    metadata = load_metadata(metadata_path)
    role_segment_counts: Counter[str] = Counter()
    role_song_sets: dict[str, set[str]] = defaultdict(set)
    role_durations: dict[str, list[float]] = defaultdict(list)
    role_positions: dict[str, list[float]] = defaultdict(list)
    role_occurrences_by_song: dict[str, list[int]] = defaultdict(list)
    transition_counts: Counter[tuple[str, str]] = Counter()
    transition_song_sets: dict[tuple[str, str], set[str]] = defaultdict(set)
    pattern_counts: Counter[str] = Counter()
    pattern_examples: dict[str, list[dict[str, str]]] = defaultdict(list)
    family_counts: Counter[str] = Counter()
    family_similarity: dict[str, list[float]] = defaultdict(list)
    family_examples: dict[str, list[dict[str, str]]] = defaultdict(list)
    genre_counts: Counter[str] = Counter()

    songs_analyzed = 0
    total_segments = 0

    for segment_path in sorted(segments_root.glob("*.txt")):
        song_id = segment_path.stem
        row = metadata.get(song_id, {})
        duration = safe_float(row.get("Duration"))
        boundaries = load_boundaries(segment_path)
        if not boundaries:
            continue
        if duration <= 0:
            duration = boundaries[-1][0]
        if duration <= 0:
            continue

        songs_analyzed += 1
        genre = (row.get("Genre") or "Unknown").strip()
        genre_counts[genre] += 1
        song_role_counts: Counter[str] = Counter()
        functional_sequence: list[str] = []
        pattern_sequence: list[str] = []

        for index, (start, role) in enumerate(boundaries):
            end = (
                boundaries[index + 1][0]
                if index + 1 < len(boundaries)
                else duration
            )
            if role == "end":
                continue
            segment_duration = max(0.0, end - start)
            role_segment_counts[role] += 1
            total_segments += 1
            role_song_sets[role].add(song_id)
            role_durations[role].append(segment_duration)
            role_positions[role].append(min(1.0, max(0.0, start / duration)))
            song_role_counts[role] += 1
            if role != "silence":
                functional_sequence.append(role)
                pattern_sequence.append(role)

        for role, count in song_role_counts.items():
            role_occurrences_by_song[role].append(count)

        functional_sequence = collapse(functional_sequence)
        song_transitions = set()
        for source, target in zip(functional_sequence, functional_sequence[1:]):
            transition_counts[(source, target)] += 1
            song_transitions.add((source, target))
        for transition in song_transitions:
            transition_song_sets[transition].add(song_id)

        pattern = identity_pattern(pattern_sequence)
        if len(pattern) >= 2:
            pattern_counts[pattern] += 1
            example = {
                "title": row.get("Title") or song_id,
                "artist": row.get("Artist") or "",
                "genre": genre,
            }
            if len(pattern_examples[pattern]) < 3:
                pattern_examples[pattern].append(example)

            family, similarity = closest_preset(pattern)
            if similarity >= FAMILY_SIMILARITY_THRESHOLD:
                family_counts[family] += 1
                family_similarity[family].append(similarity)
                if len(family_examples[family]) < 3:
                    family_examples[family].append(example)

    role_stats = {}
    for role in ROLE_ORDER:
        if not role_segment_counts[role]:
            continue
        durations = role_durations[role]
        positions = role_positions[role]
        role_stats[role] = {
            "segmentCount": role_segment_counts[role],
            "songCount": len(role_song_sets[role]),
            "songCoverage": round(
                len(role_song_sets[role]) / max(1, songs_analyzed), 6
            ),
            "averageDurationSeconds": round(statistics.fmean(durations), 3),
            "medianDurationSeconds": round(statistics.median(durations), 3),
            "averageStartPosition": round(statistics.fmean(positions), 6),
            "averageOccurrencesPerContainingSong": round(
                statistics.fmean(role_occurrences_by_song[role]), 3
            ),
        }

    outgoing_totals: Counter[str] = Counter()
    for (source, _), count in transition_counts.items():
        outgoing_totals[source] += count

    transitions: dict[str, list[dict]] = defaultdict(list)
    for (source, target), count in transition_counts.items():
        transitions[source].append(
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
    for source in transitions:
        transitions[source].sort(key=lambda item: (-item["count"], item["to"]))
        transitions[source] = transitions[source][:8]

    form_families = {}
    for preset in PRESET_PATTERNS:
        exact_count = pattern_counts[preset]
        family_count = family_counts[preset]
        similarities = family_similarity[preset]
        form_families[preset] = {
            "pattern": preset,
            "exactSongCount": exact_count,
            "exactCoverage": round(exact_count / max(1, songs_analyzed), 6),
            "familySongCount": family_count,
            "familyCoverage": round(family_count / max(1, songs_analyzed), 6),
            "averageFamilySimilarity": round(
                statistics.fmean(similarities) if similarities else 0.0, 6
            ),
            "examples": (
                pattern_examples[preset]
                if pattern_examples[preset]
                else family_examples[preset]
            ),
        }

    top_patterns = []
    for pattern, count in pattern_counts.most_common(16):
        top_patterns.append(
            {
                "pattern": pattern,
                "songCount": count,
                "songCoverage": round(count / max(1, songs_analyzed), 6),
                "examples": pattern_examples[pattern],
            }
        )

    return {
        "metadata": {
            "source": "Harmonix Set",
            "sourceUrl": "https://github.com/urinieto/harmonixset",
            "sourceCommit": source_commit(source_root),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "songCount": songs_analyzed,
            "segmentCount": total_segments,
            "license": "MIT repository license; audio is not redistributed.",
            "method": (
                "Functional labels normalized; adjacent equal labels collapsed for "
                "transitions; repeated core boundaries are preserved for A/B/C patterns, "
                "which use verse, chorus, and bridge only; each song is assigned to its "
                "nearest preset family when edit similarity is at least 70%."
            ),
            "scope": "912 Western pop tracks; structure statistics, not chord statistics.",
        },
        "roles": role_stats,
        "transitions": dict(sorted(transitions.items())),
        "formFamilies": form_families,
        "topPatterns": top_patterns,
        "genres": [
            {
                "genre": genre,
                "songCount": count,
                "songCoverage": round(count / max(1, songs_analyzed), 6),
            }
            for genre, count in genre_counts.most_common()
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("data/sources/harmonixset-repo"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src/data/harmonix-stats.json"),
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
        f"{metadata['segmentCount']} functional segments."
    )


if __name__ == "__main__":
    main()
