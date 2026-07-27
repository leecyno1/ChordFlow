import type {
  FormPreset,
  ProgressionTemplate,
  SectionRole
} from "./types";

export const FORM_PRESETS: FormPreset[] = [
  {
    id: "aba",
    name: "陈述 · 对比 · 回归",
    pattern: "ABA",
    description: "适合叙事歌曲与器乐短章，回归清晰。"
  },
  {
    id: "aaba",
    name: "标准歌曲体",
    pattern: "AABA",
    description: "熟悉材料占主导，桥段负责打开视野。"
  },
  {
    id: "abab",
    name: "主副歌循环",
    pattern: "ABAB",
    description: "直接、高效，适合短篇流行结构。"
  },
  {
    id: "ababcb",
    name: "现代流行完整体",
    pattern: "ABABCB",
    description: "主歌、副歌、桥段和最终副歌层次完整。"
  },
  {
    id: "abcba",
    name: "拱形结构",
    pattern: "ABCBA",
    description: "从中心高潮向两侧镜像回归。"
  },
  {
    id: "abaca",
    name: "回旋曲式",
    pattern: "ABACA",
    description: "主题 A 不断返回，穿插不同色彩。"
  }
];

export const STYLES = [
  "华语流行",
  "独立流行",
  "R&B / Neo Soul",
  "摇滚",
  "民谣",
  "电影配乐",
  "爵士流行",
  "电子氛围"
];

export const PROGRESSIONS: ProgressionTemplate[] = [
  {
    id: "axis",
    nameZh: "轴心进行",
    nameEn: "Axis progression",
    numerals: ["I", "V", "vi", "IV"],
    description: "主音落地、属和弦抬升、小调和弦染色，再由下属功能托住回归。记忆点明确，旋律容错率高。",
    moods: ["明亮", "坚定", "共鸣"],
    genres: ["华语流行", "独立流行", "摇滚"],
    suitableRoles: ["verse", "chorus", "outro"],
    modes: ["major"],
    energy: 78,
    familiarityIndex: 96,
    clicheRisk: 82,
    sourceNote: "经典走向编辑先验；真实语料覆盖率待数据管线计算"
  },
  {
    id: "sensitive-loop",
    nameZh: "内省轴心",
    nameEn: "Minor-start axis",
    numerals: ["vi", "IV", "I", "V"],
    description: "从关系小调出发，把最熟悉的流行骨架变得更内省；适合先有情绪、后找到出口的段落。",
    moods: ["内省", "苦甜", "青春"],
    genres: ["华语流行", "独立流行", "电子氛围"],
    suitableRoles: ["verse", "chorus"],
    modes: ["major"],
    energy: 70,
    familiarityIndex: 92,
    clicheRisk: 78,
    sourceNote: "经典走向编辑先验；名称采用描述性用语，避免地域俗称误导"
  },
  {
    id: "doo-wop",
    nameZh: "五十年代进行",
    nameEn: "50s / Doo-wop progression",
    numerals: ["I", "vi", "IV", "V"],
    description: "像一段完整句子：陈述、柔化、打开、回家。复古而亲切，非常适合副歌或尾声循环。",
    moods: ["怀旧", "甜蜜", "圆满"],
    genres: ["华语流行", "民谣", "独立流行"],
    suitableRoles: ["chorus", "outro"],
    modes: ["major"],
    energy: 72,
    familiarityIndex: 94,
    clicheRisk: 80,
    sourceNote: "经典走向编辑先验；不能表述为无条件的全球第一"
  },
  {
    id: "royal-road",
    nameZh: "王道进行",
    nameEn: "Royal Road progression",
    numerals: ["IV", "V", "iii", "vi"],
    description: "始终悬在向前的路上，避免过早回到主和弦；明亮之中带着未完成感，副歌推动力强。",
    moods: ["昂扬", "青春", "闪耀"],
    genres: ["华语流行", "独立流行", "电子氛围"],
    suitableRoles: ["prechorus", "chorus"],
    modes: ["major"],
    energy: 86,
    familiarityIndex: 88,
    clicheRisk: 68,
    sourceNote: "经典走向编辑先验；常见地域与风格差异需由语料切片展示"
  },
  {
    id: "canon",
    nameZh: "卡农序列",
    nameEn: "Pachelbel sequence",
    numerals: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"],
    description: "长线低音和功能轮转形成不可逆的时间感，适合铺陈、成长蒙太奇与抒情高潮。",
    moods: ["庄重", "成长", "怀旧"],
    genres: ["华语流行", "民谣", "电影配乐"],
    suitableRoles: ["verse", "chorus", "outro"],
    modes: ["major"],
    energy: 76,
    familiarityIndex: 91,
    clicheRisk: 77,
    sourceNote: "经典序列编辑先验；不同归一化规则会影响精确匹配率"
  },
  {
    id: "one-six-two-five",
    nameZh: "经典回转",
    nameEn: "I–vi–ii–V turnaround",
    numerals: ["Imaj7", "vi7", "ii7", "V7"],
    description: "从稳定主和弦沿五度关系逐步积累回归动力，优雅、城市化，并天然适合循环。",
    moods: ["优雅", "都市", "松弛"],
    genres: ["R&B / Neo Soul", "爵士流行"],
    suitableRoles: ["verse", "intro", "outro"],
    modes: ["major"],
    energy: 58,
    familiarityIndex: 80,
    clicheRisk: 48,
    sourceNote: "功能和声与爵士标准语汇编辑先验"
  },
  {
    id: "two-five-one",
    nameZh: "二五一终止",
    nameEn: "ii–V–I",
    numerals: ["ii7", "V7", "Imaj7", "Imaj7"],
    description: "前属、属、主功能依次解决，是最清楚的爵士语法之一；扩展音与转位决定它究竟传统还是现代。",
    moods: ["笃定", "精致", "归属"],
    genres: ["爵士流行", "R&B / Neo Soul"],
    suitableRoles: ["chorus", "outro", "bridge"],
    modes: ["major"],
    energy: 66,
    familiarityIndex: 86,
    clicheRisk: 60,
    sourceNote: "功能和声与爵士标准语汇编辑先验"
  },
  {
    id: "dream-borrow",
    nameZh: "暮色借用",
    nameEn: "Minor-subdominant color",
    numerals: ["Imaj7", "iii7", "IVmaj7", "iv6"],
    description: "前三个和弦温柔展开，最后借用小下属让色彩突然转暗；不靠强属功能也能自然回家。",
    moods: ["梦幻", "苦甜", "黄昏"],
    genres: ["R&B / Neo Soul", "独立流行", "电子氛围"],
    suitableRoles: ["verse", "bridge", "outro"],
    modes: ["major"],
    energy: 50,
    familiarityIndex: 64,
    clicheRisk: 28,
    sourceNote: "调式混合编辑先验；情绪标签为创作提示，不是客观测量"
  },
  {
    id: "plagal-fall",
    nameZh: "小下属回望",
    nameEn: "Plagal minor fall",
    numerals: ["I", "IV", "iv", "I"],
    description: "大下属转为小下属，再回到主和弦；像一句说出口后又轻轻收回的话。",
    moods: ["温柔", "遗憾", "安宁"],
    genres: ["独立流行", "民谣", "电影配乐"],
    suitableRoles: ["verse", "bridge", "outro"],
    modes: ["major"],
    energy: 42,
    familiarityIndex: 72,
    clicheRisk: 38,
    sourceNote: "变格与调式借用编辑先验"
  },
  {
    id: "chromatic-mediant",
    nameZh: "染色中介",
    nameEn: "Chromatic mediant arc",
    numerals: ["I", "bIII", "bVI", "V"],
    description: "三个相距三度的明亮和弦制造电影式空间跃迁，最后用属和弦重新对准主音。",
    moods: ["宏大", "奇幻", "悬念"],
    genres: ["电影配乐", "摇滚", "电子氛围"],
    suitableRoles: ["bridge", "intro"],
    modes: ["major"],
    energy: 82,
    familiarityIndex: 45,
    clicheRisk: 18,
    sourceNote: "染色中介和声编辑先验"
  },
  {
    id: "minor-cinema",
    nameZh: "小调远征",
    nameEn: "Minor cinematic loop",
    numerals: ["i", "VI", "III", "VII"],
    description: "不依赖传统属和弦解决，而是在自然小调的四个支点间持续推进，辽阔且适合长旋律。",
    moods: ["辽阔", "坚定", "史诗"],
    genres: ["电影配乐", "摇滚", "电子氛围"],
    suitableRoles: ["verse", "chorus", "bridge"],
    modes: ["minor"],
    energy: 80,
    familiarityIndex: 84,
    clicheRisk: 62,
    sourceNote: "自然小调流行语汇编辑先验"
  },
  {
    id: "andalusian",
    nameZh: "安达卢西亚终止",
    nameEn: "Andalusian cadence",
    numerals: ["i", "VII", "VI", "V"],
    description: "低音逐级下行，张力却在最后的属和弦达到最高；戏剧性强，回到小主和弦时非常有重量。",
    moods: ["炽烈", "宿命", "异域"],
    genres: ["电影配乐", "摇滚", "民谣"],
    suitableRoles: ["chorus", "bridge"],
    modes: ["minor"],
    energy: 88,
    familiarityIndex: 78,
    clicheRisk: 50,
    sourceNote: "经典终止型编辑先验"
  },
  {
    id: "minor-plagal",
    nameZh: "雾中回归",
    nameEn: "Minor plagal loop",
    numerals: ["i", "iv", "VI", "V"],
    description: "先向小下属沉降，再借六级和弦打开空间，最后由大属和弦强力召回主音。",
    moods: ["幽暗", "克制", "悬念"],
    genres: ["华语流行", "电影配乐", "电子氛围"],
    suitableRoles: ["verse", "prechorus", "bridge"],
    modes: ["minor"],
    energy: 67,
    familiarityIndex: 60,
    clicheRisk: 26,
    sourceNote: "小调功能和声编辑先验"
  }
];

export const ROLE_META: Record<
  SectionRole,
  { title: string; description: string; targetEnergy: number }
> = {
  intro: { title: "前奏", description: "建立音色与调性", targetEnergy: 36 },
  verse: { title: "主歌", description: "稳定叙事，保留空间", targetEnergy: 54 },
  prechorus: { title: "预副歌", description: "抬升张力，准备释放", targetEnergy: 72 },
  chorus: { title: "副歌", description: "记忆锚点与情绪释放", targetEnergy: 82 },
  bridge: { title: "桥段", description: "打开新区域，制造对比", targetEnergy: 70 },
  outro: { title: "尾奏", description: "闭合或留下余韵", targetEnergy: 44 }
};

export function roleForSymbol(symbol: string): SectionRole {
  const map: Record<string, SectionRole> = {
    A: "verse",
    B: "chorus",
    C: "bridge",
    D: "prechorus",
    I: "intro",
    O: "outro"
  };
  return map[symbol] ?? "verse";
}
