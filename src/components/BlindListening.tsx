import { useEffect, useRef, useState } from "react";
import type { Arrangement } from "../domain/types";
import {
  createListeningTrial, loadListeningRecords, saveListeningRecord, listeningSummary
} from "../domain/listening";
import type { ListeningTrial, ListeningChoice, ListeningSide } from "../domain/listening";
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
    setHeard([]);
    setNotice("");
    setRecords(loadListeningRecords());
    setTrial(createListeningTrial(arrangement, sectionIndex));
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
    const saved = saveListeningRecord({ trial, choice: value, recordedAt: new Date().toISOString() });
    if (saved) { setRecords(saved); setNotice("选择已保存在本地"); }
    else setNotice("选择已揭示，但浏览器未能保存这条记录");
  }
  function exportRecords() {
    const latest = loadListeningRecords();
    downloadBlob(new Blob([JSON.stringify({ schemaVersion: 1, records: latest }, null, 2)], { type: "application/json" }), "chordflow-listening.json");
  }

  return <div className="blind-entry">
    <button type="button" data-testid="blind-start" onClick={start}>A/B 盲听挑和弦</button>
    <span data-testid="listening-summary">{listeningSummary(records)}</span>
    {records.length > 0 && <button type="button" data-testid="listening-export" onClick={exportRecords}>导出试听记录</button>}
    <dialog className="blind-dialog" ref={dialog} aria-labelledby="blind-title" onCancel={event => { event.preventDefault(); close(); }}>
      {trial && <>
        <div className="riff-heading"><h2 id="blind-title">先听，再选</h2><button type="button" data-testid="blind-close" onClick={close}>关闭</button></div>
        <p>相同音色、速度、拍号和 2 小节长度。A/B 顺序随机，听完两边后再揭示和弦。</p>
        <div className="blind-sides">
          {sides.map(side => <div key={side}>
            <button type="button" data-testid={`blind-play-${side}`} onClick={() => play(side)}>播放 {side}</button>
            <span role="status" data-testid={`blind-state-${side}`}>{playingSide === side ? "播放中…" : heard.includes(side) ? "已听完" : "待试听"}</span>
          </div>)}
        </div>
        {playingSide && <button type="button" onClick={stop}>停止试听</button>}
        {!choice ? <div className="blind-votes" role="group" aria-label="选择更喜欢的和弦">
          {(Object.keys(choiceNames) as ListeningChoice[]).map(value => <button type="button" key={value} data-testid={`blind-vote-${value}`} disabled={heard.length !== 2} onClick={() => vote(value)}>{choiceNames[value]}</button>)}
        </div> : <div className="blind-reveal" data-testid="blind-reveal">
          <p>你的选择：{choiceNames[choice]}</p>
          {sides.map(side => {
            const candidate = trial.candidates[side];
            const section = candidate.arrangement.sections[0];
            return <article key={side}>
              <h3>{side} · {candidate.name}</h3><strong>{section.chords.join(" — ")}</strong>
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
