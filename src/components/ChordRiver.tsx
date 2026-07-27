import { useId } from "react";
import {
  functionColor,
  harmonicFunction,
  romanToChord
} from "../domain/music";
import type { ChordCandidate, Mode, SongSection } from "../domain/types";

interface ChordRiverProps {
  section: SongSection;
  selectedIndex: number;
  mode: Mode;
  tonic: string;
  candidates: ChordCandidate[];
  onSelectChord: (index: number) => void;
  onSelectCandidate: (roman: string) => void;
}

export function ChordRiver({
  section,
  selectedIndex,
  mode,
  tonic,
  candidates,
  onSelectChord,
  onSelectCandidate
}: ChordRiverProps) {
  const gradientId = useId().replaceAll(":", "");
  const count = section.chords.length;
  const startX = 90;
  const endX = 820;
  const xStep = count > 1 ? (endX - startX) / (count - 1) : 0;
  const points = section.chords.map((_, index) => ({
    x: startX + xStep * index,
    y: 145 + Math.sin(index * 1.7) * 24
  }));
  const selected = points[selectedIndex] ?? points[0];
  const branchX = Math.min(860, selected.x + 130);
  const branchY = [260, 320, 380, 430];
  const mainPath = points
    .map((point, index) =>
      index === 0
        ? "M " + point.x + " " + point.y
        : "L " + point.x + " " + point.y
    )
    .join(" ");

  return (
    <div className="river-wrap">
      <svg
        className="chord-river"
        viewBox="0 0 920 470"
        role="img"
        aria-label={section.title + "和弦路径"}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff6b78" />
            <stop offset="48%" stopColor="#4ed8d0" />
            <stop offset="100%" stopColor="#f4b860" />
          </linearGradient>
          <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id="microgrid" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#ffffff" strokeOpacity=".035" />
          </pattern>
        </defs>

        <rect width="920" height="470" fill="url(#microgrid)" />
        <g className="orbit-lines" aria-hidden="true">
          <ellipse cx="455" cy="160" rx="400" ry="90" />
          <ellipse cx="455" cy="160" rx="335" ry="66" />
        </g>

        <path
          d={mainPath}
          className="river-shadow"
          stroke={"url(#" + gradientId + ")"}
        />
        <path
          d={mainPath}
          className="river-path"
          stroke={"url(#" + gradientId + ")"}
        />

        {points.map((point, index) => {
          const harmonicFn = harmonicFunction(section.numerals[index]);
          const color = functionColor(harmonicFn);
          const isActive = index === selectedIndex;
          return (
            <g
              key={section.id + "-" + index}
              className={"river-node " + (isActive ? "active" : "")}
              transform={"translate(" + point.x + " " + point.y + ")"}
              onClick={() => onSelectChord(index)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  onSelectChord(index);
                }
              }}
            >
              <circle
                r={isActive ? 34 : 26}
                fill="#0f1014"
                stroke={color}
                strokeWidth={isActive ? 3 : 1.5}
                filter={isActive ? "url(#softGlow)" : undefined}
              />
              <text className="river-chord" textAnchor="middle" y="-2">
                {section.chords[index]}
              </text>
              <text className="river-roman" textAnchor="middle" y="15">
                {section.numerals[index]}
              </text>
              <text className="river-index" textAnchor="middle" y="51">
                {"0" + (index + 1)}
              </text>
            </g>
          );
        })}

        <g className="branch-label">
          <text x="54" y="286">下一和弦候选</text>
          <line x1="54" x2="176" y1="298" y2="298" />
        </g>

        {candidates.map((candidate, index) => {
          const targetY = branchY[index];
          const chord = romanToChord(tonic, mode, candidate.roman);
          const fn = harmonicFunction(candidate.roman);
          const color = functionColor(fn);
          const barWidth =
            candidate.source === "POP909"
              ? Math.max(18, candidate.weight * 2.8)
              : candidate.weight * 0.62;
          const controlX = selected.x + (branchX - selected.x) * 0.52;
          const path =
            "M " +
            selected.x +
            " " +
            (selected.y + 34) +
            " C " +
            controlX +
            " " +
            (selected.y + 92) +
            ", " +
            controlX +
            " " +
            targetY +
            ", " +
            (branchX - 32) +
            " " +
            targetY;

          return (
            <g
              key={candidate.roman}
              className="candidate-branch"
              onClick={() => onSelectCandidate(candidate.roman)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  onSelectCandidate(candidate.roman);
                }
              }}
            >
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeOpacity={0.22 + candidate.weight / 170}
                strokeWidth={1.4 + candidate.weight / 40}
              />
              <circle
                cx={branchX}
                cy={targetY}
                r="26"
                fill="#101116"
                stroke={color}
                strokeWidth="1.5"
              />
              <text x={branchX} y={targetY - 2} textAnchor="middle" className="candidate-chord">
                {chord}
              </text>
              <text x={branchX} y={targetY + 14} textAnchor="middle" className="candidate-roman">
                {candidate.roman}
              </text>
              <rect
                x={branchX + 39}
                y={targetY - 4}
                width={barWidth}
                height="5"
                rx="3"
                fill={color}
                opacity=".72"
              />
              <text x={branchX + 39} y={targetY - 12} className="candidate-weight">
                {candidate.source === "POP909" ? "条件概率 " : "路径强度 "}
                {candidate.weight}
                {candidate.source === "POP909" ? "%" : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
