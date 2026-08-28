# Dialog Graph 分镜导出设计

## 目标

将镜头沙盘中已经确认的当前分镜写入 UE4 对应的 `SeriaDialogGraph` 台词
节点。导出是显式、高风险操作，必须先展示 UE 实际数据与目标数据的差异，
用户确认后才修改并保存资产。

## 已验证的 UE 数据结构

2026-08-24 通过本机 `OmniMcpCore` 对
`/Game/Seria/Task/dialoggraph/1009-Cha08/735200.735200` 做了只读检查：

- 对话资产内的 `Dialog Graph.Nodes` 包含开始节点和台词节点。
- 每个图节点通过 `DialogGraphNodeData` 指向
  `SeriaDialogGraphNodeData`。
- 台词 ID 位于 `CommonDialogGraphProperties` 中 `Alias="id"` 的
  `CurrentUint32`。
- “摄像机位置”位于同一数组中 `Alias="CameraPosition"` 的
  `CurrentString`。
- 已有镜头节点 `735201` 的 `CameraPosition` 为 `c1`。
- 实际镜头参数位于节点的 `MoveCameras` 数组，不存在可直接写入的
  `CameraConfig` 属性。
- `MoveCameras[0]` 的 `FMoveCamera` 包含 `CameraMoveType`、
  `PushCameraArg`、`RotateCameraArg`、`LookAtArg`、
  `LookAtPushArg` 和 `FOV`。
- `DialogBlendCameraData` 默认使用 `ECutShot`。首版不修改该字段。
- 音效位于 `CommonDialogGraphProperties` 的 `Alias="SoundEffect"`，
  类型为 `softobjectpath`，实际值写入 `CurrentPath`。
- 音效延迟位于 `Alias="DelayTime"` 的 `CurrentFloat`；推荐与导出流程不配置
  该值，始终保留 UE 节点中的现有延迟。
- 音乐状态位于 `Alias="BackgroundMusic"` 的 `CurrentUint32`。状态 ID 来自
  `d对话音乐状态映射表.csv` 中
  `DialogMusicState.WwiseState -> DialogMusicState.id` 的映射。
- 音乐延迟位于 `Alias="DelayBackgroundMusicTime"`；推荐与导出不修改该值。
- Formation BP 中存在名为 `c1` 的 `CameraComponent`，因此节点填写
  `c1` 后可启用该相机。
- Formation BP 中以资产名命名的背景 ChildActor、SkeletalMesh 和 StaticMesh
  组件不会进入数字角色槽或 DialogModels，但会随 BP 在对白镜头中显示。

现有 UE bridge 已经支持资产搜索、子对象属性读写、回读和
`asset.save_asset`，无需新增 UE 插件。

## 镜头与台词节点映射

沙盘中的一个镜头可以覆盖多句台词。导出规则为：

1. 镜头覆盖的第一个台词节点写入 `CameraPosition=c1`。
2. 同一节点写入一个 `MoveCameras[0]`。
3. 该镜头覆盖的后续台词节点清空 `CameraPosition` 和 `MoveCameras`。
4. 只处理当前对话链中的节点，不修改资产内其他分支。

清空延续节点是必要步骤，否则旧配置会在镜头中途产生额外切镜。

## 坐标转换

只有使用 BP 站位生成的方案允许导出。服务器重新读取 Formation BP，
按当前参与者的数字模型槽计算与前端相同的平面中心：

```text
UE.X = BP中心X - Three.Z * 100
UE.Y = BP中心Y + Three.X * 100
UE.Z = Three.Y * 100
```

UE 使用厘米和 `X 前 / Y 右 / Z 上`，Three.js 使用米和
`X 右 / Y 上 / Z 后`。

相机旋转由起止相机位置和注视点计算：

```text
Yaw   = atan2(deltaY, deltaX)
Pitch = atan2(deltaZ, sqrt(deltaX^2 + deltaY^2))
Roll  = 沙盘镜头横滚角
```

焦距按 35 mm 画幅宽度转换为 UE 水平 FOV：

```text
FOV = 2 * atan(35 / (2 * focalLength))
```

## 首版运镜映射

静态、Pan、Tracking、Dolly in 和 Dolly out 统一写为 `EPush`：

- 静态镜头：起止位置和旋转相同，`Velocity=0`。
- Pan：位置相同，起止旋转不同。
- Tracking / Dolly：使用沙盘给出的起止位置和注视点。
- `bRelative=true`，坐标为 Formation BP 局部坐标。
- `BlendOutTime=1`。
- `FOV` 使用镜头起始焦距。

当前 `FMoveCamera` 只有单个 FOV 字段，尚未验证连续焦距动画的无损表达。
因此首版对 Zoom 和 Dolly zoom 给出阻断项，不会静默丢失焦距变化。

## 交互流程

1. 当前分镜必须已生成，并完整绑定 BP 模型槽。
2. 用户点击右下角“导出到 UE”，默认只预检当前激活镜头。
   导演页的“写入本镜音效”则以无镜头数据的方式复用同一预检流程。
3. 弹窗右上角“全部导出”可切换为全量预检和多镜头选择。
4. 应用只读检查对话资产、Formation、`c1` 组件及本次目标节点。
5. 弹窗展示每个节点的当前相机、目标相机和处理方式：
   `新增`、`覆盖`、`清空旧镜头` 或 `无需修改`。
6. 全量页面中每个镜头可独立勾选；同一镜头覆盖的起点和延续节点作为一个整体处理，
   未勾选镜头不写入也不清空。
7. 音效与音乐建议分别在独立列表中勾选，可与镜头一起导出，也可取消全部镜头后
   仅导出音效或音乐；当前镜头模式只包含该镜头覆盖节点的建议。
8. 对话资产或 Formation BP 已有未保存修改时阻断导出，避免保存无关改动或
   使用随后可能被撤销的站位。
9. 投影验收失败只显示警告，不阻断用户确认。
10. 选中镜头包含演员转身时显示动作数量和 Montage 名称；当前导出仍只写相机，
   不修改可能已有人工配置的 `CharacterBehaviours`。
11. 用户勾选覆盖确认后，才能点击“确认写入并保存”。
12. 服务端对勾选镜头、音效和音乐重新执行预检；若 UE 数据已变化，审核令牌
   失效并要求重新检查。
13. 写入后逐节点回读；结构、枚举和布尔值严格匹配，浮点数按 UE4 float32
    精度容差校验，全部一致后保存对话资产。

## 音乐资料库与试听

- 音乐目录由用户在设置页手动同步飞书多维表格，不后台定时刷新。
- 只有 `资源标识` 能在本地音乐状态 CSV 中找到唯一状态 ID 的记录才进入推荐
  目录；同步结果显示未映射记录数和缺少附件数。
- 推荐结合剧情梗概、整段对白和导演情绪走向。开场选择当前主要情绪，后续仅在
  明确情绪类别改变且与上次切换至少间隔两句时新增切歌节点，单段最多四次。
- 目录同步只读取元数据。WAV/MP3 附件在用户点击试听后按需下载，以
  `fileToken + 文件名` 缓存，并通过 HTTP Range 响应支持流式播放和拖动。
- `npm run analyze:music` 可显式执行全库增量分析并更新 Base 中的
  “音乐音频分析”表。分析包含 BPM、置信度、LUFS、动态范围、频谱重心和
  低/中/高频占比；应用同步音乐目录时会读取这些结果。
- 推荐仍以人工标签、备注和剧情语义为主，音频特征只对同类候选排序。分析结果
  必须与当前附件 token 一致才可使用，避免附件更新后复用过期特征。

## 失败与恢复

- 写入和回读期间不调用保存。
- 任一节点失败时，恢复本轮已修改节点的原始
  `CommonDialogGraphProperties` 与 `MoveCameras`。
- 只有全部回读通过后调用一次 `asset.save_asset`。
- 保存失败时同样恢复本轮内存修改并返回错误。
- 不修改导出的 CSV，不自动执行 SVN checkout。

## 对白编辑复用

对白编辑复用同一条 Dialog Graph 访问链路：

1. 使用开始节点 ID（通常为四位数对话 ID 加 `00`）在
   `/Game/Seria/Task/dialoggraph` 精确定位对话资产。
2. 临时导出资产文本，建立台词 ID 到 `Dialog Graph.Nodes` 下图节点的索引。
3. 通过 `DialogGraphNodeData` 读取 `CommonDialogGraphProperties`，定位
   `Alias="Content"` 的 `CurrentString`。
4. 写入前检查对话资产是否有未保存修改，并核对 UE 当前原文与界面加载的原文，
   避免覆盖编辑器中的新改动。
5. 写入整个 `CommonDialogGraphProperties` 数组，回读确认 `Content` 后调用
   `asset.save_asset`。
6. 写入、回读或保存失败时恢复该节点原始属性。

公共实现位于 `server/ueBridge.ts` 的 `findDialogueAssetPath`、
`exportAssetText`、`readDialogueNodes`、`dirtyContentPackages` 和
`readProperty`。分镜导出在此基础上继续处理 `CameraPosition` 与
`MoveCameras`；单条对白编辑只处理一个节点的 `Content`。文字搜索结果还可
通过独立编辑窗口批量替换：先对全部勾选节点执行资产定位、原文和脏资产预检，
再统一写入并逐条回读，同一对话资产只保存一次。任一步骤失败时恢复本批次已
写入节点，避免逐条保存造成无法确认的部分成功状态。

UE TCP 连接由 `server/ue/transport.ts` 管理，HTTP 入口位于
`server/ue/routes.ts`，并统一通过 `server/ue/services.ts` 调用上述业务实现。

## 后续验证

- 在 UE 中对一个专用测试对话执行真实写入，确认
  `reflect.write_object_property` 可稳定写入 `TArray<FMoveCamera>`。
- 在编辑器中播放静态、Pan、Tracking 和 Dolly 样例，核对坐标、旋转、
  FOV 与速度语义。
- 验证通过后研究 Zoom / Dolly zoom 的多段 `MoveCameras` 表达。
- 如项目要求，增加 SVN 可写状态检查和 UE Transaction。
