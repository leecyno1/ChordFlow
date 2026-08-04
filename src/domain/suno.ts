import { PROGRESSIONS } from "./catalog";
import {
  DEFAULT_PRODUCTION_SETTINGS,
  effectiveSectionProductionAt,
  getTextureProfile,
  getVoicingProfile,
  harmonicRhythmLabel
} from "./production";
import { buildVoicingPlan } from "./voicing";
import type {
  Arrangement,
  SectionRole,
  SectionTextureMode
} from "./types";

export const SUNO_BRIDGE_VERSION = "0.7";
export const DEFAULT_TEMPO_BPM = DEFAULT_PRODUCTION_SETTINGS.tempoBpm;

interface StyleProfile {
  en: string;
  instrumentationEn: string;
  productionEn: string;
  instrumentationZh: string;
  productionZh: string;
  textureDirectionsEn: Record<SectionTextureMode, string>;
}

export interface SunoSectionPrompt {
  label: string;
  title: string;
  symbol: string;
  role: SectionRole;
  energy: number;
  voicingMode: Arrangement["production"]["voicingMode"];
  voicingLabel: string;
  voicingCode: string;
  textureMode: SectionTextureMode;
  textureLabel: string;
  textureCode: string;
  instrumentationDirection: string;
  occurrence: number;
  productionLocked: boolean;
  chords: string[];
  numerals: string[];
  voicings: string[];
  bassLine: string[];
  direction: string;
}

export interface SunoPromptKit {
  version: string;
  title: string;
  key: string;
  mode: Arrangement["mode"];
  form: string;
  style: string;
  tempoBpm: number;
  timeSignature: Arrangement["production"]["timeSignature"];
  barsPerSection: number;
  voicingMode: Arrangement["production"]["voicingMode"];
  voicingLabel: string;
  sectionOverrideCount: number;
  textureArc: string;
  stylePromptEn: string;
  stylePromptZh: string;
  chordBlueprint: string;
  sections: SunoSectionPrompt[];
  notice: string;
}

const STYLE_PROFILES: Record<string, StyleProfile> = {
  华语流行: {
    en: "modern Mandopop",
    instrumentationEn: "warm piano, clean electric guitar, subtle synth pads, restrained live drums",
    productionEn: "intimate verses, a wide melodic chorus, polished emotional dynamics",
    instrumentationZh: "温暖钢琴、干净电吉他、轻柔合成器铺底、克制的现场鼓组",
    productionZh: "主歌亲密克制，副歌旋律空间明显打开，情绪动态精致而现代",
    textureDirectionsEn: {
      sparse:
        "lead with warm piano or clean electric guitar, leaving pads barely audible and drums minimal",
      balanced:
        "pair piano and clean guitar with subtle pads, melodic bass and controlled live drums",
      full:
        "layer piano, clean guitars and synth pads over active bass and full live drums"
    }
  },
  独立流行: {
    en: "indie pop",
    instrumentationEn: "textured electric guitar, soft analog synth, dry drums, melodic bass",
    productionEn: "close vocal presence, organic imperfections, a vivid but unforced chorus",
    instrumentationZh: "纹理电吉他、柔和模拟合成器、干燥鼓组、旋律型贝斯",
    productionZh: "人声距离亲近，保留自然质感，副歌鲜明但不过度用力",
    textureDirectionsEn: {
      sparse:
        "feature one textured guitar with dry room tone, holding synth, bass and drums back",
      balanced:
        "join textured guitar, soft analog synth, melodic bass and a tight dry groove",
      full:
        "stack contrasting guitars and analog synth around active melodic bass and broader live drums"
    }
  },
  "R&B / Neo Soul": {
    en: "contemporary R&B and neo-soul",
    instrumentationEn: "Rhodes electric piano, round bass, muted guitar, laid-back drums",
    productionEn: "silky pocket, spacious verses, rich chord color and a smooth chorus lift",
    instrumentationZh: "Rhodes 电钢、圆润贝斯、闷音吉他、松弛鼓组",
    productionZh: "律动丝滑、主歌留白充分，以丰富和弦色彩平滑抬升副歌",
    textureDirectionsEn: {
      sparse:
        "center Rhodes and muted guitar stabs, with round bass and percussion kept spacious",
      balanced:
        "lock Rhodes, muted guitar, round melodic bass and laid-back drums into a focused pocket",
      full:
        "layer Rhodes color, guitar responses and vocal-space pads over active bass and a full relaxed groove"
    }
  },
  摇滚: {
    en: "melodic modern rock",
    instrumentationEn: "driven electric guitars, live bass, punchy acoustic drums, restrained synth support",
    productionEn: "controlled verses, strong band dynamics, an anthemic chorus without excess density",
    instrumentationZh: "推动型电吉他、现场贝斯、有冲击力的原声鼓、克制合成器支撑",
    productionZh: "主歌控制力度，乐队动态清楚，副歌具有合唱感但不堆满",
    textureDirectionsEn: {
      sparse:
        "start with one restrained electric guitar, light bass support and minimal acoustic drums",
      balanced:
        "bring rhythm guitars, live bass and controlled acoustic drums into a firm band core",
      full:
        "open stacked electric guitars, driving bass and punchy full drums while keeping synth support selective"
    }
  },
  民谣: {
    en: "contemporary acoustic folk-pop",
    instrumentationEn: "fingerpicked acoustic guitar, soft piano, upright-style bass, brushed percussion",
    productionEn: "natural room tone, lyric-forward verses and a warm communal chorus",
    instrumentationZh: "指弹木吉他、柔和钢琴、原声感贝斯、刷奏打击乐",
    productionZh: "自然空间感，主歌突出叙事，副歌温暖而有共同吟唱感",
    textureDirectionsEn: {
      sparse:
        "lead with fingerpicked acoustic guitar, with soft piano, bass and brushes barely entering",
      balanced:
        "blend acoustic guitar and soft piano with upright-style bass and controlled brushed percussion",
      full:
        "widen strummed and fingerpicked acoustics around piano, active bass and a warm full percussion lift"
    }
  },
  电影配乐: {
    en: "cinematic song score",
    instrumentationEn: "felt piano, evolving strings, low percussion, atmospheric synth layers",
    productionEn: "long dynamic arcs, restrained opening, widescreen harmonic climax",
    instrumentationZh: "毡音钢琴、渐进弦乐、低频打击乐、氛围合成器层次",
    productionZh: "长线动态弧线，开场克制，和声高潮具有宽银幕感",
    textureDirectionsEn: {
      sparse:
        "expose felt piano with distant string air and almost no low percussion",
      balanced:
        "support felt piano with evolving strings, restrained low percussion and atmospheric synth depth",
      full:
        "expand into wide strings, layered synth atmosphere and decisive low percussion around the harmonic peak"
    }
  },
  爵士流行: {
    en: "sophisticated jazz-pop",
    instrumentationEn: "acoustic piano, upright bass, brushed drums, clean hollow-body guitar",
    productionEn: "elegant harmonic motion, conversational verses and a clear melodic refrain",
    instrumentationZh: "原声钢琴、立式贝斯、刷鼓、干净空心吉他",
    productionZh: "和声运动优雅，主歌像对话，副歌旋律清晰而不炫技",
    textureDirectionsEn: {
      sparse:
        "feature acoustic piano or hollow-body guitar with sparse upright bass and brushes",
      balanced:
        "shape a conversational quartet of piano, upright bass, brushes and clean hollow-body guitar",
      full:
        "open piano voicings, active upright bass, fuller brushed drums and selective guitar counterlines"
    }
  },
  电子氛围: {
    en: "atmospheric electronic pop",
    instrumentationEn: "soft pulse synth, granular pads, deep electronic bass, minimal programmed drums",
    productionEn: "slow-blooming texture, spacious verses and a luminous layered chorus",
    instrumentationZh: "柔和脉冲合成器、颗粒铺底、深沉电子贝斯、极简编程鼓",
    productionZh: "纹理缓慢展开，主歌留白，副歌明亮且具有分层空间",
    textureDirectionsEn: {
      sparse:
        "lead with a soft pulse or granular pad, holding deep bass and programmed drums to fragments",
      balanced:
        "combine pulse synth, granular pads, deep bass and controlled programmed drums in a focused grid",
      full:
        "stack luminous synth layers over active deep bass, full programmed drums and selective counter-melodies"
    }
  }
};

const MOOD_EN: Record<string, string> = {
  明亮: "luminous",
  坚定: "determined",
  共鸣: "resonant",
  内省: "introspective",
  苦甜: "bittersweet",
  青春: "youthful",
  怀旧: "nostalgic",
  甜蜜: "tender",
  圆满: "resolved",
  昂扬: "uplifting",
  闪耀: "radiant",
  庄重: "dignified",
  成长: "growing",
  优雅: "elegant",
  都市: "urban",
  松弛: "relaxed",
  笃定: "assured",
  精致: "refined",
  归属: "grounded",
  梦幻: "dreamlike",
  黄昏: "twilight-toned",
  温柔: "gentle",
  遗憾: "wistful",
  安宁: "calm",
  宏大: "expansive",
  奇幻: "fantastical",
  悬念: "tense",
  辽阔: "wide-open",
  史诗: "epic",
  炽烈: "intense",
  宿命: "fateful",
  异域: "exotic",
  幽暗: "shadowed",
  克制: "restrained"
};

const ROLE_EN: Record<SectionRole, string> = {
  intro: "Intro",
  verse: "Verse",
  prechorus: "Pre-Chorus",
  chorus: "Chorus",
  bridge: "Bridge",
  outro: "Outro"
};

const ROLE_DIRECTION: Record<SectionRole, string> = {
  intro: "establish the tonal color with restraint",
  verse: "keep the harmony narrative and leave space for the vocal",
  prechorus: "increase forward pull and prepare a clear release",
  chorus: "open the register, reinforce the hook and deliver the main emotional release",
  bridge: "introduce contrasting harmonic color before returning to familiar material",
  outro: "resolve clearly or leave a gentle afterglow"
};

const VARIATION_EN: Record<string, string> = {
  再现: "recognizable reprise",
  开放式回转: "open turnaround",
  终止变体: "stronger final cadence",
  手动改写: "custom harmonic edit"
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function collectMoods(arrangement: Arrangement): string[] {
  return unique(
    arrangement.sections.flatMap((section) =>
      PROGRESSIONS.find((item) => item.id === section.templateId)?.moods ?? []
    )
  ).slice(0, 3);
}

function sectionLabel(role: SectionRole, symbol: string, occurrence: number): string {
  return `${ROLE_EN[role]} ${symbol}${occurrence > 0 ? occurrence + 1 : ""}`;
}

function noveltyDirection(surprise: number): { en: string; zh: string } {
  if (surprise >= 68) {
    return {
      en: "distinctive chord color while keeping every transition coherent",
      zh: "使用有辨识度的和弦色彩，但确保每个转场仍然连贯"
    };
  }
  if (surprise <= 28) {
    return {
      en: "familiar, singable harmony with clear tonal resolution",
      zh: "采用熟悉、易唱且调性解决清晰的和声"
    };
  }
  return {
    en: "a balanced mix of familiar harmony and selective fresh color",
    zh: "在熟悉和声中加入少量新鲜色彩，保持平衡"
  };
}

export function buildSunoPromptKit(arrangement: Arrangement): SunoPromptKit {
  const profile = STYLE_PROFILES[arrangement.style] ?? STYLE_PROFILES.华语流行;
  const moodsZh = collectMoods(arrangement);
  const moodsEn = moodsZh.map((mood) => MOOD_EN[mood] ?? mood.toLowerCase());
  const novelty = noveltyDirection(arrangement.surprise);
  const modeEn = arrangement.mode === "major" ? "major" : "minor";
  const modeZh = arrangement.mode === "major" ? "大调" : "小调";
  const { tempoBpm, timeSignature, barsPerSection } = arrangement.production;
  const voicingProfile = getVoicingProfile(arrangement.production.voicingMode);
  const voicingPlan = buildVoicingPlan(arrangement);
  const hasBassAnchors = voicingPlan.chords.some(
    (voicing) => voicing.isBassOverridden
  );

  const sections: SunoSectionPrompt[] = arrangement.sections.map((section, sectionIndex) => {
    const sectionProduction = effectiveSectionProductionAt(
      arrangement,
      sectionIndex
    );
    const sectionVoicingProfile = getVoicingProfile(
      sectionProduction.voicingMode
    );
    const textureProfile = getTextureProfile(sectionProduction.textureMode);
    const variation = section.variationLabel
      ? VARIATION_EN[section.variationLabel] ?? section.variationLabel
      : "theme statement";
    const transition = section.transitionLabel
      ? ` Transition treatment: ${section.transitionLabel}.`
      : "";
    return {
      label: sectionLabel(section.role, section.symbol, section.occurrence),
      title: section.title,
      symbol: section.symbol,
      role: section.role,
      energy: sectionProduction.energy,
      voicingMode: sectionProduction.voicingMode,
      voicingLabel: sectionVoicingProfile.label,
      voicingCode: sectionVoicingProfile.code,
      textureMode: sectionProduction.textureMode,
      textureLabel: textureProfile.label,
      textureCode: textureProfile.code,
      instrumentationDirection:
        profile.textureDirectionsEn[sectionProduction.textureMode],
      occurrence: section.occurrence,
      productionLocked: sectionProduction.locked,
      chords: section.chords,
      numerals: section.numerals,
      voicings: voicingPlan.sections[sectionIndex].map(
        (voicing) => voicing.displayChord
      ),
      bassLine: voicingPlan.sections[sectionIndex].map(
        (voicing) =>
          `${voicing.bassNote}${voicing.isBassOverridden ? "*" : ""}`
      ),
      direction: `${ROLE_DIRECTION[section.role]}; ${variation}; ${sectionVoicingProfile.directionEn}.${transition}`
    };
  });
  const sectionOverrideCount = sections.filter(
    (section) => section.productionLocked
  ).length;
  const textureArc = sections
    .map(
      (section) =>
        `${section.symbol}${section.occurrence > 0 ? section.occurrence + 1 : ""}:${section.textureCode}`
    )
    .join(" → ");

  const stylePromptEn = [
    profile.en,
    moodsEn.join(", "),
    `${tempoBpm} BPM`,
    `${timeSignature} meter`,
    `${arrangement.key} ${modeEn}`,
    profile.instrumentationEn,
    profile.productionEn,
    voicingProfile.directionEn,
    sectionOverrideCount > 0
      ? "follow the section-specific energy, voicing and instrumentation-density directions in the chord blueprint"
      : "",
    hasBassAnchors
      ? "keep the specified manual bass anchors as the lowest notes"
      : "",
    novelty.en
  ]
    .filter(Boolean)
    .join(", ");

  const stylePromptZh = [
    arrangement.style,
    moodsZh.join("、"),
    `${tempoBpm} BPM`,
    `${timeSignature} 拍`,
    `${arrangement.key} ${modeZh}`,
    profile.instrumentationZh,
    profile.productionZh,
    voicingProfile.directionZh,
    sectionOverrideCount > 0
      ? "按和弦蓝图执行逐段能量、声部与配器密度方向"
      : "",
    hasBassAnchors ? "将标记的手动低音锚点保持为最低音" : "",
    novelty.zh
  ]
    .filter(Boolean)
    .join("，");

  const sectionLines = sections.flatMap((section) => [
    `[${section.label} | ${barsPerSection} bars | Energy ${section.energy}/100 | Voicing ${section.voicingLabel}/${section.voicingCode} | Texture ${section.textureLabel}/${section.textureCode}${section.productionLocked ? " LOCKED" : ""}]`,
    `Chords: ${section.chords.join(" - ")}`,
    `Harmony: ${section.numerals.join(" - ")}`,
    `Voicing guide: ${section.voicings.join(" - ")}`,
    `Bass guide: ${section.bassLine.join(" - ")}`,
    `Instrumentation: ${section.instrumentationDirection}`,
    `Harmonic rhythm: ${harmonicRhythmLabel(arrangement.production, section.chords.length)}`,
    `Direction: ${section.direction}`,
    ""
  ]);

  const chordBlueprint = [
    `SONG FORM: ${arrangement.formPattern}`,
    `KEY: ${arrangement.key} ${modeEn} | TEMPO: ${tempoBpm} BPM | METER: ${timeSignature}`,
    `STYLE: ${profile.en}`,
    `TEXTURE ARC: ${textureArc}`,
    `${sectionOverrideCount > 0 ? "DEFAULT " : ""}VOICING MODE: ${voicingProfile.label} / ${voicingProfile.code}`,
    ...(sectionOverrideCount > 0
      ? [
          `SECTION LOCKS: ${sectionOverrideCount} section${sectionOverrideCount > 1 ? "s" : ""} use explicit energy, voicing and texture directions.`
        ]
      : []),
    ...(hasBassAnchors
      ? [
          "BASS ANCHORS: Notes marked * are manual lowest-note anchors and should be preserved."
        ]
      : []),
    "",
    ...sectionLines,
    "ARRANGEMENT RULE: Keep repeated letter sections recognizable. Let the chorus feel wider than the verse, and make the bridge provide contrast before the final return. Preserve the listed chord order as the harmonic reference."
  ].join("\n");

  return {
    version: SUNO_BRIDGE_VERSION,
    title: arrangement.title,
    key: arrangement.key,
    mode: arrangement.mode,
    form: arrangement.formPattern,
    style: arrangement.style,
    tempoBpm,
    timeSignature,
    barsPerSection,
    voicingMode: arrangement.production.voicingMode,
    voicingLabel: voicingProfile.label,
    sectionOverrideCount,
    textureArc,
    stylePromptEn,
    stylePromptZh,
    chordBlueprint,
    sections,
    notice:
      "Suno may reinterpret chord instructions. Use the exported MIDI when exact bar-by-bar harmony is required."
  };
}

export function serializeSunoPromptKit(kit: SunoPromptKit): string {
  return [
    "CHORDFLOW → SUNO BRIDGE",
    `Version ${kit.version}`,
    "",
    "=== SUNO STYLE PROMPT / EN ===",
    kit.stylePromptEn,
    "",
    "=== SUNO 风格提示词 / 中文 ===",
    kit.stylePromptZh,
    "",
    "=== CHORD & STRUCTURE BLUEPRINT ===",
    kit.chordBlueprint,
    "",
    "=== ACCURACY NOTE ===",
    kit.notice
  ].join("\n");
}
