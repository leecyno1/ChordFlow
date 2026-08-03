import { Lock, RefreshCw, Unlock } from "lucide-react";
import { functionColor, harmonicFunction } from "../domain/music";
import { getVoicingProfile } from "../domain/production";
import type { Arrangement } from "../domain/types";

interface ArrangementTimelineProps {
  arrangement: Arrangement;
  activeSection: number;
  activeChord: number;
  playingPosition?: { section: number; chord: number } | null;
  onSelect: (sectionIndex: number, chordIndex: number) => void;
  onToggleLock: (symbol: string) => void;
  onRegenerateTheme: (symbol: string) => void;
}

export function ArrangementTimeline({
  arrangement,
  activeSection,
  activeChord,
  playingPosition,
  onSelect,
  onToggleLock,
  onRegenerateTheme
}: ArrangementTimelineProps) {
  const themeCount = new Set(
    arrangement.sections.map((section) => section.symbol)
  ).size;

  return (
    <section className="timeline-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ARRANGEMENT MAP</span>
          <h2>整曲结构</h2>
        </div>
        <div className="timeline-summary">
          {arrangement.formPattern} · {arrangement.sections.length} 段 ·{" "}
          {arrangement.sections.length * arrangement.production.barsPerSection}{" "}
          小节 · {arrangement.production.tempoBpm} BPM ·{" "}
          {arrangement.production.timeSignature} ·{" "}
          {getVoicingProfile(arrangement.production.voicingMode).label}声部
          {arrangement.lockedSymbols.length > 0
            ? ` · 锁定 ${arrangement.lockedSymbols.length}/${themeCount}`
            : ""}
        </div>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-track">
          {arrangement.sections.map((section, sectionIndex) => (
            <article
              className={
                "timeline-section " +
                (sectionIndex === activeSection ? "active " : "") +
                (arrangement.lockedSymbols.includes(section.symbol)
                  ? "locked"
                  : "")
              }
              key={section.id}
              style={{ "--section-energy": section.energy + "%" } as React.CSSProperties}
            >
              <div className="timeline-section-head">
                <span className="timeline-symbol">{section.symbol}</span>
                <div className="timeline-section-copy">
                  <strong>{section.title}</strong>
                  <small>
                    {section.transitionLabel
                      ? section.transitionLabel + "过渡"
                      : section.variationLabel || "主题原型"}{" "}
                    · 能量 {section.energy}
                  </small>
                </div>
                <div className="timeline-theme-actions">
                  <button
                    type="button"
                    className={
                      "timeline-lock " +
                      (arrangement.lockedSymbols.includes(section.symbol)
                        ? "active"
                        : "")
                    }
                    onClick={() => onToggleLock(section.symbol)}
                    aria-label={
                      arrangement.lockedSymbols.includes(section.symbol)
                        ? `解锁 ${section.symbol} 主题`
                        : `锁定 ${section.symbol} 主题`
                    }
                    title={
                      arrangement.lockedSymbols.includes(section.symbol)
                        ? "解锁同字母主题"
                        : "锁定同字母主题"
                    }
                  >
                    {arrangement.lockedSymbols.includes(section.symbol) ? (
                      <Lock size={12} />
                    ) : (
                      <Unlock size={12} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRegenerateTheme(section.symbol)}
                    disabled={arrangement.lockedSymbols.includes(section.symbol)}
                    aria-label={`重新生成 ${section.symbol} 主题`}
                    title="同步更新所有同字母段落"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
              </div>
              <div className="timeline-chords">
                {section.chords.map((chord, chordIndex) => {
                  const isSelected =
                    sectionIndex === activeSection && chordIndex === activeChord;
                  const isPlaying =
                    playingPosition?.section === sectionIndex &&
                    playingPosition?.chord === chordIndex;
                  const color = functionColor(
                    harmonicFunction(section.numerals[chordIndex])
                  );
                  return (
                    <button
                      type="button"
                      key={section.id + chordIndex}
                      className={
                        "timeline-chord " +
                        (isSelected ? "selected " : "") +
                        (isPlaying ? "playing" : "")
                      }
                      style={{ "--chord-color": color } as React.CSSProperties}
                      onClick={() => onSelect(sectionIndex, chordIndex)}
                    >
                      <span>{chord}</span>
                      <small>{section.numerals[chordIndex]}</small>
                    </button>
                  );
                })}
              </div>
              <div className="energy-line" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
