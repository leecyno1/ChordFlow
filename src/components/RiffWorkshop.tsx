import { useMemo, useState } from "react";
import { exportMidi, exportReferenceWav } from "../audio/player";
import { DEFAULT_RIFF, RIFF_NAMES, buildRiffNotes } from "../engine/riff";
import { applySectionProgression, parseProgression } from "../engine/progressionInput";
import { assessHarmony, mineProgressions } from "../engine/harmonyMining";
import type { MinedProgression } from "../engine/harmonyMining";
import { quarterNotesPerBar } from "../domain/production";
import type { Arrangement, RiffSettings } from "../domain/types";

interface Props {
  arrangement: Arrangement;
  sectionIndex: number;
  playing: boolean;
  playingBeat: number | null;
  onChange: (arrangement: Arrangement) => void;
  onPreview: (solo: boolean, loop: boolean, preview?: Arrangement) => void;
  onStop: () => void;
}

export function RiffWorkshop({ arrangement, sectionIndex, playing, playingBeat, onChange, onPreview, onStop }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loop, setLoop] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [mined, setMined] = useState<{ source: Arrangement; candidates: MinedProgression[] } | null>(null);
  const section = arrangement.sections[sectionIndex];
  const settings = arrangement.riff ?? DEFAULT_RIFF;
  const excerpt = useMemo(() => ({ ...arrangement, sections: [section] }), [arrangement, section]);
  const notes = useMemo(() => buildRiffNotes(excerpt), [excerpt]);
  const assessment = useMemo(() => assessHarmony(arrangement, sectionIndex), [arrangement, sectionIndex]);
  const beats = quarterNotesPerBar(arrangement.production.timeSignature) * arrangement.production.barsPerSection;
  const minNote = notes.length ? Math.min(...notes.map(note => note.midi)) - 2 : 60;
  const maxNote = notes.length ? Math.max(...notes.map(note => note.midi)) + 2 : 84;
  function update(changes: Partial<RiffSettings>) {
    onChange({ ...arrangement, riff: { ...settings, ...changes } });
  }
  function apply(numerals: string[], label?: string) {
    onChange(applySectionProgression(arrangement, sectionIndex, numerals, label));
    setError("");
  }
  async function downloadWav() {
    setRendering(true);
    setError("");
    try { await exportReferenceWav(excerpt); }
    catch { setError("音频导出失败，请重试或先下载 MIDI"); }
    finally { setRendering(false); }
  }
  return <section className="riff-workshop" aria-label="和弦与 Riff 工坊">
    <div className="riff-heading">
      <div><span className="eyebrow">CHORDS → RIFF</span><h2>把和弦变成一句记得住的乐句</h2>
        <p>当前：{section.title} · {section.chords.join(" — ")}。动机保留，音高跟随和弦。</p></div>
      <button type="button" data-testid="mine-chords" onClick={() => setMined({ source: arrangement, candidates: mineProgressions(arrangement, sectionIndex) })}>挖掘三组和弦</button>
    </div>
    <form className="riff-input" onSubmit={event => {
      event.preventDefault();
      try { apply(parseProgression(input, arrangement.key, arrangement.mode)); }
      catch (cause) { setError((cause as Error).message); }
    }}>
      <label htmlFor="progression-input">写入当前段落</label>
      <input id="progression-input" value={input} onChange={event => setInput(event.target.value)} placeholder="1645 或 C–Am–F–G" />
      <button type="submit">应用和弦</button>
    </form>
    <p className="riff-hint">数字按当前{arrangement.mode === "major" ? "大" : "小"}调音阶配和弦；小调 5 默认为小属和弦，强属请写 V 或 V7。</p>
    {error && <p role="alert" className="riff-error">{error}</p>}
    <details className="riff-assessment">
      <summary>和弦筛选依据 · 连接 {assessment.motion.toFixed(1)} 半音 / 模板差异 {assessment.catalogDistance === null ? "无同长度参考" : `${Math.round(assessment.catalogDistance * 100)}%`}</summary>
      <p>连接：实际转位下，相邻和弦双向最近音平均距离，较小通常更平滑。模板差异：与同长度内置走向的级数差异（包含循环移位）；不是原创率。</p>
      <p>参考粗糙度 {assessment.roughness.toFixed(4)}：用 6 个泛音的假定音色计算干涉，实际音色会改变结果。POP909 已知转移 {assessment.knownTransitions}/{assessment.totalTransitions}，平均惊喜 {assessment.surpriseBits?.toFixed(2) ?? "未知"} bits；未出现不等于优质创新。</p>
      <p>这些是筛选线索，不是好听分数；应结合前后段、风格与听感选择。</p>
    </details>
    {mined?.source === arrangement && <div className="riff-candidates">
      {mined.candidates.map(candidate => <article key={candidate.name}>
        <h3>{candidate.name}</h3><strong>{candidate.chords.join(" — ")}</strong><p>{candidate.description}</p>
        <small>连接 {candidate.assessment.motion.toFixed(1)} 半音 · 模板差异 {Math.round((candidate.assessment.catalogDistance ?? 0) * 100)}%</small>
        <div><button type="button" onClick={() => onPreview(false, false, { ...applySectionProgression(arrangement, sectionIndex, candidate.numerals), riff: undefined })}>试听和弦</button>
          <button type="button" onClick={() => apply(candidate.numerals, candidate.name)}>采用</button></div>
      </article>)}
    </div>}
    {playing && !arrangement.riff && <button type="button" onClick={onStop}>停止试听</button>}
    <div className="riff-styles" role="group" aria-label="Riff 方向">
      {(Object.keys(RIFF_NAMES) as RiffSettings["style"][]).map(style => <button type="button" key={style}
        aria-pressed={Boolean(arrangement.riff && settings.style === style)} onClick={() => update({ style })}>{RIFF_NAMES[style]}</button>)}
      {arrangement.riff && <button type="button" onClick={() => onChange({ ...arrangement, riff: undefined })}>关闭 Riff</button>}
    </div>
    {arrangement.riff && <>
      <div className="riff-controls">
        <label>动机长度<select value={settings.bars} onChange={event => update({ bars: Number(event.target.value) as 1 | 2 })}><option value="1">1 小节</option><option value="2">2 小节</option></select></label>
        <label>疏密<select value={settings.density} onChange={event => update({ density: event.target.value as RiffSettings["density"] })}><option value="sparse">留白</option><option value="full">紧凑</option></select></label>
        <label>音域<select value={settings.register} onChange={event => update({ register: event.target.value as RiffSettings["register"] })}><option value="low">中低</option><option value="high">中高</option></select></label>
        <label>句尾变化<select value={settings.variation} onChange={event => update({ variation: Number(event.target.value) })}><option value="0">保持</option><option value="1">少量</option><option value="2">明显</option></select></label>
        <button type="button" onClick={() => update({ rhythmSeed: settings.rhythmSeed + 1 })}>只换节奏</button>
        <button type="button" onClick={() => update({ pitchSeed: settings.pitchSeed + 1 })}>只换音高</button>
      </div>
      <svg className="riff-grid" viewBox="0 0 960 168" role="img" aria-label={`${section.title} Riff 音符网格，${notes.length} 个音符`}>
        {section.chords.map((chord, index) => <g key={index}><line x1={index * 960 / section.chords.length} x2={index * 960 / section.chords.length} y1="0" y2="168" /><text x={index * 960 / section.chords.length + 8} y="18">{chord}</text></g>)}
        {notes.map((note, index) => <rect key={index} x={note.beat / beats * 960} y={32 + (maxNote - note.midi) / (maxNote - minNote) * 120}
          width={Math.max(2, note.duration / beats * 960)} height="6" rx="2"><title>MIDI {note.midi} · 第 {(note.beat + 1).toFixed(1)} 拍</title></rect>)}
        {playingBeat !== null && <line className="riff-playhead" x1={playingBeat / beats * 960} x2={playingBeat / beats * 960} y1="22" y2="168" />}
      </svg>
      <div className="riff-actions">
        <button type="button" data-testid="riff-solo" onClick={() => onPreview(true, loop)}>Riff 独奏</button>
        <button type="button" data-testid="riff-mix" onClick={() => onPreview(false, loop)}>和弦合听</button>
        {playing && <button type="button" onClick={onStop}>停止</button>}
        <label><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />循环当前段</label>
        <button type="button" data-testid="riff-midi" onClick={() => exportMidi(excerpt, `chordflow-riff-${section.symbol.toLowerCase()}${section.occurrence + 1}.mid`)}>本段 MIDI</button>
        <button type="button" data-testid="riff-wav" disabled={rendering} onClick={() => void downloadWav()}>{rendering ? "生成音频中…" : "本段 WAV"}</button>
      </div>
      <p className="riff-hint">Riff 设置随工程保存、撤销和移调；整曲 MIDI 自动增加 Riff 轨。WAV 是合成音色参考片段，可在 Suno 支持音频上传的入口使用，具体跟随程度需试听。</p>
    </>}
  </section>;
}
