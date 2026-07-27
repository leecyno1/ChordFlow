import { chordRoot, functionColor, harmonicFunction } from "../domain/music";
import type { SongSection } from "../domain/types";

const FIFTHS = [
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "Db",
  "Ab",
  "Eb",
  "Bb",
  "F"
];

interface FifthsLensProps {
  tonic: string;
  section: SongSection;
  selectedIndex: number;
  onSelectKey: (key: string) => void;
}

export function FifthsLens({
  tonic,
  section,
  selectedIndex,
  onSelectKey
}: FifthsLensProps) {
  const center = 230;
  const outerRadius = 174;
  const innerRadius = 105;
  const selectedRoot = chordRoot(section.chords[selectedIndex] ?? tonic);

  return (
    <div className="fifths-layout">
      <svg
        className="fifths-lens"
        viewBox="0 0 460 460"
        role="img"
        aria-label="交互式五度圈"
      >
        <defs>
          <radialGradient id="lensCore">
            <stop offset="0%" stopColor="#272128" />
            <stop offset="70%" stopColor="#111217" />
            <stop offset="100%" stopColor="#08090c" />
          </radialGradient>
          <filter id="lensGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={center} cy={center} r="207" fill="none" stroke="#fff" strokeOpacity=".06" />
        <circle cx={center} cy={center} r="145" fill="none" stroke="#fff" strokeOpacity=".08" strokeDasharray="2 9" />

        {FIFTHS.map((note, index) => {
          const angle = (index / FIFTHS.length) * Math.PI * 2 - Math.PI / 2;
          const x = center + Math.cos(angle) * outerRadius;
          const y = center + Math.sin(angle) * outerRadius;
          const active = note === tonic;
          const selected = note === selectedRoot;
          return (
            <g
              key={note}
              transform={"translate(" + x + " " + y + ")"}
              className={"fifths-key " + (active ? "active" : "")}
              onClick={() => onSelectKey(note)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectKey(note);
              }}
            >
              <circle
                r={active ? 27 : 21}
                fill={active ? "#2a151a" : "#111217"}
                stroke={active ? "#ff6b78" : selected ? "#f4b860" : "#ffffff"}
                strokeOpacity={active || selected ? 1 : 0.16}
                strokeWidth={active ? 2.5 : 1}
                filter={active ? "url(#lensGlow)" : undefined}
              />
              <text textAnchor="middle" y="5">
                {note}
              </text>
            </g>
          );
        })}

        {section.numerals.slice(0, 7).map((roman, index) => {
          const angle =
            (index / Math.min(7, section.numerals.length)) * Math.PI * 2 -
            Math.PI / 2;
          const x = center + Math.cos(angle) * innerRadius;
          const y = center + Math.sin(angle) * innerRadius;
          const active = index === selectedIndex;
          const color = functionColor(harmonicFunction(roman));
          return (
            <g key={roman + index} transform={"translate(" + x + " " + y + ")"}>
              <circle
                r={active ? 19 : 13}
                fill="#0e0f13"
                stroke={color}
                strokeWidth={active ? 2.5 : 1.2}
                opacity={active ? 1 : 0.72}
              />
              <text className="fifths-roman" textAnchor="middle" y="4">
                {roman}
              </text>
            </g>
          );
        })}

        <circle cx={center} cy={center} r="72" fill="url(#lensCore)" stroke="#fff" strokeOpacity=".09" />
        <text x={center} y={center - 14} textAnchor="middle" className="lens-caption">
          TONAL CENTER
        </text>
        <text x={center} y={center + 21} textAnchor="middle" className="lens-tonic">
          {tonic}
        </text>
        <text x={center} y={center + 43} textAnchor="middle" className="lens-current">
          当前 {section.chords[selectedIndex]}
        </text>
      </svg>

      <div className="lens-notes">
        <span className="eyebrow">HARMONIC LENS</span>
        <h3>把调性当作空间，而不是下拉菜单。</h3>
        <p>
          外环遵循五度关系；内环是当前段落的功能轨迹。点击任意外环调名即可整体移调，罗马数字关系保持不变。
        </p>
        <div className="lens-legend">
          {[
            ["#ff6b78", "主功能"],
            ["#4ed8d0", "前属功能"],
            ["#f4b860", "属功能"],
            ["#b388ff", "色彩功能"]
          ].map(([color, label]) => (
            <span key={label}>
              <i style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
