import type { Arrangement } from "./types";

export const ARRANGEMENT_HISTORY_LIMIT = 48;

export interface ArrangementHistory {
  past: Arrangement[];
  present: Arrangement;
  future: Arrangement[];
}

export function createArrangementHistory(
  arrangement: Arrangement
): ArrangementHistory {
  return {
    past: [],
    present: arrangement,
    future: []
  };
}

export function commitArrangementHistory(
  history: ArrangementHistory,
  arrangement: Arrangement,
  limit = ARRANGEMENT_HISTORY_LIMIT
): ArrangementHistory {
  if (arrangement === history.present) return history;

  return {
    past: [...history.past, history.present].slice(-Math.max(1, limit)),
    present: arrangement,
    future: []
  };
}

export function mapArrangementHistory(
  history: ArrangementHistory,
  update: (arrangement: Arrangement) => Arrangement
): ArrangementHistory {
  return {
    past: history.past.map(update),
    present: update(history.present),
    future: history.future.map(update)
  };
}

export function undoArrangementHistory(
  history: ArrangementHistory
): ArrangementHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future]
  };
}

export function redoArrangementHistory(
  history: ArrangementHistory
): ArrangementHistory {
  const next = history.future[0];
  if (!next) return history;

  return {
    past: [...history.past, history.present].slice(
      -ARRANGEMENT_HISTORY_LIMIT
    ),
    present: next,
    future: history.future.slice(1)
  };
}
