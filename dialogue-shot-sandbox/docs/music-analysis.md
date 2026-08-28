# 音乐音频分析

## 数据源

- BGM 目录：
  `TxRLbFH2zalbTSsw4O3cFQUAnkb / tblXRZRyNviXeFSr`
- 音频分析表：
  `TxRLbFH2zalbTSsw4O3cFQUAnkb / tblyINACQE4xtUGx`
- 默认视图：`vewtmWJM1D`（全部分析）
- UE 状态映射：当前设置中的 `doc\csvdir\d对话音乐状态映射表.csv`

分析表以 `资源标识` 为稳定业务键，同时保存源 Base `record_id` 和单向记录关联。
其他 AI 或软件可先按 `资源标识` 与 BGM 目录或
`DialogMusicState.WwiseState` 连接，再读取结构化音频特征。

## 本地分析

运行：

```powershell
npm run analyze:music
```

脚本 `scripts/analyze-music-library.py` 会：

1. 读取已同步的音乐目录和本地 UE 状态映射。
2. 按 `file_token` 下载尚未缓存或附件已变化的音频。
3. 使用 FFmpeg/FFprobe 和 NumPy 分析每首音乐最多前 180 秒。
4. 将逐附件缓存写入 `.storyboard-data/music-analysis-cache`。
5. 汇总为 `.storyboard-data/music-analysis.ndjson`。
6. 按 `资源标识` 向分析表新增或更新记录，并回读记录总数。

运行环境需要 Python 3.10+、FFmpeg/FFprobe，并安装：

```powershell
pip install -r scripts/requirements-music-analysis.txt
```

状态表不在默认 `C:\trunk\doc\csvdir` 时，可直接运行脚本并传入
`--state-map <路径>`。普通设置页同步不会下载全库附件，但会同时读取 BGM 目录
和远端分析表，因此其他电脑也能直接复用已发布的分析结果。

缓存键包含附件 token、附件大小、分析窗口和分析器版本。任一项变化时自动重算。
删除源记录不会自动删除分析表历史行，避免无确认的数据删除。

## 字段口径

- `估算BPM`：起音强度包络的自相关估算。资源名明确包含 BPM 时优先采用标注值。
- `BPM来源`：`资源标识` 或 `音频估算`。
- `节奏置信度`：`0..1`；低置信结果只可作为弱排序信号。
- `综合响度LUFS`、`响度范围LU`、`真峰值dBFS`：FFmpeg loudnorm 测量结果。
- `RMS电平dBFS`、`动态范围dB`：采样窗口内的信号电平与峰均差。
- `频谱重心Hz`：幅度谱加权平均频率。
- `低/中/高频占比`：分别统计 `20-250 Hz`、`250-2000 Hz` 和
  `2000 Hz` 以上的功率占比。
- `速度等级`、`能量等级`、`音色明暗`：便于人工筛选和 AI 初筛的离散标签。
- `音频特征摘要`、`推荐场景`：供人工快速审核的可读摘要。

音乐推荐仍以剧情语义、人工标签和备注为主，音频特征只负责同类候选排序，避免
低置信 BPM 或单一频谱指标覆盖叙事判断。
