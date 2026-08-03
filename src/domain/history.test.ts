import { describe, expect, it } from "vitest";
import { generateArrangement } from "../engine/generate";
import {
  commitArrangementHistory,
  createArrangementHistory,
  mapArrangementHistory,
  redoArrangementHistory,
  undoArrangementHistory
} from "./history";

function arrangement(seed: number) {
  return generateArrangement({
    formId: "ababcb",
    key: "C",
    mode: "major",
    style: "华语流行",
    surprise: 34,
    seed
  });
}

describe("arrangement history", () => {
  it("moves edits backward and forward", () => {
    const first = arrangement(1);
    const second = arrangement(2);
    const committed = commitArrangementHistory(
      createArrangementHistory(first),
      second
    );
    const undone = undoArrangementHistory(committed);
    const redone = redoArrangementHistory(undone);

    expect(undone.present).toBe(first);
    expect(undone.future).toEqual([second]);
    expect(redone.present).toBe(second);
    expect(redone.future).toEqual([]);
  });

  it("clears the redo branch after a new edit", () => {
    const first = arrangement(10);
    const second = arrangement(11);
    const third = arrangement(12);
    const undone = undoArrangementHistory(
      commitArrangementHistory(createArrangementHistory(first), second)
    );
    const branched = commitArrangementHistory(undone, third);

    expect(branched.present).toBe(third);
    expect(branched.future).toEqual([]);
  });

  it("caps retained snapshots and ignores identity no-ops", () => {
    const first = arrangement(20);
    const initial = createArrangementHistory(first);
    const unchanged = commitArrangementHistory(initial, first);
    let current = initial;

    for (let seed = 21; seed <= 26; seed += 1) {
      current = commitArrangementHistory(current, arrangement(seed), 3);
    }

    expect(unchanged).toBe(initial);
    expect(current.past).toHaveLength(3);
  });

  it("keeps preview-only parameters stable across the whole history", () => {
    const first = arrangement(30);
    const second = arrangement(31);
    const history = commitArrangementHistory(
      createArrangementHistory(first),
      second
    );
    const mapped = mapArrangementHistory(history, (item) => ({
      ...item,
      surprise: 72
    }));

    expect(undoArrangementHistory(mapped).present.surprise).toBe(72);
    expect(mapped.present.surprise).toBe(72);
  });
});
