import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  ArrowDownToLine,
  AudioLines,
  ChevronRight,
  CircleDot,
  Download,
  FileJson,
  FolderClock,
  Gauge,
  GitBranch,
  Info,
  Music2,
  Pause,
  Play,
  Redo2,
  RefreshCw,
  Route,
  Save,
  Settings2,
  Sparkles,
  Undo2,
  Upload,
  WandSparkles
} from "lucide-react";
import {
  auditionArrangementChord,
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
import {
  bassAnchorOptions,
  bassOverrideAt,
  setBassOverride
} from "./domain/bass";
import {
  commitArrangementHistory,
  createArrangementHistory,
  mapArrangementHistory,
  redoArrangementHistory,
  undoArrangementHistory
} from "./domain/history";
import {
  effectiveSectionProductionAt,
  normalizeProductionSettings,
  setSectionProductionOverride
} from "./domain/production";
import { buildVoicingPlan } from "./domain/voicing";
import {
  loadLocalProject,
  parseArrangementJson,
  saveLocalProject
} from "./domain/projectStorage";
import { compareArrangements } from "./domain/comparison";
import type {
  Arrangement,
  Mode,
  ProductionSettings,
  SectionProductionOverride
} from "./domain/types";
import {
  generateArrangement,
  getNextCandidates,
  preserveLockedSections,
  regenerateSectionIdentity,
  replaceChord,
  transposeArrangement
} from "./engine/generate";
import {
  applyTransitionSuggestion,
  getTransitionSuggestions
} from "./engine/transitions";

type ViewMode = "river" | "fifths";
type ComparisonSlotId = "A" | "B";

const initialSeed = 18473;
const comparisonSlotIds: ComparisonSlotId[] = ["A", "B"];
const maxProjectImportBytes = 2 * 1024 * 1024;

function formatSavedAt(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function arrangementFingerprint(arrangement: Arrangement): string {
  const { generatedAt: _generatedAt, ...musicalProject } = arrangement;
  return JSON.stringify(musicalProject);
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function App() {
  const [customPattern, setCustomPattern] = useState("");
  const [history, setHistory] = useState(() =>
    createArrangementHistory(
      generateArrangement({
        formId: "ababcb",
        key: "C",
        mode: "major",
        style: "华语流行",
        surprise: 34,
        seed: initialSeed
      })
    )
  );
  const arrangement = history.present;
  const formId = arrangement.formId;
  const keyName = arrangement.key;
  const mode = arrangement.mode;
  const style = arrangement.style;
  const surprise = arrangement.surprise;
  const seed = arrangement.seed;
  const [activeSection, setActiveSection] = useState(0);
  const [activeChord, setActiveChord] = useState(0);
  const [view, setView] = useState<ViewMode>("river");
  const [sunoOpen, setSunoOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playingPosition, setPlayingPosition] = useState<{
    section: number;
    chord: number;
  } | null>(null);
  const [savedProject, setSavedProject] = useState(() => loadLocalProject());
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const [comparisonSlots, setComparisonSlots] = useState<
    Record<ComparisonSlotId, Arrangement | null>
  >({ A: null, B: null });
  const playbackToken = useRef(0);
  const importInputRef = useRef<HTMLInputElement>(null);

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
  const voicingPlan = useMemo(
    () => buildVoicingPlan(arrangement),
    [arrangement]
  );
  const currentVoicing = voicingPlan.sections[activeSection]?.[activeChord];
  const bassOptions = useMemo(
    () => bassAnchorOptions(currentChord, arrangement.key),
    [arrangement.key, currentChord]
  );
  const currentBassOverride = bassOverrideAt(
    arrangement,
    activeSection,
    activeChord
  );
  const transitionSuggestions = useMemo(
    () => getTransitionSuggestions(arrangement, activeSection),
    [arrangement, activeSection]
  );
  const themeCount = new Set(
    arrangement.sections.map((item) => item.symbol)
  ).size;
  const allThemesLocked = arrangement.lockedSymbols.length >= themeCount;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const currentFingerprint = useMemo(
    () => arrangementFingerprint(arrangement),
    [arrangement]
  );
  const currentMatchesLocal = useMemo(
    () =>
      savedProject !== null &&
      arrangementFingerprint(savedProject.arrangement) ===
        currentFingerprint,
    [currentFingerprint, savedProject]
  );
  const arrangementComparison = useMemo(
    () =>
      comparisonSlots.A && comparisonSlots.B
        ? compareArrangements(comparisonSlots.A, comparisonSlots.B)
        : null,
    [comparisonSlots]
  );
  const comparisonSummary = arrangementComparison
    ? arrangementComparison.summary
    : comparisonSlots.A || comparisonSlots.B
      ? "再记录一个方案"
      : "记录两版后比较";
  const projectStatus = projectError
    ? projectError
    : projectNotice
      ? projectNotice
      : savedProject
        ? currentMatchesLocal
          ? `已保存 · ${formatSavedAt(savedProject.savedAt)}`
          : `有未保存更改 · 本地 ${formatSavedAt(savedProject.savedAt)}`
        : "尚未创建本地版本";
  const projectStatusTone = projectError
    ? "error"
    : projectNotice || currentMatchesLocal
      ? "saved"
      : savedProject
        ? "dirty"
        : "empty";

  useEffect(() => {
    setCustomPattern(
      arrangement.formId === "custom" ? arrangement.formPattern : ""
    );
  }, [arrangement.formId, arrangement.formPattern]);

  function commitArrangement(
    update: Arrangement | ((current: Arrangement) => Arrangement)
  ) {
    setProjectError(null);
    setProjectNotice(null);
    setHistory((current) => {
      const next =
        typeof update === "function" ? update(current.present) : update;
      return commitArrangementHistory(current, next);
    });
  }

  function previewArrangement(
    update: (current: Arrangement) => Arrangement
  ) {
    setProjectError(null);
    setProjectNotice(null);
    setHistory((current) => mapArrangementHistory(current, update));
  }

  function resetProjectFocus() {
    playbackToken.current += 1;
    stopPlayback();
    setPlaying(false);
    setPlayingPosition(null);
    setActiveSection(0);
    setActiveChord(0);
  }

  function undo() {
    if (!canUndo) return;
    setProjectError(null);
    setProjectNotice(null);
    setHistory((current) => undoArrangementHistory(current));
    resetProjectFocus();
  }

  function redo() {
    if (!canRedo) return;
    setProjectError(null);
    setProjectNotice(null);
    setHistory((current) => redoArrangementHistory(current));
    resetProjectFocus();
  }

  function saveProject() {
    const saved = saveLocalProject(arrangement);
    if (!saved) {
      setProjectError("浏览器阻止了本地保存");
      return;
    }
    setSavedProject(saved);
    setProjectError(null);
    setProjectNotice(null);
  }

  function restoreProject() {
    const saved = loadLocalProject();
    if (!saved) {
      setSavedProject(null);
      setProjectError("没有可恢复的本地版本");
      return;
    }
    setSavedProject(saved);
    commitArrangement(saved.arrangement);
    resetProjectFocus();
    setProjectNotice("已恢复浏览器本地版本");
  }

  function captureComparisonSlot(slotId: ComparisonSlotId) {
    setComparisonSlots((current) => ({
      ...current,
      [slotId]: arrangement
    }));
    setProjectError(null);
    setProjectNotice(`方案 ${slotId} 已记录`);
  }

  function loadComparisonSlot(slotId: ComparisonSlotId) {
    const snapshot = comparisonSlots[slotId];
    if (!snapshot) {
      setProjectNotice(null);
      setProjectError(`方案 ${slotId} 还是空的`);
      return;
    }
    if (arrangementFingerprint(snapshot) !== currentFingerprint) {
      commitArrangement(snapshot);
      resetProjectFocus();
    }
    setProjectNotice(`已切换到方案 ${slotId}`);
  }

  async function importProject(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const isJsonFile =
      file.type === "application/json" ||
      file.name.toLowerCase().endsWith(".json");
    if (!isJsonFile) {
      setProjectNotice(null);
      setProjectError("请选择 JSON 工程文件");
      return;
    }
    if (file.size > maxProjectImportBytes) {
      setProjectNotice(null);
      setProjectError("JSON 工程不能超过 2 MB");
      return;
    }

    try {
      const imported = parseArrangementJson(await file.text());
      if (!imported) {
        setProjectNotice(null);
        setProjectError("无法识别该 ChordFlow 工程");
        return;
      }
      commitArrangement(imported);
      resetProjectFocus();
      setProjectNotice(`已导入 ${file.name}`);
    } catch {
      setProjectNotice(null);
      setProjectError("读取 JSON 工程失败");
    }
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (isEditableTarget(event.target) || event.altKey) return;
      const command = event.metaKey || event.ctrlKey;
      if (!command) return;
      const key = event.key.toLowerCase();

      if (key === "s") {
        event.preventDefault();
        saveProject();
        return;
      }
      if (key === "z" && event.shiftKey) {
        if (!canRedo) return;
        event.preventDefault();
        redo();
        return;
      }
      if (key === "z") {
        if (!canUndo) return;
        event.preventDefault();
        undo();
        return;
      }
      if (key === "y") {
        if (!canRedo) return;
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [arrangement, canRedo, canUndo]);

  function regenerate(nextSeed = Math.floor(Math.random() * 999999)) {
    const next = generateArrangement({
      formId,
      customPattern: formId === "custom" ? customPattern : undefined,
      key: keyName,
      mode,
      style,
      surprise,
      seed: nextSeed,
      production: arrangement.production
    });
    commitArrangement((current) => preserveLockedSections(current, next));
    setActiveSection(0);
    setActiveChord(0);
  }

  function chooseForm(nextFormId: string) {
    const preset = FORM_PRESETS.find((item) => item.id === nextFormId);
    if (!preset) return;
    setCustomPattern("");
    const nextSeed = seed + 17;
    commitArrangement(
      generateArrangement({
        formId: nextFormId,
        key: keyName,
        mode,
        style,
        surprise,
        seed: nextSeed,
        production: arrangement.production
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
    const nextSeed = seed + 29;
    commitArrangement(
      generateArrangement({
        formId: "custom",
        customPattern: normalized,
        key: keyName,
        mode,
        style,
        surprise,
        seed: nextSeed,
        production: arrangement.production
      })
    );
    setActiveSection(0);
    setActiveChord(0);
  }

  function applyCustomPattern() {
    choosePattern(customPattern);
  }

  function changeKey(nextKey: string) {
    commitArrangement((current) => transposeArrangement(current, nextKey));
  }

  function changeMode(nextMode: Mode) {
    const nextSeed = seed + 11;
    commitArrangement(
      generateArrangement({
        formId,
        customPattern: formId === "custom" ? customPattern : undefined,
        key: keyName,
        mode: nextMode,
        style,
        surprise,
        seed: nextSeed,
        production: arrangement.production
      })
    );
    setActiveSection(0);
    setActiveChord(0);
  }

  function chooseCandidate(roman: string) {
    const targetIndex = Math.min(activeChord + 1, section.numerals.length - 1);
    commitArrangement((current) =>
      replaceChord(current, activeSection, targetIndex, roman)
    );
    setActiveChord(targetIndex);
    void auditionChord(romanToChord(arrangement.key, arrangement.mode, roman));
  }

  function changeStyle(nextStyle: string) {
    commitArrangement((current) => ({ ...current, style: nextStyle }));
  }

  function changeProduction(changes: Partial<ProductionSettings>) {
    commitArrangement((current) => ({
      ...current,
      production: normalizeProductionSettings({
        ...current.production,
        ...changes
      })
    }));
  }

  function changeSectionProduction(
    sectionIndex: number,
    override: SectionProductionOverride | null
  ) {
    commitArrangement((current) =>
      setSectionProductionOverride(current, sectionIndex, override)
    );
  }

  function changeBassAnchor(pitchClass: number | null) {
    const next = setBassOverride(
      arrangement,
      activeSection,
      activeChord,
      pitchClass
    );
    commitArrangement(next);
    void auditionArrangementChord(next, activeSection, activeChord);
  }

  function toggleThemeLock(symbol: string) {
    commitArrangement((current) => ({
      ...current,
      lockedSymbols: current.lockedSymbols.includes(symbol)
        ? current.lockedSymbols.filter((item) => item !== symbol)
        : [...current.lockedSymbols, symbol].sort()
    }));
  }

  function regenerateTheme(symbol: string) {
    const nextSeed = seed + 37 + symbol.charCodeAt(0);
    commitArrangement((current) =>
      regenerateSectionIdentity(current, symbol, nextSeed)
    );
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
            <select
              name="tonic"
              data-testid="tonic-select"
              value={keyName}
              onChange={(event) => changeKey(event.target.value)}
            >
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
            <select
              name="style"
              data-testid="style-select"
              value={style}
              onChange={(event) => changeStyle(event.target.value)}
            >
              {STYLES.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="top-actions">
          <button
            type="button"
            className="icon-button"
            data-testid="export-json"
            onClick={() => exportJson(arrangement)}
            title="导出 JSON"
          >
            <FileJson size={18} />
          </button>
          <button
            type="button"
            className="export-button"
            data-testid="export-midi"
            onClick={() => exportMidi(arrangement)}
          >
            <Download size={16} />
            导出 MIDI
          </button>
          <button
            type="button"
            className="suno-launch"
            data-testid="suno-launch"
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

      <section className="project-strip" aria-label="本地项目与编辑历史">
        <div className="project-strip-status">
          <span className={`project-status-dot ${projectStatusTone}`} />
          <span>LOCAL SESSION</span>
          <strong aria-live="polite" data-testid="project-status">
            {projectStatus}
          </strong>
        </div>
        <div className="project-strip-tools">
          <div className="comparison-deck" aria-label="A/B 方案对比">
            <div className="comparison-readout">
              <span>A/B COMPARE</span>
              <strong aria-live="polite" data-testid="comparison-summary">
                {comparisonSummary}
              </strong>
            </div>
            {comparisonSlotIds.map((slotId) => {
              const snapshot = comparisonSlots[slotId];
              const isCurrent =
                snapshot !== null &&
                arrangementFingerprint(snapshot) === currentFingerprint;
              const slotClass = isCurrent
                ? "current"
                : snapshot
                  ? "filled"
                  : "empty";

              return (
                <div
                  className={`comparison-slot ${slotClass}`}
                  data-testid={`comparison-slot-${slotId}`}
                  data-state={slotClass}
                  key={slotId}
                >
                  <button
                    type="button"
                    className="comparison-slot-load"
                    data-testid={`comparison-load-${slotId}`}
                    onClick={() => loadComparisonSlot(slotId)}
                    disabled={!snapshot}
                    title={snapshot ? `载入方案 ${slotId}` : `方案 ${slotId} 尚未记录`}
                  >
                    <b>{slotId}</b>
                    <span>{isCurrent ? "当前" : snapshot ? "载入" : "空"}</span>
                  </button>
                  <button
                    type="button"
                    className="comparison-slot-capture"
                    data-testid={`comparison-capture-${slotId}`}
                    onClick={() => captureComparisonSlot(slotId)}
                    aria-label={`${snapshot ? "覆盖" : "记录"}方案 ${slotId}`}
                    title={`${snapshot ? "覆盖" : "记录"}方案 ${slotId}`}
                  >
                    {snapshot ? "覆盖" : "记录"}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="project-strip-actions">
            <button
              type="button"
              data-testid="project-undo"
              onClick={undo}
              disabled={!canUndo}
              aria-label="撤销上一步"
              title="撤销（⌘/Ctrl + Z）"
            >
              <Undo2 size={14} />
              <span>撤销</span>
            </button>
            <button
              type="button"
              data-testid="project-redo"
              onClick={redo}
              disabled={!canRedo}
              aria-label="重做下一步"
              title="重做（⌘/Ctrl + Shift + Z）"
            >
              <Redo2 size={14} />
              <span>重做</span>
            </button>
            <button
              type="button"
              data-testid="project-import-trigger"
              onClick={() => importInputRef.current?.click()}
              aria-label="导入 JSON 工程"
              title="导入 ChordFlow JSON 工程（最大 2 MB）"
            >
              <Upload size={14} />
              <span>导入</span>
            </button>
            <button
              type="button"
              data-testid="project-save"
              className={currentMatchesLocal ? "saved" : ""}
              onClick={saveProject}
              aria-label="保存到当前浏览器"
              title="保存到当前浏览器（⌘/Ctrl + S）"
            >
              <Save size={14} />
              <span>{currentMatchesLocal ? "已保存" : "保存"}</span>
            </button>
            <button
              type="button"
              data-testid="project-restore"
              onClick={restoreProject}
              disabled={!savedProject}
              aria-label="恢复浏览器本地版本"
              title="恢复最近保存的本地版本"
            >
              <FolderClock size={14} />
              <span>恢复</span>
            </button>
          </div>
        </div>
        <input
          ref={importInputRef}
          className="project-import-input"
          data-testid="project-import-input"
          type="file"
          accept=".json,application/json"
          onChange={importProject}
          tabIndex={-1}
        />
      </section>

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
            {arrangement.sections.map((item, index) => {
              const sectionProduction = effectiveSectionProductionAt(
                arrangement,
                index
              );
              return (
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
                  <span
                    className={
                      "section-energy " +
                      (sectionProduction.locked ? "locked" : "")
                    }
                    title={sectionProduction.locked ? "逐段制作参数已锁定" : "生成能量"}
                  >
                    {sectionProduction.energy}
                  </span>
                </button>
              );
            })}
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
                onChange={(event) => {
                  const nextSurprise = Number(event.target.value);
                  previewArrangement((current) => ({
                    ...current,
                    surprise: nextSurprise
                  }));
                }}
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
            <button
              type="button"
              className="generate-button"
              onClick={() => regenerate()}
              disabled={allThemesLocked}
              title={allThemesLocked ? "所有主题均已锁定" : "重新生成未锁定主题"}
            >
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
            <strong>{currentVoicing?.displayChord ?? currentChord}</strong>
            <span className="focus-roman">{currentRoman}</span>
            <div className="focus-controls">
              <button
                type="button"
                className="focus-audition"
                onClick={() =>
                  void auditionArrangementChord(
                    arrangement,
                    activeSection,
                    activeChord
                  )
                }
              >
                <AudioLines size={14} />
                试听声部
              </button>
              <div className="focus-bass-control">
                <span>
                  <ArrowDownToLine size={11} />
                  LOWEST NOTE
                  <b>
                    {currentBassOverride === undefined ? "AUTO" : "MANUAL"}
                  </b>
                </span>
                <div className="focus-bass-options" aria-label="低音锚点">
                  <button
                    type="button"
                    className={
                      currentBassOverride === undefined ? "active" : ""
                    }
                    aria-pressed={currentBassOverride === undefined}
                    aria-label="低音锚点 自动"
                    title={`自动声部：${currentVoicing?.bassName ?? "根音"}`}
                    onClick={() => changeBassAnchor(null)}
                  >
                    AUTO
                  </button>
                  {bassOptions.map((option) => (
                    <button
                      type="button"
                      key={option.pitchClass}
                      className={
                        currentBassOverride === option.pitchClass ? "active" : ""
                      }
                      aria-pressed={currentBassOverride === option.pitchClass}
                      aria-label={`低音锚点 ${option.name}`}
                      title={`强制 ${option.name} 为最低音`}
                      onClick={() => changeBassAnchor(option.pitchClass)}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
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
          commitArrangement((current) =>
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
        onToggleLock={toggleThemeLock}
        onRegenerateTheme={regenerateTheme}
      />

      <SunoBridge
        open={sunoOpen}
        arrangement={arrangement}
        onClose={() => setSunoOpen(false)}
        onExportMidi={() => exportMidi(arrangement)}
        onProductionChange={changeProduction}
        onSectionProductionChange={changeSectionProduction}
      />

      <footer className="footer">
        <span>CHORDFLOW / LOCAL-FIRST HARMONIC WORKSTATION</span>
        <span>结构 → 功能 → 和弦 → 声音</span>
      </footer>
    </div>
  );
}

export default App;
