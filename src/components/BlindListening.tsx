import { useEffect, useRef, useState } from "react";
import type { Arrangement } from "../domain/types";
import {
  createListeningTrial, loadListeningRecords, saveListeningRecord, listeningSummary, templateComparisonSummary, LISTENING_REASONS
} from "../domain/listening";
import type { ListeningTrial, ListeningChoice, ListeningSide, ListeningExperiment, ListeningReason } from "../domain/listening";
import { downloadBlob } from "../audio/player";

interface Props {
  arrangement: Arrangement;
  sectionIndex: number;
  onPlay: (preview: Arrangement, onComplete: (completed: boolean) => void) => void;
  onStop: () => void;
  onApply: (numerals: string[]) => void;
}

const sides: ListeningSide[] = ["A", "B"];
const choiceNames: Record<ListeningChoice, string> = { A: "更喜欢 A", B: "更喜欢 B", tie: "差不多", neither: "都不喜欢" };

export function BlindListening({ arrangement, sectionIndex, onPlay, onStop, onApply }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const run = useRef(0);
  const voted = useRef(false);
  const [trial, setTrial] = useState<ListeningTrial | null>(null);
  const [heard, setHeard] = useState<ListeningSide[]>([]);
  const [playingSide, setPlayingSide] = useState<ListeningSide | null>(null);
  const [choice, setChoice] = useState<ListeningChoice | null>(null);
  const [records, setRecords] = useState(loadListeningRecords);
  const [notice, setNotice] = useState("");
  const [experiment, setExperiment] = useState<ListeningExperiment>("template-control");
  const [reason, setReason] = useState<ListeningReason | "">("");

  function stop() {
    run.current++;
    onStop();
    setPlayingSide(null);
  }
  function close() {
    stop();
    setTrial(null);
  }
  useEffect(() => { close(); }, [arrangement]);
  useEffect(() => {
    if (trial) dialog.current?.showModal(); else dialog.current?.close();
  }, [Boolean(trial)]);
  useEffect(() => () => { run.current++; onStop(); }, []);

  function start() {
    stop();
    voted.current = false;
    setChoice(null);
    setReason("");
    setHeard([]);
    setNotice("");
    setRecords(loadListeningRecords());
    try { setTrial(createListeningTrial(arrangement, sectionIndex, Math.random, experiment)); }
    catch (error) { setNotice((error as Error).message); }
  }
  function play(side: ListeningSide) {
    if (!trial) return;
    stop();
    setPlayingSide(side);
    const token = run.current;
    onPlay(trial.candidates[side].arrangement, completed => {
      if (run.current !== token) return;
      setPlayingSide(null);
      if (completed) setHeard(current => current.includes(side) ? current : [...current, side]);
      else setNotice("试听未完成，请重新播放");
    });
  }
  function vote(value: ListeningChoice) {
    if (!trial || heard.length !== 2 || voted.current) return;
    voted.current = true;
    stop();
    setChoice(value);
    const saved = saveListeningRecord({ trial, choice: value, recordedAt: new Date().toISOString(), ...(reason ? { reason } : {}) });
    if (saved) { setRecords(saved); setNotice("选择已保存在本地"); }
    else setNotice("选择已揭示，但浏览器未能保存这条记录");
  }
  function exportRecords() {
    const latest = loadListeningRecords();
    downloadBlob(new Blob([JSON.stringify({ schemaVersion: 1, records: latest }, null, 2)], { type: "application/json" }), "chordflow-listening.json");
  }

  return <div className="blind-entry">
    <label>比较方式 <select data-testid="blind-experiment" value={experiment} onChange={event => setExperiment(event.target.value as ListeningExperiment)}><option value="template-control">挖掘 vs 模板</option><option value="mined-pair">候选互选</option></select></label>
    <button type="button" data-testid="blind-start" onClick={start}>A/B 盲听挑和弦</button>
    <span data-testid="listening-summary">{listeningSummary(records)}</span>
    <small data-testid="template-summary">{templateComparisonSummary(records)}。重复试听计次数，不代表独立样本；尚不能证明算法更好听。</small>
    {!trial && notice && <span role="status">{notice}</span>}
    {records.length > 0 && <button type="button" data-testid="listening-export" onClick={exportRecords}>导出试听记录</button>}
    <dialog className="blind-dialog" ref={dialog} aria-labelledby="blind-title" onCancel={event => { event.preventDefault(); close(); }}>
      {trial && <>
        <div className="riff-heading"><h2 id="blind-title">先听，再选</h2><button type="button" data-testid="blind-close" onClick={close}>关闭</button></div>
        <p>相同音色、速度、拍号和 2 小节长度，两边均以主和弦收束。{trial.experiment === "template-control" ? "一边为挖掘结果，一边为内置高熟悉度模板的循环移位。" : "比较两组挖掘候选。"}A/B 顺序随机，选择后再揭示来源与和弦。</p>
        <div className="blind-sides">
          {sides.map(side => <div key={side}>
            <button type="button" data-testid={`blind-play-${side}`} onClick={() => play(side)}>播放 {side}</button>
            <span role="status" data-testid={`blind-state-${side}`}>{playingSide === side ? "播放中…" : heard.includes(side) ? "已听完" : "待试听"}</span>
          </div>)}
        </div>
        {playingSide && <button type="button" onClick={stop}>停止试听</button>}
        {!choice && <label>主要判断依据（可选） <select data-testid="blind-reason" value={reason} disabled={heard.length !== 2} onChange={event => setReason(event.target.value as ListeningReason | "")}>
          <option value="">不填写</option>{Object.entries(LISTENING_REASONS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select></label>}
        {!choice ? <div className="blind-votes" role="group" aria-label="选择更喜欢的和弦">
          {(Object.keys(choiceNames) as ListeningChoice[]).map(value => <button type="button" key={value} data-testid={`blind-vote-${value}`} disabled={heard.length !== 2} onClick={() => vote(value)}>{choiceNames[value]}</button>)}
        </div> : <div className="blind-reveal" data-testid="blind-reveal">
          <p>你的选择：{choiceNames[choice]}</p>
          {reason && <p>判断依据：{LISTENING_REASONS[reason]}</p>}
          {sides.map(side => {
            const candidate = trial.candidates[side];
            const section = candidate.arrangement.sections[0];
            return <article key={side}>
              <h3>{side} · {candidate.name}</h3><p data-testid="blind-source">{candidate.source === "template" ? "来源：内置模板" : "来源：挖掘结果"}</p><strong>{section.chords.join(" — ")}</strong>
              <p>连接 {candidate.assessment.motion.toFixed(1)} 半音 · 参考粗糙度 {candidate.assessment.roughness.toFixed(4)}</p>
              <button type="button" data-testid={`blind-apply-${side}`} onClick={() => { close(); onApply(section.numerals); }}>采用 {side} 的和弦</button>
            </article>;
          })}
          <button type="button" onClick={start}>再听一组</button>
        </div>}
        <p role="status">{notice}</p>
        <p className="riff-hint">只比较和弦，暂不加入 Riff。按发声音数补偿基础力度，不等于严格感知响度匹配。最多保留最近 200 次；只记录选择，尚不自动学习或改变推荐。</p>
      </>}
    </dialog>
  </div>;
}
