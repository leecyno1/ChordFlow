import { describe, expect, it } from "vitest";
import { generateArrangement } from "../engine/generate";
import { setBassOverride } from "./bass";
import { chordPitchClasses } from "./music";
import {
  LOCAL_PROJECT_KEY,
  loadLocalProject,
  parseArrangementJson,
  parseLocalProject,
  saveLocalProject,
  serializeLocalProject
} from "./projectStorage";

function arrangement() {
  return generateArrangement({
    formId: "ababcb",
    key: "D",
    mode: "major",
    style: "独立流行",
    surprise: 48,
    seed: 912
  });
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };
}

describe("local project storage", () => {
  it("round-trips an arrangement through the versioned envelope", () => {
    const base = arrangement();
    const pitchClass = chordPitchClasses(base.sections[0].chords[0])[1];
    const source = {
      ...setBassOverride(base, 0, 0, pitchClass),
      lockedSymbols: ["B"]
    };
    const savedAt = new Date("2026-08-04T02:30:00.000Z");
    const parsed = parseLocalProject(serializeLocalProject(source, savedAt));

    expect(parsed?.savedAt).toBe(savedAt.toISOString());
    expect(parsed?.arrangement).toEqual(source);
  });

  it("saves and loads from a storage-compatible local slot", () => {
    const storage = memoryStorage();
    const source = arrangement();
    const saved = saveLocalProject(source, storage);
    const loaded = loadLocalProject(storage);

    expect(storage.getItem(LOCAL_PROJECT_KEY)).not.toBeNull();
    expect(loaded).toEqual(saved);
  });

  it("migrates older arrangements without theme locks", () => {
    const source = arrangement();
    const {
      lockedSymbols: _lockedSymbols,
      bassOverrides: _bassOverrides,
      ...legacy
    } = source;
    const parsed = parseLocalProject(
      JSON.stringify({
        schemaVersion: 1,
        savedAt: "2026-08-04T00:00:00.000Z",
        arrangement: legacy
      })
    );

    expect(parsed?.arrangement.lockedSymbols).toEqual([]);
    expect(parsed?.arrangement.bassOverrides).toEqual({});
  });

  it("rejects malformed or unsupported project data", () => {
    expect(parseLocalProject("not-json")).toBeNull();
    expect(
      parseLocalProject(JSON.stringify({ schemaVersion: 99, arrangement: {} }))
    ).toBeNull();
    expect(
      parseArrangementJson(JSON.stringify({ ...arrangement(), key: "H" }))
    ).toBeNull();
    expect(
      parseArrangementJson(
        JSON.stringify({
          ...arrangement(),
          sections: arrangement().sections.map((section, index) =>
            index === 0 ? { ...section, role: "drop" } : section
          )
        })
      )
    ).toBeNull();
  });

  it("imports both exported arrangements and saved-project envelopes", () => {
    const source = arrangement();

    expect(parseArrangementJson(JSON.stringify(source))).toEqual(source);
    expect(
      parseArrangementJson(serializeLocalProject(source))
    ).toEqual(source);
    expect(parseArrangementJson("not-json")).toBeNull();
  });
});
