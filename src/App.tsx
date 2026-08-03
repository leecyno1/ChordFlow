import { useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ChevronRight,
  CircleDot,
  Download,
  FileJson,
  Gauge,
  GitBranch,
  Info,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Route,
  Settings2,
  Sparkles,
  WandSparkles
} from "lucide-react";
import {
  auditionChord,
  auditionProgression,
  exportJson,
  exportMidi,
  playArrangement,
  stopPlayback
} from "./audio/player";
import { ArrangementTimeline } from "./components/ArrangementTimeline";
import { ChordRiver } from "./components/ChordRiver";
import { FifthsLens } from "./components/FifthsLens";
import { FormAtlas } from "./components/FormAtlas";
import { SunoBridge } from "./components/SunoBridge";
import { TransitionWorkshop } from "./components/TransitionWorkshop";
import {
  FORM_PRESETS,
  PROGRESSIONS,
  ROLE_META,
  STYLES
} from "./domain/catalog";
import {
  formatPercent,
  getChordCorpusStat,
  getProgressionCorpusStat,
  POP909_STATS
} from "./domain/corpus";
import { getStructureFamily } from "./domain/structureCorpus";
import {
  DISPLAY_KEYS,
  functionColor,
  functionLabel,
  harmonicFunction,
  romanToChord
} from "./domain/music";
import type { Mode } from "./domain/types";
import {
  generateArrangement,
  getNextCandidates,
  replaceChord,
  transposeArrangement
} from "./engine/generate";
import {
  applyTransitionSuggestion,
  getTransitionSuggestions
} from "./engine/transitions";

type ViewMode = "river" | "fifths";

const initialSeed = 18473;

function App() {
  const [formId, setFormId] = useState("ababcb");
  const [customPattern, setCustomPattern] = useState("");
  const [keyName, setKeyName] = useState("C");
  const [mode, setMode] = useState<Mode>("major");
  const [style, setStyle] = useState("华语流行");
  const [surprise, setSurprise] = useState(34);
  const [seed, setSeed] = useState(initialSeed);
  const [arrangement, setArrangement] = useState(() =>
    generateArrangement({
      formId: "ababcb",
      key: "C",
      mode: "major",
      style: "华语流行",
      surprise: 34,
      seed: initialSeed
    })
  );
  const [activeSection, setActiveSection] = useState(0);
  const [activeChord, setActiveChord] = useState(0);
  const [view, setView] = useState<ViewMode>("river");
  const [sunoOpen, setSunoOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playingPosition, setPlayingPosition] = useState<{
    section: number;
    chord: number;
  } | null>(null);
  const playbackToken = useRef(0);

  const section = arrangement.sections[activeSection] ?? arrangement.sections[0];
  const currentRoman = section?.numerals[activeChord] ?? "I";
  const currentChord = section?.chords[activeChord] ?? keyName;
  const harmonicFn = harmonicFunction(currentRoman);
  const candidates = useMemo(
    () => getNextCandidates(currentRoman, arrangement.mode),
    [currentRoman, arrangement.mode]
  );
  const template = PROGRESSIONS.find((item) => item.id === section?.templateId);
  const progressionCorpusStat = getProgressionCorpusStat(template?.id);
  const chordCorpusStat = getChordCorpusStat(currentRoman);
  const transitionSuggestions = useMemo(
    () => getTransitionSuggestions(arrangement, activeSection),
    [arrangement, activeSection]
  );

  function regenerate(nextSeed = Math.floor(Math.random() * 999999)) {
    const next = generateArrangement({
      formId,
      customPattern: formId === "custom" ? customPattern : undefined,
      key: keyName,
      mode,
      style,
      surprise,
      seed: nextSeed
    });
    setSeed(nextSeed);
    setArrangement(next);
    setActiveSection(0);
    setActiveChord(0);
  }

  function chooseForm(nextFormId: string) {
    const preset = FORM_PRESETS.find((item) => item.id === nextFormId);
    if (!preset) return;
    setFormId(nextFormId);
    setCustomPattern("");
    const nextSeed = seed + 17;
    setSeed(nextSeed);
    setArrangement(
      generateArrangement({
        formId: nextFormId,
        key: keyName,
        mode,
        style,
        surprise,
        seed: nextSeed
      })
    );
    setActiveSection(0);
    setActiveChord(0);
  }

  function choosePattern(nextPattern: string) {
    const normalized = nextPattern.toUpperCase().replace(/[^A-D]/g, "").slice(0, 9);
    if (normalized.length < 2) return;
    const preset = FORM_PRESETS.find((item) => item.pattern === normalized);
    if (preset) {
      chooseForm(preset.id);
      return;
    }
    setCustomPattern(normalized);
    setFormId("custom");
    const nextSeed = seed + 29;
    setSeed(nextSeed);
    setArrangement(
      generateArrangement({
        formId: "custom",
        customPattern: normalized,
        key: keyName,
        mode,
        style,
        surprise,
        seed: nextSeed
      })
    );
    setActiveSection(0);
    setActiveChord(0);
  }

  function applyCustomPattern() {
    choosePattern(customPattern);
  }

  function changeKey(nextKey: string) {
    setKeyName(nextKey);
    setArrangement((current) => transposeArrangement(current, nextKey));
  }

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    const nextSeed = seed + 11;
    setSeed(nextSeed);
    setArrangement(
      generateArrangement({
        formId,
        customPattern: formId === "custom" ? customPattern : undefined,
        key: keyName,
        mode: nextMode,
        style,
        surprise,
        seed: nextSeed
      })
    );
    setActiveSection(0);
    setActiveChord(0);
  }

  function chooseCandidate(roman: string) {
    const targetIndex = Math.min(activeChord + 1, section.numerals.length - 1);
    setArrangement((current) =>
      replaceChord(current, activeSection, targetIndex, roman)
    );
    setActiveChord(targetIndex);
    void auditionChord(romanToChord(arrangement.key, arrangement.mode, roman));
  }

  async function togglePlayback() {
    if (playing) {
      playbackToken.current += 1;
      stopPlayback();
      setPlaying(false);
      setPlayingPosition(null);
      return;
    }
    const token = playbackToken.current + 1;
    playbackToken.current = token;
    setPlaying(true);
    const duration = await playArrangement(arrangement, (sectionIndex, chordIndex) => {
      if (playbackToken.current !== token) return;
      setPlayingPosition({ section: sectionIndex, chord: chordIndex });
    });
    window.setTimeout(() => {
      if (playbackToken.current === token) {
        setPlaying(false);
        setPlayingPosition(null);
      }
    }, duration + 300);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>ChordFlow</strong>
            <small>HARMONIC COMPOSITION SYSTEM</small>
          </div>
        </div>

        <div className="global-controls">
          <label>
            <span>调性</span>
            <select name="tonic" value={keyName} onChange={(event) => changeKey(event.target.value)}>
              {DISPLAY_KEYS.map((key) => (
                <option value={key} key={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" aria-label="调式">
            <button
              type="button"
              className={mode === "major" ? "active" : ""}
              onClick={() => changeMode("major")}
            >
              大调
            </button>
            <button
              type="button"
              className={mode === "minor" ? "active" : ""}
              onClick={() => changeMode("minor")}
            >
              小调
            </button>
          </div>
          <label className="style-select">
            <span>语境</span>
            <select name="style" value={style} onChange={(event) => setStyle(event.target.value)}>
              {STYLES.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="top-actions">
          <button type="button" className="icon-button" onClick={() => exportJson(arrangement)} title="导出 JSON">
            <FileJson size={18} />
          </button>
          <button type="button" className="export-button" onClick={() => exportMidi(arrangement)}>
            <Download size={16} />
            导出 MIDI
          </button>
          <button
            type="button"
            className="suno-launch"
            onClick={() => setSunoOpen(true)}
          >
            <WandSparkles size={16} />
            Suno Kit
          </button>
          <button type="button" className="play-button" onClick={togglePlayback}>
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            {playing ? "停止" : "播放整曲"}
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-rail">
          <div className="rail-header">
            <span className="eyebrow">01 · FORM</span>
            <h2>曲式骨架</h2>
            <p>相同字母共享主题身份，再现时保留骨架并改变结尾。</p>
          </div>

          <div className="form-list">
            {FORM_PRESETS.map((preset) => (
              <button
                type="button"
                className={"form-card " + (formId === preset.id ? "active" : "")}
                key={preset.id}
                onClick={() => chooseForm(preset.id)}
              >
                <span className="form-pattern">
                  <b>{preset.pattern}</b>
                  <small>
                    {formatPercent(
                      getStructureFamily(preset.pattern)?.family.familyCoverage ?? 0,
                      0
                    )} 结构族
                  </small>
                </span>
                <span>
                  <strong>{preset.name}</strong>
                  <small>{preset.description}</small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>

          <div className="custom-form">
            <label htmlFor="custom-pattern">自定义结构</label>
            <div>
              <input
                id="custom-pattern"
                value={customPattern}
                onChange={(event) => setCustomPattern(event.target.value.toUpperCase())}
                placeholder="如 ABACABA"
                maxLength={9}
              />
              <button type="button" onClick={applyCustomPattern}>
                应用
              </button>
            </div>
          </div>

          <div className="section-stack">
            <span className="eyebrow">SECTION ROLES</span>
            {arrangement.sections.map((item, index) => (
              <button
                type="button"
                key={item.id}
                className={"section-row " + (activeSection === index ? "active" : "")}
                onClick={() => {
                  setActiveSection(index);
                  setActiveChord(0);
                }}
              >
                <span className="section-letter">{item.symbol}</span>
                <span className="section-copy">
                  <strong>{item.title}</strong>
                  <small>{ROLE_META[item.role].description}</small>
                </span>
                <span className="section-energy">{item.energy}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="main-stage">
          <div className="stage-header">
            <div>
              <span className="eyebrow">02 · HARMONIC OBSERVATORY</span>
              <div className="stage-title-row">
                <h1>{section.title}的和声轨道</h1>
                <span className="seed-badge">SEED {seed}</span>
              </div>
              <p>
                {template?.nameZh || "自定义进行"} · {template?.nameEn || "Edited path"}
                {section.variationLabel ? " · " + section.variationLabel : ""}
              </p>
            </div>
            <div className="view-switch">
              <button type="button" className={view === "river" ? "active" : ""} onClick={() => setView("river")}>
                <GitBranch size={15} />
                和弦河流
              </button>
              <button type="button" className={view === "fifths" ? "active" : ""} onClick={() => setView("fifths")}>
                <CircleDot size={15} />
                五度圈透镜
              </button>
            </div>
          </div>

          <div className="visual-stage">
            <div className="visual-meta top-left">
              <span>TONAL CENTER</span>
              <strong>{arrangement.key} {arrangement.mode === "major" ? "MAJOR" : "MINOR"}</strong>
            </div>
            <div className="visual-meta top-right">
              <span>PATH IDENTITY</span>
              <strong>{section.symbol} / {section.templateId.toUpperCase()}</strong>
            </div>
            {view === "river" ? (
              <ChordRiver
                section={section}
                selectedIndex={activeChord}
                mode={arrangement.mode}
                tonic={arrangement.key}
                candidates={candidates}
                onSelectChord={(index) => {
                  setActiveChord(index);
                  void auditionChord(section.chords[index]);
                }}
                onSelectCandidate={chooseCandidate}
              />
            ) : (
              <FifthsLens
                tonic={arrangement.key}
                section={section}
                selectedIndex={activeChord}
                onSelectKey={changeKey}
              />
            )}
          </div>

          <div className="generation-console">
            <div className="surprise-control">
              <div className="control-heading">
                <span>
                  <Gauge size={16} />
                  熟悉度 / 惊喜度
                </span>
                <strong>{surprise}</strong>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={surprise}
                onChange={(event) => setSurprise(Number(event.target.value))}
                style={{ "--range-value": surprise + "%" } as React.CSSProperties}
              />
              <div className="range-labels">
                <span>经典稳定</span>
                <span>新鲜意外</span>
              </div>
            </div>
            <div className="console-insight">
              <Sparkles size={18} />
              <div>
                <strong>结构约束已启用</strong>
                <span>A 段会保留主题身份，B/C 段优先制造能量和色彩差异。</span>
              </div>
            </div>
            <button type="button" className="generate-button" onClick={() => regenerate()}>
              <RefreshCw size={16} />
              重新编织
            </button>
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-heading">
            <span className="eyebrow">03 · INSPECTOR</span>
            <Settings2 size={17} />
          </div>

          <section className="chord-focus" style={{ "--focus-color": functionColor(harmonicFn) } as React.CSSProperties}>
            <div className="focus-orbit" />
            <span className="focus-function">{functionLabel(harmonicFn)}</span>
            <strong>{currentChord}</strong>
            <span className="focus-roman">{currentRoman}</span>
            <button type="button" onClick={() => void auditionChord(currentChord)}>
              <AudioLines size={15} />
              单独试听
            </button>
          </section>

          <section className="inspector-card progression-story">
            <span className="card-kicker">进行档案</span>
            <h3>{template?.nameZh || "手动改写进行"}</h3>
            <p>{template?.description || "你已经改变了原始路径。系统仍会根据当前功能继续推荐可行去向。"}</p>
            <div className="tag-row">
              {(template?.moods || ["自定义", "可编辑"]).slice(0, 3).map((mood) => (
                <span key={mood}>{mood}</span>
              ))}
            </div>
          </section>

          <section className="inspector-card stats-card">
            <div className="card-title">
              <span>
                <Route size={15} />
                POP909 实证统计
              </span>
              <Info size={14} />
            </div>
            <div className="metric">
              <div>
                <span>精确走向歌曲覆盖</span>
                <strong>
                  {formatPercent(progressionCorpusStat?.songCoverage ?? 0)}
                </strong>
              </div>
              <div className="metric-track">
                <i
                  style={{
                    width:
                      Math.min(
                        100,
                        (progressionCorpusStat?.songCoverage ?? 0) * 100
                      ) + "%"
                  }}
                />
              </div>
            </div>
            <div className="metric corpus-chord">
              <div>
                <span>当前级数歌曲覆盖</span>
                <strong>{formatPercent(chordCorpusStat?.songCoverage ?? 0)}</strong>
              </div>
              <div className="metric-track">
                <i
                  style={{
                    width:
                      Math.min(100, (chordCorpusStat?.songCoverage ?? 0) * 100) +
                      "%"
                  }}
                />
              </div>
            </div>
            <div className="corpus-facts">
              <span>
                <b>{progressionCorpusStat?.songCount ?? 0}</b> 首包含完整走向
              </span>
              <span>
                <b>{progressionCorpusStat?.occurrenceCount ?? 0}</b> 次精确匹配
              </span>
              <span>
                编辑俗套风险 <b>{template?.clicheRisk ?? 30}</b>
              </span>
            </div>
            <div className="provenance-note">
              <Info size={13} />
              <span>
                909 首华语流行编配；相邻重复已折叠，严格连续匹配。不是全球使用率。
              </span>
            </div>
          </section>

          <section className="inspector-card next-list">
            <div className="card-title">
              <span>
                <WandSparkles size={15} />
                下一步建议
              </span>
              <small>替换下一个和弦</small>
            </div>
            {candidates.map((candidate) => {
              const chord = romanToChord(arrangement.key, arrangement.mode, candidate.roman);
              const color = functionColor(harmonicFunction(candidate.roman));
              return (
                <button type="button" key={candidate.roman} onClick={() => chooseCandidate(candidate.roman)}>
                  <span className="candidate-dot" style={{ background: color }} />
                  <span className="candidate-copy">
                    <strong>{chord} <small>{candidate.roman}</small></strong>
                    <span>{candidate.reason}</span>
                    <i>
                      <b style={{ width: candidate.weight + "%", background: color }} />
                    </i>
                  </span>
                  <span className="candidate-score">
                    {candidate.weight}
                    {candidate.source === "POP909" ? "%" : ""}
                  </span>
                </button>
              );
            })}
          </section>

          <section className="corpus-status">
            <Music2 size={16} />
            <div>
              <strong>POP909 · 已载入</strong>
              <span>
                {POP909_STATS.metadata.songCount} 首 ·{" "}
                {POP909_STATS.metadata.collapsedChordEventCount.toLocaleString()} 事件
              </span>
            </div>
            <span className="status-dot ready" />
          </section>
        </aside>
      </main>

      <FormAtlas
        pattern={arrangement.formPattern}
        activeRole={section.role}
        onSelectPattern={choosePattern}
      />

      <TransitionWorkshop
        arrangement={arrangement}
        activeSection={activeSection}
        suggestions={transitionSuggestions}
        onPreview={(suggestion) =>
          void auditionProgression(suggestion.previewChords)
        }
        onApply={(suggestion) =>
          setArrangement((current) =>
            applyTransitionSuggestion(current, activeSection, suggestion)
          )
        }
      />

      <ArrangementTimeline
        arrangement={arrangement}
        activeSection={activeSection}
        activeChord={activeChord}
        playingPosition={playingPosition}
        onSelect={(sectionIndex, chordIndex) => {
          setActiveSection(sectionIndex);
          setActiveChord(chordIndex);
          void auditionChord(arrangement.sections[sectionIndex].chords[chordIndex]);
        }}
      />

      <SunoBridge
        open={sunoOpen}
        arrangement={arrangement}
        onClose={() => setSunoOpen(false)}
        onExportMidi={() => exportMidi(arrangement)}
      />

      <footer className="footer">
        <span>CHORDFLOW / LOCAL-FIRST HARMONIC WORKSTATION</span>
        <span>结构 → 功能 → 和弦 → 声音</span>
      </footer>
    </div>
  );
}

export default App;
