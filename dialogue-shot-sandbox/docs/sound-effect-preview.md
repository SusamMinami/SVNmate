# 音效试听

> 文档状态：现行专题规范
>
> 最近核对：2026-09-05，对应镜头沙盘 `0.23.2`。

## 数据来源

音效目录中的资产名对应 UE `AkAudioEvent`。试听优先使用当前 Base“音效资产表”
中的远端附件；附件不存在时，回退到当前配置目录所属项目的 UE/Wwise 生成数据：

```text
Base: TxRLbFH2zalbTSsw4O3cFQUAnkb
Table: tblky7jbQIOlk44n
View: vewNcXGzda
```

```text
res/Content/Seria/WwiseAudio/Windows/
├── Event/<Wwise Short ID 前两位>/<资产名>.json
└── Media/<媒体 ID 前两位>/<媒体 ID>.wem
```

Wwise Short ID 使用 Wwise 的小写 FNV-1 32 位算法计算。Event JSON 是资产名到
实际 WEM 媒体的权威映射，不能根据文件名猜测媒体 ID。

## 试听流程

1. 设置页同步音效目录时同时缓存远端音效资产表。
2. 导演页优先检查远端记录；有试听附件时按原扩展名下载到本地缓存后直接播放。
3. 远端没有附件时检查当前 UE/Wwise Event JSON 和媒体文件。
4. 首次本地提取使用 `tools/vgmstream/vgmstream-cli.exe` 将第一个 WEM 解码为
   WAV，并在后台回传远端记录。
5. Event 或媒体缺失时禁用播放按钮，并在悬停提示中显示原因。
6. 本地 API 通过 HTTP Range 返回 WAV、MP3、M4A、AAC、OGG 或 FLAC，
   支持浏览器渐进播放。

批量补齐或资源更新后运行：

```powershell
npm run sync:sound-effect-previews
```

脚本以资产名为唯一键。已有附件跳过上传；可提取资产生成 WAV 并上传；缺失项
更新为“引擎缺失”。具体记录数属于运行时数据，以同步命令和设置页的当前结果
为准，不在规范中固化。

绝大多数对话音效事件只有一个媒体。包含随机容器或多个媒体的 Event 会显示提示，
当前试听第一个代表媒体；最终游戏内播放仍以 Wwise Event 逻辑为准。

vgmstream 随桌面版作为 `extraResources` 分发，许可文本保留在
`tools/vgmstream/COPYING`。
