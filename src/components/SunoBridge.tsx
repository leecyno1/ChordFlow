import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock3, Copy, Download, Music2, X } from "lucide-react";
import {
  buildSunoPromptKit,
  serializeSunoPromptKit
} from "../domain/suno";
import {
  SECTION_BAR_OPTIONS,
  TIME_SIGNATURES,
  VOICING_PROFILES
} from "../domain/production";
import type {
  Arrangement,
  ProductionSettings
} from "../domain/types";

interface SunoBridgeProps {
  open: boolean;
  arrangement: Arrangement;
  onClose: () => void;
  onExportMidi: () => void;
  onProductionChange: (changes: Partial<ProductionSettings>) => void;
}

type CopyTarget = "style" | "blueprint" | "all";
type PromptLanguage = "en" | "zh";

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Clipboard write timed out")),
          280
        );
        navigator.clipboard.writeText(value).then(
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          (error) => {
            window.clearTimeout(timeout);
            reject(error);
          }
        );
      });
      return;
    } catch {
      // Some embedded browsers expose Clipboard API but deny or stall writes.
      // Fall through to the local textarea copy path in that case.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function downloadText(content: string, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SunoBridge({
  open,
  arrangement,
  onClose,
  onExportMidi,
  onProductionChange
}: SunoBridgeProps) {
  const kit = useMemo(() => buildSunoPromptKit(arrangement), [arrangement]);
  const [language, setLanguage] = useState<PromptLanguage>("en");
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [tempoDraft, setTempoDraft] = useState(
    String(arrangement.production.tempoBpm)
  );
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    setTempoDraft(String(arrangement.production.tempoBpm));
  }, [arrangement.production.tempoBpm]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    []
  );

  if (!open) return null;

  const stylePrompt =
    language === "en" ? kit.stylePromptEn : kit.stylePromptZh;

  function commitTempo() {
    const nextTempo = Number(tempoDraft);
    if (Number.isFinite(nextTempo)) {
      onProductionChange({ tempoBpm: nextTempo });
    } else {
      setTempoDraft(String(arrangement.production.tempoBpm));
    }
  }

  async function handleCopy(target: CopyTarget, value: string) {
    await copyText(value);
    setCopied(target);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div
      className="suno-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="suno-bridge"
        role="dialog"
        aria-modal="true"
        aria-labelledby="suno-bridge-title"
      >
        <header className="suno-bridge-head">
          <div>
            <span className="eyebrow">SUNO BRIDGE · COPY-READY</span>
            <h2 id="suno-bridge-title">把和弦送进制作</h2>
            <p>只输出 Suno 真正需要的风格提示与结构和弦蓝图。</p>
          </div>
          <button
            type="button"
            className="suno-close"
            onClick={onClose}
            aria-label="关闭 Suno Bridge"
          >
            <X size={18} />
          </button>
        </header>

        <div className="suno-signal-strip">
          <span><b>{kit.form}</b> FORM</span>
          <span><b>{kit.key} {kit.mode === "major" ? "MAJ" : "MIN"}</b> KEY</span>
          <span><b>{kit.tempoBpm}</b> BPM</span>
          <span><b>{kit.barsPerSection}</b> BARS / SECTION</span>
        </div>

        <section className="suno-production-grid" aria-label="制作参数">
          <div className="suno-production-title">
            <Clock3 size={14} />
            <div>
              <span>00 · PRODUCTION GRID</span>
              <strong>同步提示词与 MIDI</strong>
            </div>
          </div>
          <label className="suno-tempo-field">
            <span>BPM</span>
            <input
              type="number"
              min="50"
              max="180"
              inputMode="numeric"
              value={tempoDraft}
              onChange={(event) =>
                setTempoDraft(event.target.value.replace(/\D/g, "").slice(0, 3))
              }
              onBlur={commitTempo}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              aria-label="BPM"
            />
          </label>
          <div className="suno-production-control">
            <span>拍号</span>
            <div aria-label="拍号">
              {TIME_SIGNATURES.map((meter) => (
                <button
                  type="button"
                  key={meter}
                  className={
                    arrangement.production.timeSignature === meter ? "active" : ""
                  }
                  aria-pressed={arrangement.production.timeSignature === meter}
                  onClick={() =>
                    onProductionChange({ timeSignature: meter })
                  }
                >
                  {meter}
                </button>
              ))}
            </div>
          </div>
          <div className="suno-production-control">
            <span>每段小节</span>
            <div aria-label="每段小节">
              {SECTION_BAR_OPTIONS.map((bars) => (
                <button
                  type="button"
                  key={bars}
                  className={
                    arrangement.production.barsPerSection === bars ? "active" : ""
                  }
                  aria-pressed={arrangement.production.barsPerSection === bars}
                  onClick={() => onProductionChange({ barsPerSection: bars })}
                >
                  {bars}
                </button>
              ))}
            </div>
          </div>
          <div className="suno-voicing-control">
            <span>声部路径</span>
            <div aria-label="声部路径">
              {VOICING_PROFILES.map((profile) => (
                <button
                  type="button"
                  key={profile.id}
                  className={
                    arrangement.production.voicingMode === profile.id
                      ? "active"
                      : ""
                  }
                  aria-pressed={
                    arrangement.production.voicingMode === profile.id
                  }
                  onClick={() =>
                    onProductionChange({ voicingMode: profile.id })
                  }
                >
                  <strong>{profile.label}</strong>
                  <small>{profile.code}</small>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="suno-prompt-card suno-style-card">
          <div className="suno-card-head">
            <div>
              <span>01 · STYLE FIELD</span>
              <strong>复制到 Suno 的 Style 输入框</strong>
            </div>
            <div className="suno-language-switch" aria-label="提示词语言">
              <button
                type="button"
                className={language === "en" ? "active" : ""}
                onClick={() => setLanguage("en")}
              >
                EN
              </button>
              <button
                type="button"
                className={language === "zh" ? "active" : ""}
                onClick={() => setLanguage("zh")}
              >
                中
              </button>
            </div>
          </div>
          <p className="suno-style-prompt">{stylePrompt}</p>
          <button
            type="button"
            className="suno-copy"
            onClick={() => void handleCopy("style", stylePrompt)}
          >
            {copied === "style" ? <Check size={14} /> : <Copy size={14} />}
            {copied === "style" ? "已复制" : "复制风格提示词"}
          </button>
        </section>

        <section className="suno-prompt-card suno-blueprint-card">
          <div className="suno-card-head">
            <div>
              <span>02 · CHORD BLUEPRINT</span>
              <strong>结构、和弦与段落能量参考</strong>
            </div>
            <small>{kit.sections.length} 段 · {kit.form}</small>
          </div>
          <pre>{kit.chordBlueprint}</pre>
          <button
            type="button"
            className="suno-copy"
            onClick={() => void handleCopy("blueprint", kit.chordBlueprint)}
          >
            {copied === "blueprint" ? <Check size={14} /> : <Copy size={14} />}
            {copied === "blueprint" ? "已复制" : "复制和弦蓝图"}
          </button>
        </section>

        <div className="suno-accuracy-note">
          <Music2 size={15} />
          <p>
            Suno 可能重新解释和弦指令。需要逐小节准确时，请同时导出 MIDI 作为制作参考。
          </p>
        </div>

        <footer className="suno-bridge-actions">
          <button
            type="button"
            onClick={() =>
              void handleCopy("all", serializeSunoPromptKit(kit))
            }
          >
            {copied === "all" ? <Check size={15} /> : <Copy size={15} />}
            {copied === "all" ? "整包已复制" : "复制全部"}
          </button>
          <button type="button" onClick={onExportMidi}>
            <Music2 size={15} />
            MIDI 参考
          </button>
          <button
            type="button"
            className="suno-download"
            onClick={() =>
              downloadText(
                serializeSunoPromptKit(kit),
                `chordflow-suno-${kit.form.toLowerCase()}.txt`
              )
            }
          >
            <Download size={15} />
            下载 TXT
          </button>
        </footer>
      </aside>
    </div>
  );
}
