import { functionColor, harmonicFunction } from "../domain/music";
import type { Arrangement } from "../domain/types";

interface ArrangementTimelineProps {
  arrangement: Arrangement;
  activeSection: number;
  activeChord: number;
  playingPosition?: { section: number; chord: number } | null;
  onSelect: (sectionIndex: number, chordIndex: number) => void;
}

export function ArrangementTimeline({
  arrangement,
  activeSection,
  activeChord,
  playingPosition,
  onSelect
}: ArrangementTimelineProps) {
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
          {arrangement.production.timeSignature}
        </div>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-track">
          {arrangement.sections.map((section, sectionIndex) => (
            <article
              className={
                "timeline-section " +
                (sectionIndex === activeSection ? "active" : "")
              }
              key={section.id}
              style={{ "--section-energy": section.energy + "%" } as React.CSSProperties}
            >
              <div className="timeline-section-head">
                <span className="timeline-symbol">{section.symbol}</span>
                <div>
                  <strong>{section.title}</strong>
                  <small>
                    {section.transitionLabel
                      ? section.transitionLabel + "过渡"
                      : section.variationLabel || "主题原型"}{" "}
                    · 能量 {section.energy}
                  </small>
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
