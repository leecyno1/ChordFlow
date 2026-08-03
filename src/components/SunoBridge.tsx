import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Music2, X } from "lucide-react";
import {
  buildSunoPromptKit,
  serializeSunoPromptKit
} from "../domain/suno";
import type { Arrangement } from "../domain/types";

interface SunoBridgeProps {
  open: boolean;
  arrangement: Arrangement;
  onClose: () => void;
  onExportMidi: () => void;
}

type CopyTarget = "style" | "blueprint" | "all";
type PromptLanguage = "en" | "zh";

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Some embedded browsers expose Clipboard API but deny permission.
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
  onExportMidi
}: SunoBridgeProps) {
  const kit = useMemo(() => buildSunoPromptKit(arrangement), [arrangement]);
  const [language, setLanguage] = useState<PromptLanguage>("en");
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const copyTimer = useRef<number | null>(null);

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
          <span><b>{kit.sections.length}</b> SECTIONS</span>
        </div>

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
