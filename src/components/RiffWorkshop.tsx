import { useMemo, useState } from "react";
import { exportMidi, exportReferenceWav } from "../audio/player";
import { DEFAULT_RIFF, RIFF_NAMES, buildRiffExcerpt, riffSettingsAt, setThemeRiff, riffMotifBars, nextRiffVariation } from "../engine/riff";
import { riffVariationLabel } from "../engine/riffMotif";
import { RIFF_ACCENT_NAMES } from "../engine/riffDynamics";
import { RIFF_TONE_FOCUS_NAMES } from "../engine/riffPitch";
import { chordPitchClasses } from "../domain/music";
import { applySectionProgression, parseProgression } from "../engine/progressionInput";
import { assessHarmony, mineProgressions } from "../engine/harmonyMining";
import type { MinedProgression } from "../engine/harmonyMining";
import { quarterNotesPerBar } from "../domain/production";
import type { Arrangement, RiffSettings } from "../domain/types";
import { BlindListening } from "./BlindListening";

interface Props {
  arrangement: Arrangement;
  sectionIndex: number;
  playing: boolean;
  playingBeat: number | null;
  onChange: (arrangement: Arrangement) => void;
  onPreview: (solo: boolean, loop: boolean, preview?: Arrangement, onComplete?: (completed: boolean) => void, matchVoiceLevel?: boolean) => void;
  onStop: () => void;
  onContextPreview: (preview: Arrangement) => void;
}

export function RiffWorkshop({ arrangement, sectionIndex, playing, playingBeat, onChange, onPreview, onStop, onContextPreview }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loop, setLoop] = useState(false);
  const [scope, setScope] = useState<"global" | "theme">("theme");
  const [rendering, setRendering] = useState(false);
  const [wavSolo, setWavSolo] = useState(false);
  const [mined, setMined] = useState<{ source: Arrangement; candidates: MinedProgression[] } | null>(null);
  const section = arrangement.sections[sectionIndex];
  const colorTones = section.chords.map(chord => chordPitchClasses(chord).slice(3));
  const activeSettings = riffSettingsAt(arrangement, sectionIndex);
  const settings = (scope === "theme" ? activeSettings : arrangement.riff) ?? DEFAULT_RIFF;
  const controlsEnabled = scope === "theme" ? activeSettings !== undefined : arrangement.riff !== undefined;
  const { arrangement: excerpt, riffNotes: notes, voicingPlan } = useMemo(() => buildRiffExcerpt(arrangement, sectionIndex), [arrangement, sectionIndex]);
  const assessment = useMemo(() => assessHarmony(arrangement, sectionIndex), [arrangement, sectionIndex]);
  const beats = quarterNotesPerBar(arrangement.production.timeSignature) * arrangement.production.barsPerSection;
  const minNote = notes.length ? Math.min(...notes.map(note => note.midi)) - 2 : 60;
  const maxNote = notes.length ? Math.max(...notes.map(note => note.midi)) + 2 : 84;
  function update(changes: Partial<RiffSettings>) {
    const next = { ...settings, ...changes };
    onChange(scope === "theme" ? setThemeRiff(arrangement, section.symbol, next) : { ...arrangement, riff: next });
  }
  function apply(numerals: string[], label?: string) {
    onChange(applySectionProgression(arrangement, sectionIndex, numerals, label));
    setError("");
  }
  function vary(dimension: "rhythm" | "pitch") {
    const next = nextRiffVariation(arrangement, sectionIndex, settings, dimension);
    if (next === settings) { setError("当前条件下没有不同的动机，请尝试调整疏密或乐句组织"); return; }
    setError("");
    update(next);
  }
  async function downloadWav() {
    setRendering(true);
    setError("");
    try { await exportReferenceWav(excerpt, wavSolo, notes, voicingPlan); }
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
    <p className="riff-hint">数字按当前{arrangement.mode === "major" ? "大" : "小"}调音阶配和弦；小调 5 默认为小属和弦，强属请写 V 或 V7。支持 V7/vi、V9/vi、vii°7/V 等次属目标。</p>
    <p className="riff-hint">九和弦示例：Cmaj9 Am9 Dm9 G9，或 Imaj9 vi9 ii9 V9。maj9 是大七加九音，m9 是小七加九音，9 是属七加九音；add9 不含七音。数字简写 1645 仍按三和弦生成。</p>
    {error && <p role="alert" className="riff-error">{error}</p>}
    <BlindListening arrangement={arrangement} sectionIndex={sectionIndex}
      onPlay={(preview, done) => onPreview(false, false, preview, done, true)}
      onStop={onStop} onApply={numerals => apply(numerals, "盲听选择")} />
    <details className="riff-assessment">
      <summary>和弦筛选依据 · 连接 {assessment.motion.toFixed(1)} 半音 / 模板差异 {assessment.catalogDistance === null ? "无同长度参考" : `${Math.round(assessment.catalogDistance * 100)}%`}</summary>
      <p>连接：实际转位下，相邻和弦双向最近音平均距离，较小通常更平滑。模板差异：与同长度内置走向的级数差异（包含循环移位）；不是原创率。</p>
      <p>参考粗糙度 {assessment.roughness.toFixed(4)}：用 6 个泛音的假定音色计算干涉，实际音色会改变结果。POP909 已知转移 {assessment.knownTransitions}/{assessment.totalTransitions}，平均惊喜 {assessment.surpriseBits?.toFixed(2) ?? "未知"} bits；未出现不等于优质创新。</p>
      <p>这些是筛选线索，不是好听分数；应结合前后段、风格与听感选择。语料转移按基础和弦家族归并，不代表九和弦等扩展色彩的单独使用率。</p>
      <p>前段衔接：{assessment.entryMotion === null ? "曲首" : `${assessment.entryMotion.toFixed(1)} 半音`}；后段衔接：{assessment.exitMotion === null ? "曲尾" : `${assessment.exitMotion.toFixed(1)} 半音`}。{assessment.resolutions.length > 0 && `属功能目标：${assessment.resolutions.join("；")}`}</p>
    </details>
    {mined?.source === arrangement && <div className="riff-candidates">
      {mined.candidates.map(candidate => <article key={candidate.name}>
        <h3>{candidate.name}</h3><strong>{candidate.chords.join(" — ")}</strong><p>{candidate.description}</p>
        <small>连接 {candidate.assessment.motion.toFixed(1)} 半音 · 模板差异 {Math.round((candidate.assessment.catalogDistance ?? 0) * 100)}%</small>
        <p className="mining-context">前段衔接 {candidate.assessment.entryMotion === null ? "曲首" : `${candidate.assessment.entryMotion.toFixed(1)} 半音`} · 后段衔接 {candidate.assessment.exitMotion === null ? "曲尾" : `${candidate.assessment.exitMotion.toFixed(1)} 半音`}</p>
        {candidate.assessment.resolutions.length > 0 && <p>目标连接：{candidate.assessment.resolutions.join("；")}</p>}
        <div><button type="button" onClick={() => onPreview(false, false, { ...applySectionProgression(arrangement, sectionIndex, candidate.numerals), riff: undefined, riffThemes: undefined })}>试听和弦</button>
          {arrangement.sections.length > 1 && <button type="button" data-testid="mining-context-preview" onClick={() => onContextPreview({ ...applySectionProgression(arrangement, sectionIndex, candidate.numerals), riff: undefined, riffThemes: undefined })}>连前后段听</button>}
          <button type="button" onClick={() => apply(candidate.numerals, candidate.name)}>采用</button></div>
      </article>)}
    </div>}
    {playing && !activeSettings && <button type="button" onClick={onStop}>停止试听</button>}
    <div className="riff-controls">
      <label>编辑范围<select data-testid="riff-scope" value={scope} onChange={event => setScope(event.target.value as "global" | "theme")}>
        <option value="theme">{section.symbol} · 同主题段落</option><option value="global">全曲默认</option>
      </select></label>
      <span className="riff-hint">{arrangement.riffThemes?.[section.symbol] === null ? "本主题已静音" : arrangement.riffThemes?.[section.symbol] ? "本主题使用独立动机" : "本主题跟随全曲默认"}</span>
      {scope === "theme" && arrangement.riffThemes?.[section.symbol] !== undefined && <button type="button" data-testid="riff-inherit" onClick={() => onChange(setThemeRiff(arrangement, section.symbol, undefined))}>跟随默认</button>}
    </div>
    <div className="riff-styles" role="group" aria-label="Riff 方向">
      {(Object.keys(RIFF_NAMES) as RiffSettings["style"][]).map(style => <button type="button" key={style}
        data-testid={`riff-style-${style}`} aria-pressed={Boolean(controlsEnabled && settings.style === style)} onClick={() => update({ style })}>{RIFF_NAMES[style]}</button>)}
      {controlsEnabled && <button type="button" data-testid="riff-disable" onClick={() => onChange(scope === "theme" ? setThemeRiff(arrangement, section.symbol, null) : { ...arrangement, riff: undefined })}>{scope === "theme" ? "静音本主题" : "关闭默认 Riff"}</button>}
    </div>
    {controlsEnabled && <>
      <div className="riff-controls">
        <label>乐句组织<select data-testid="riff-phrase" value={settings.phrase ?? "repeat"} onChange={event => update({ phrase: event.target.value as RiffSettings["phrase"], ...(event.target.value === "call-response" ? { bars: 2 } : {}) })}><option value="repeat">循环动机</option><option value="call-response">两小节问答</option></select></label>
        <label>动机长度<select data-testid="riff-bars" value={riffMotifBars(settings)} disabled={settings.phrase === "call-response"} onChange={event => update({ bars: Number(event.target.value) as 1 | 2 })}><option value="1">1 小节</option><option value="2">2 小节</option></select></label>
        <label>疏密<select value={settings.density} onChange={event => update({ density: event.target.value as RiffSettings["density"] })}><option value="sparse">留白</option><option value="full">紧凑</option></select></label>
        <label>音域<select value={settings.register} onChange={event => update({ register: event.target.value as RiffSettings["register"] })}><option value="low">中低</option><option value="high">中高</option></select></label>
        <label>取音重心<select data-testid="riff-tone-focus" value={settings.toneFocus ?? "balanced"} onChange={event => update({ toneFocus: event.target.value as RiffSettings["toneFocus"] })}>
          {Object.entries(RIFF_TONE_FOCUS_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>重音方式<select data-testid="riff-accent" value={settings.accent ?? "original"} onChange={event => update({ accent: event.target.value as RiffSettings["accent"] })}>
          {Object.entries(RIFF_ACCENT_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>句尾变化<select data-testid="riff-tail-variation" disabled={settings.phrase === "call-response"} value={settings.variation} onChange={event => update({ variation: Number(event.target.value) })}><option value="0">保持</option><option value="1">少量</option><option value="2">明显</option></select></label>
        <label>弱拍经过音<select data-testid="riff-ornament" value={settings.ornament ?? "off"} onChange={event => update({ ornament: event.target.value as RiffSettings["ornament"] })}><option value="off">关闭</option><option value="passing">级进连接</option></select></label>
        <label>换和弦连接<select data-testid="riff-connection" value={settings.connection ?? "off"} onChange={event => update({ connection: event.target.value as RiffSettings["connection"] })}><option value="off">原动机</option><option value="anticipate">弱拍预示</option></select></label>
        <label>段间衔接<select data-testid="riff-handoff" value={settings.handoff ?? "off"} onChange={event => update({ handoff: event.target.value as RiffSettings["handoff"] })}><option value="off">保持独立</option><option value="pickup">段尾引入下一段</option></select></label>
        <label>句尾落点<select data-testid="riff-ending" disabled={settings.phrase === "call-response"} value={settings.phrase === "call-response" ? "resolve" : settings.ending ?? "open"} onChange={event => update({ ending: event.target.value as RiffSettings["ending"] })}><option value="open">保留动机</option><option value="resolve">落在末和弦根音</option></select></label>
        <button type="button" data-testid="riff-rhythm-next" onClick={() => vary("rhythm")}>只换节奏</button>
        <button type="button" data-testid="riff-pitch-next" onClick={() => vary("pitch")}>只换音高</button>
      </div>
      <p className="riff-hint" data-testid="riff-variation">{riffVariationLabel(settings)}。换节奏保留音高轮廓设置，换音高保留基础节奏；经过音与预示音会重新计算。旧工程仅在点击对应按钮后启用新变体。</p>
      {settings.phrase === "call-response" && <p className="riff-hint">问句末尾留一个主拍；答句呼应开头，再落到该小节最后一个和弦的根音。6/8 的主拍为附点四分音符。问答模式固定句尾，切回循环后恢复原设置。</p>}
      {settings.connection === "anticipate" && <p className="riff-hint">在可级进的换和弦处，提前半拍提示下一个落音；没有合适空间就保留原句，不填满问句留白，也不改写句尾落点。当前仅连接本段内和弦。</p>}
      {scope === "global" && arrangement.riffThemes?.[section.symbol] !== undefined && <p className="riff-hint">当前主题已有独立设置；修改全曲默认不会覆盖它。下方试听仍使用当前主题的设置。</p>}
    </>}
    {activeSettings && <>
      {activeSettings.toneFocus && activeSettings.toneFocus !== "balanced" && <p className="riff-hint" data-testid="riff-tone-focus-status">
        {RIFF_TONE_FOCUS_NAMES[activeSettings.toneFocus]}：{activeSettings.toneFocus === "core" ? "旋律主体只取和弦的基础三音，挂留和减和弦保留原性质。" : "主拍取骨干，弱拍优先选与前音和动机目标均不超过 5 半音的六、七、九音；没有合适色彩音就回到骨干。"}
        不改和弦或基础节奏；问答与根音收束优先，经过音、预示音和段间引入另行重算。
      </p>}
      {activeSettings.accent && activeSettings.accent !== "original" && <p className="riff-hint" data-testid="riff-accent-status">
        {RIFF_ACCENT_NAMES[activeSettings.accent]}：只调整已有旋律音的力度，不改音高、位置和留白；装饰音保持轻，句尾落点不压弱。6/8 按两个附点四分主拍分组，弱拍推动不自动补音。
      </p>}
      {activeSettings.handoff === "pickup" && <p className="riff-hint" data-testid="riff-handoff-status">
        {notes.some(note => note.kind === "handoff") ? `已在最后一个八分音符引入「${arrangement.sections[sectionIndex + 1].title}」的首音。` : "本段保留原句尾：问答/根音收束优先；曲尾、后段无起拍音、跨度超过全音或已有相同尾音时不加音。"}
        单段试听和导出保留整曲中的衔接；修改后段会重新计算。循环当前段也保留此音，不另接回本段开头。
      </p>}
      <svg className="riff-grid" viewBox="0 0 960 168" role="img" aria-label={`${section.title} Riff 音符网格，${notes.length} 个音符`}>
        {section.chords.map((chord, index) => <g key={index}><line x1={index * 960 / section.chords.length} x2={index * 960 / section.chords.length} y1="0" y2="168" /><text x={index * 960 / section.chords.length + 8} y="18">{chord}</text></g>)}
        {activeSettings.phrase === "call-response" && Array.from({ length: arrangement.production.barsPerSection }, (_, bar) => <text key={bar} className="riff-phrase-label" x={bar * 960 / arrangement.production.barsPerSection + 8} y="35">{bar % 2 === 0 ? "问句" : "答句"}</text>)}
        {notes.map((note, index) => {
          const colorTone = !note.kind && colorTones[note.chordIndex].includes(note.midi % 12);
          return <rect key={index} data-color-tone={colorTone || undefined} data-phrase={note.phrase} data-velocity={Math.floor(note.velocity * 127)} fillOpacity={0.35 + note.velocity * 0.65} className={note.kind ? `riff-${note.kind}` : undefined} x={note.beat / beats * 960} y={46 + (maxNote - note.midi) / (maxNote - minNote) * 104}
            width={Math.max(2, note.duration / beats * 960)} height="6" rx="2"><title>MIDI {note.midi} · 第 {(note.beat + 1).toFixed(1)} 拍 · 力度 {Math.floor(note.velocity * 127)}/127{colorTone ? " · 和弦色彩音" : ""}{note.kind === "handoff" ? " · 下一段引入音" : ""}</title></rect>;
        })}
        {playingBeat !== null && <line className="riff-playhead" x1={playingBeat / beats * 960} x2={playingBeat / beats * 960} y1="22" y2="168" />}
      </svg>
      <p className="riff-hint">青色为和弦音，描边标出主体中的六、七、九音；金色为经过音，紫色为段内预示音，橙色为下一段引入音，粉色为句尾落点。越亮力度越大，悬停可查看数值；修饰只在条件合适时出现。</p>
      <div className="riff-actions">
        <button type="button" data-testid="riff-solo" onClick={() => onPreview(true, loop)}>Riff 独奏</button>
        <button type="button" data-testid="riff-mix" onClick={() => onPreview(false, loop)}>和弦合听</button>
        {arrangement.sections.length > 1 && <button type="button" data-testid="riff-context" onClick={() => onContextPreview(arrangement)}>连前后段听 Riff</button>}
        {playing && <button type="button" onClick={onStop}>停止</button>}
        <label><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />循环当前段</label>
        <button type="button" data-testid="riff-midi" onClick={() => exportMidi(excerpt, `chordflow-riff-${section.symbol.toLowerCase()}${section.occurrence + 1}.mid`, notes, voicingPlan)}>本段 MIDI</button>
        <label>音频内容<select data-testid="riff-wav-scope" value={wavSolo ? "solo" : "mix"} onChange={event => setWavSolo(event.target.value === "solo")}><option value="mix">和弦 + Riff</option><option value="solo">纯 Riff</option></select></label>
        <button type="button" data-testid="riff-wav" disabled={rendering} onClick={() => void downloadWav()}>{rendering ? "生成音频中…" : "本段 WAV"}</button>
      </div>
      <p className="riff-hint">本段合听、MIDI 和 WAV 保留整曲中的和弦转位、低音与 Riff；修改前后段会重新计算，循环不另接回段首。Riff 设置随工程保存、撤销和移调；整曲 MIDI 自动增加 Riff 轨。WAV 是合成音色参考片段，可在 Suno 支持音频上传的入口使用，具体跟随程度需试听。</p>
    </>}
  </section>;
}
