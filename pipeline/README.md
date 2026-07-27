# ChordFlow 数据管线

## 数据规模边界

当前仓库真实接入的数据为：

- POP909：909 首华语流行歌曲，用于和弦事件、走向和相邻转移统计。
- Harmonix Set：912 首西方流行歌曲，用于段落角色、曲式和段落转移统计。

两套数据的歌曲并未在当前版本中形成和弦—曲式联合标注。“百万首歌曲和弦图谱”是长期产品目标，需要许可明确的数据源、跨库去重、统一归一化与质量分级。在达到目标前，所有前端与文档必须展示实际有效样本量。

## POP909

当前统计入口只检出和声分析所需文件，不下载 MIDI 和历史版本：

~~~bash
git clone --depth 1 --filter=blob:none --no-checkout \
  https://github.com/music-x-lab/POP909-Dataset.git \
  data/sources/pop909-repo

cd data/sources/pop909-repo
git sparse-checkout init --no-cone
git sparse-checkout set --no-cone \
  /LICENSE \
  /README.md \
  '/POP909/*/chord_midi.txt' \
  '/POP909/*/key_audio.txt'
git checkout
cd ../../..
~~~

生成前端统计：

~~~bash
python3 pipeline/pop909_stats.py
~~~

输出文件为 src/data/pop909-stats.json。

统计口径：

- 每个和弦按活动调性转换为相对罗马数字。
- 连续重复的同一和弦折叠为一次和弦事件。
- 歌曲覆盖率在每首歌内最多计数一次。
- 转移概率基于折叠后的相邻和弦事件。
- 经典走向采用严格连续匹配。
- 结果只代表 POP909 的 909 首华语流行编配，不能称为全球占比。

原始标注、代码、论文与许可证来自：

- https://github.com/music-x-lab/POP909-Dataset
- Wang et al., POP909: A Pop-song Dataset for Music Arrangement Generation, ISMIR 2020

## 后续数据源

管线的输出 schema 将继续用于：

- ChoCo：跨数据集和弦/调性事件。
- Hooktheory：在符合 API 条款时作为在线对照，不作为唯一来源。

## Harmonix Set

只检出结构标注和元数据：

~~~bash
git clone --depth 1 --filter=blob:none --no-checkout \
  https://github.com/urinieto/harmonixset.git \
  data/sources/harmonixset-repo

cd data/sources/harmonixset-repo
git sparse-checkout init --cone
git sparse-checkout set dataset/segments dataset/metadata.csv LICENSE README.md
git checkout
cd ../../..
~~~

生成曲式统计：

~~~bash
python3 pipeline/harmonix_stats.py
~~~

输出文件为 src/data/harmonix-stats.json。

统计口径：

- 对 verse、prechorus、chorus、bridge、intro、outro 等标签归一化。
- 段落转移先折叠连续相同标签。
- A/B/C 抽象曲式仅使用 verse、chorus、bridge 三类核心段落，重复核心边界保留，因此 AABA、结尾 BB 等结构不会被压缩。
- 曲式同时提供精确覆盖率和编辑距离意义上的“结构族”覆盖率；每首歌只归入最近预设，最低相似度为 70%。
- Harmonix 不包含和弦，因此不会被用于声称段落内和弦使用率。
