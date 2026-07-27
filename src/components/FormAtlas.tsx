import { ArrowRight, Database, GitBranch, Radio, Sparkles } from "lucide-react";
import {
  getExactStructurePattern,
  getStructureFamily,
  getStructureRole,
  getStructureTransitions,
  HARMONIX_STATS,
  STRUCTURE_ROLE_LABELS
} from "../domain/structureCorpus";
import { formatPercent } from "../domain/corpus";
import type { SectionRole, StructureRole } from "../domain/types";

interface FormAtlasProps {
  pattern: string;
  activeRole: SectionRole;
  onSelectPattern: (pattern: string) => void;
}

const ROLE_ROWS: Array<{
  role: StructureRole;
  color: string;
  code: string;
}> = [
  { role: "verse", color: "#4ed8d0", code: "A" },
  { role: "prechorus", color: "#f4b860", code: "↗" },
  { role: "chorus", color: "#ff6b78", code: "B" },
  { role: "bridge", color: "#b388ff", code: "C" }
];

const LETTER_COLORS: Record<string, string> = {
  A: "#4ed8d0",
  B: "#ff6b78",
  C: "#b388ff",
  D: "#f4b860"
};

function roleColor(role: StructureRole): string {
  return ROLE_ROWS.find((item) => item.role === role)?.color ?? "#9d9a94";
}

export function FormAtlas({
  pattern,
  activeRole,
  onSelectPattern
}: FormAtlasProps) {
  const normalizedPattern = pattern.toUpperCase();
  const exactPattern = getExactStructurePattern(normalizedPattern);
  const familyMatch = getStructureFamily(normalizedPattern);
  const transitions = getStructureTransitions(activeRole as StructureRole).slice(
    0,
    4
  );
  const examples =
    exactPattern?.examples.length
      ? exactPattern.examples
      : familyMatch?.family.examples ?? [];

  return (
    <section className="form-atlas">
      <div className="atlas-heading">
        <div>
          <span className="eyebrow">04 · FORM ATLAS / HARMONIX SET</span>
          <h2>曲式图谱</h2>
          <p>
            把当前骨架放进 912 首西方流行歌曲的结构坐标中，观察它的常见度、段落位置与自然去向。
          </p>
        </div>
        <div className="atlas-source">
          <Database size={15} />
          <span>
            <strong>{HARMONIX_STATS.metadata.songCount} 首 · 结构标注已载入</strong>
            <small>仅用于曲式层，不包含和弦数据</small>
          </span>
          <i />
        </div>
      </div>

      <div className="atlas-grid">
        <article className="atlas-panel atlas-identity">
          <div className="atlas-panel-title">
            <span>FORM IDENTITY</span>
            <Radio size={14} />
          </div>
          <div className="atlas-pattern-label">
            <span>当前信号</span>
            <strong>{normalizedPattern}</strong>
          </div>
          <div className="atlas-sequence" aria-label={`当前曲式 ${normalizedPattern}`}>
            {normalizedPattern.split("").map((letter, index) => (
              <span className="atlas-sequence-step" key={`${letter}-${index}`}>
                {index > 0 ? <i /> : null}
                <b
                  style={
                    {
                      "--letter-color": LETTER_COLORS[letter] ?? "#eeeae2"
                    } as React.CSSProperties
                  }
                >
                  {letter}
                </b>
              </span>
            ))}
          </div>

          <div className="atlas-evidence-pair">
            <div>
              <span>精确结构覆盖</span>
              <strong>
                {exactPattern ? formatPercent(exactPattern.songCoverage) : "样本外"}
              </strong>
              <i>
                <b
                  style={{
                    width: `${Math.min(
                      100,
                      (exactPattern?.songCoverage ?? 0) * 100
                    )}%`
                  }}
                />
              </i>
              <small>{exactPattern?.songCount ?? 0} 首精确匹配</small>
            </div>
            <div>
              <span>最近结构族</span>
              <strong>
                {familyMatch
                  ? `${familyMatch.family.pattern} · ${formatPercent(
                      familyMatch.family.familyCoverage
                    )}`
                  : "—"}
              </strong>
              <i>
                <b
                  style={{
                    width: `${Math.min(
                      100,
                      (familyMatch?.family.familyCoverage ?? 0) * 100
                    )}%`
                  }}
                />
              </i>
              <small>
                当前结构与该预设相似度 {formatPercent(familyMatch?.similarity ?? 0)}
              </small>
            </div>
          </div>

          <div className="atlas-examples">
            <span>语料中的结构参照</span>
            {examples.slice(0, 2).map((example) => (
              <div key={`${example.artist}-${example.title}`}>
                <strong>{example.title}</strong>
                <small>{example.artist || "未知艺人"} · {example.genre}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="atlas-panel atlas-roles">
          <div className="atlas-panel-title">
            <span>SECTION COORDINATES</span>
            <Sparkles size={14} />
          </div>
          <div className="role-axis-head">
            <span>歌曲开头</span>
            <i />
            <span>歌曲结尾</span>
          </div>
          <div className="role-coordinate-list">
            {ROLE_ROWS.map(({ role, color, code }) => {
              const stat = getStructureRole(role);
              if (!stat) return null;
              return (
                <div
                  className="role-coordinate"
                  key={role}
                  style={{ "--role-color": color } as React.CSSProperties}
                >
                  <span className="role-code">{code}</span>
                  <span className="role-name">
                    <strong>{STRUCTURE_ROLE_LABELS[role]}</strong>
                    <small>{formatPercent(stat.songCoverage)} 歌曲包含</small>
                  </span>
                  <span className="role-position">
                    <i />
                    <b style={{ left: `${stat.averageStartPosition * 100}%` }} />
                  </span>
                  <span className="role-time">
                    <strong>{Math.round(stat.averageStartPosition * 100)}%</strong>
                    <small>{stat.averageDurationSeconds.toFixed(1)} 秒</small>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="role-legend">
            <span><b>位置</b> = 平均开始点</span>
            <span><b>秒数</b> = 平均段落时长</span>
          </div>
        </article>

        <article className="atlas-panel atlas-transitions">
          <div className="atlas-panel-title">
            <span>NEXT SECTION SIGNAL</span>
            <GitBranch size={14} />
          </div>
          <div className="transition-origin">
            <span>当前选中段落</span>
            <strong>{STRUCTURE_ROLE_LABELS[activeRole as StructureRole]}</strong>
            <small>基于相邻功能段落的条件概率</small>
          </div>
          <div className="atlas-route-list">
            {transitions.map((transition) => (
              <div
                className="atlas-route"
                key={transition.to}
                style={
                  { "--route-color": roleColor(transition.to) } as React.CSSProperties
                }
              >
                <div>
                  <span>{STRUCTURE_ROLE_LABELS[activeRole as StructureRole]}</span>
                  <ArrowRight size={12} />
                  <strong>{STRUCTURE_ROLE_LABELS[transition.to]}</strong>
                  <b>{formatPercent(transition.probability)}</b>
                </div>
                <i>
                  <b style={{ width: `${transition.probability * 100}%` }} />
                </i>
                <small>{transition.songCount} 首歌曲出现过这条边</small>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="atlas-patterns">
        <div className="atlas-patterns-label">
          <span>TOP FORM SIGNALS</span>
          <small>点击任意结构，立即重建整曲</small>
        </div>
        <div className="atlas-pattern-strip">
          {HARMONIX_STATS.topPatterns.slice(0, 8).map((item, index) => (
            <button
              type="button"
              key={item.pattern}
              className={item.pattern === normalizedPattern ? "active" : ""}
              onClick={() => onSelectPattern(item.pattern)}
              title={item.examples[0]?.title}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.pattern}</strong>
              <small>{formatPercent(item.songCoverage)} · {item.songCount} 首</small>
            </button>
          ))}
        </div>
      </div>

      <div className="atlas-method-note">
        <span>READING NOTE</span>
        <p>
          A / B / C 按主歌、副歌、桥段首次出现的主题身份编码；重复边界保留。结构族采用编辑距离最近预设，且语料归族相似度至少 70%。
        </p>
      </div>
    </section>
  );
}
