import {
  ArrowRight,
  Check,
  FlaskConical,
  Play,
  Sparkles
} from "lucide-react";
import type {
  Arrangement,
  TransitionSuggestion
} from "../domain/types";

interface TransitionWorkshopProps {
  arrangement: Arrangement;
  activeSection: number;
  suggestions: TransitionSuggestion[];
  onPreview: (suggestion: TransitionSuggestion) => void;
  onApply: (suggestion: TransitionSuggestion) => void;
}

export function TransitionWorkshop({
  arrangement,
  activeSection,
  suggestions,
  onPreview,
  onApply
}: TransitionWorkshopProps) {
  const section = arrangement.sections[activeSection];
  const nextSection = arrangement.sections[activeSection + 1];

  return (
    <section className="transition-workshop">
      <div className="transition-heading">
        <div>
          <span className="eyebrow">05 · TRANSITION WORKSHOP</span>
          <h2>段落边界工坊</h2>
          <p>改写当前段落最后一拍，为下一个结构入口制造方向、阴影或半音张力。</p>
        </div>
        {section && nextSection ? (
          <div className="boundary-route">
            <span>
              <small>{section.symbol} · {section.title}</small>
              <strong>{section.chords.at(-1)}</strong>
            </span>
            <div>
              <i />
              <ArrowRight size={14} />
            </div>
            <span>
              <small>{nextSection.symbol} · {nextSection.title}</small>
              <strong>{nextSection.chords[0]}</strong>
            </span>
          </div>
        ) : (
          <div className="boundary-empty">最终段落没有下一个结构边界</div>
        )}
      </div>

      {suggestions.length > 0 ? (
        <div className="transition-grid">
          {suggestions.map((suggestion) => {
            const isApplied = section.transitionLabel === suggestion.name;
            return (
              <article
                className={"transition-card " + (isApplied ? "applied" : "")}
                key={suggestion.id}
                style={{ "--transition-color": suggestion.color } as React.CSSProperties}
              >
                <div className="transition-card-head">
                  <span className="technique">
                    {suggestion.complexity > 1 ? <FlaskConical size={13} /> : <Sparkles size={13} />}
                    {suggestion.technique}
                  </span>
                  <span className="complexity">
                    复杂度 {suggestion.complexity}/3
                  </span>
                </div>
                <h3>{suggestion.name}</h3>
                <span className="transition-en">{suggestion.nameEn}</span>
                <div className="transition-chain">
                  {suggestion.previewChords.map((chord, index) => (
                    <span key={chord + index}>
                      <b>{chord}</b>
                      {index < suggestion.previewChords.length - 1 ? <ArrowRight size={11} /> : null}
                    </span>
                  ))}
                </div>
                <p>{suggestion.description}</p>
                <div className="tension-meter">
                  <span>张力 {suggestion.tension}</span>
                  <i><b style={{ width: suggestion.tension + "%" }} /></i>
                </div>
                <div className="transition-actions">
                  <button type="button" onClick={() => onPreview(suggestion)}>
                    <Play size={12} fill="currentColor" />
                    试听边界
                  </button>
                  <button
                    type="button"
                    className="apply-transition"
                    onClick={() => onApply(suggestion)}
                  >
                    {isApplied ? <Check size={13} /> : <ArrowRight size={13} />}
                    {isApplied ? "已应用" : "应用"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="transition-end-note">
          选择前面的任意段落，即可为它和下一段之间生成过渡方案。
        </div>
      )}
    </section>
  );
}
