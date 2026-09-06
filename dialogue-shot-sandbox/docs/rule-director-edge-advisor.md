# 规则导演端侧顾问

## 定位

端侧模型是规则导演内部的可选顾问，不是独立导演模式。规则导演始终拥有最终结果：

```text
端侧模型分析连续叙事节拍
→ 规则系统按节拍生成合法镜头
→ 端侧模型逐镜观看、评分并提出局部调整
→ 检索已审核返修经验和已确认用户偏好
→ Schema 过滤
→ 确定性摄影机求解
→ 与规则基线比较投影质量
→ 采用更优结果
```

模型不得修改台词覆盖、角色进出场和站位，也不能输出摄影机 XYZ 坐标。模型离线、
超时或输出非法时，规则导演直接保留本地基线，不显示错误，也不阻断工作。

当前输入包含对白、上下文、角色资料、BP 站位、朝向、Mesh 包围盒体型，以及
规则基线的离屏 RGB 候选画面。候选画面采用与沙盘一致的体型代理、摄影机参数、
角色朝向和 21:9 安全框；模型逐镜评分后再提出受限调整。

Depth 与 Instance ID 尚未接入，因此当前能够判断画面可读性和代理遮挡，但不等于
对 UE 最终网格、材质、动画姿态和真实场景遮挡的像素验收。

## 默认模型

默认使用 Ollama 中的 `qwen3-vl:4b`：

- 约 4.4B 总参数；
- Q4 Ollama 包约 3.3GB；
- 支持文本、图片、多图和视频；
- 当前同时用于叙事节拍分析和规则候选画面评分。

正式安装包默认不携带 Ollama 或模型权重。普通用户可在“设置与更新”的
“端侧导演模型”一行查看状态：

- 未安装 Ollama 时，点击“安装 Ollama”打开官方 Windows 安装页；
- Ollama 已安装但模型缺失时，点击“下载模型”，应用通过 `/api/pull` 下载并
  显示实时进度；
- 模型已安装时，桌面端自动启动本机服务并使用，无需配置端口。

下载模型不是使用基础规则导演的前置条件。开发者也可以手动准备：

```powershell
ollama pull qwen3-vl:4b
npm run advisor:start
```

`advisor:start` 只检查本地模型并启动已有 Ollama，不会自行下载。

## 可替换模型

顾问支持 Ollama 原生 API 和 OpenAI-compatible API，可替换为其他 Qwen、
Gemma 或内部微调模型：

```powershell
$env:RULE_ADVISOR_API_STYLE = "ollama"
$env:RULE_ADVISOR_BASE_URL = "http://127.0.0.1:11434"
$env:RULE_ADVISOR_MODEL = "qwen3-vl:4b"
npm run dev
```

配置项：

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `RULE_ADVISOR_ENABLED` | `1` | 设为 `0` 完全关闭端侧顾问 |
| `RULE_ADVISOR_API_STYLE` | `ollama` | `ollama` 或 `openai` |
| `RULE_ADVISOR_BASE_URL` | `http://127.0.0.1:11434` | 推理 API 根地址 |
| `RULE_ADVISOR_MODEL` | `qwen3-vl:4b` | 可替换模型 ID |
| `RULE_ADVISOR_API_KEY` | 空 | 可选网关鉴权 |
| `RULE_ADVISOR_TIMEOUT_MS` | `60000` | 单次建议超时 |
| `RULE_ADVISOR_MAX_TOKENS` | `1024` | 建议输出上限 |
| `RULE_ADVISOR_CONTEXT_TOKENS` | `8192` | Ollama 上下文长度 |
| `RULE_ADVISOR_TEMPERATURE` | `0.1` | 生成温度 |
| `RULE_ADVISOR_RESPONSE_FORMAT` | 空 | 服务支持时设为 `json_object` |

`ollama` 模式使用原生 `/api/chat`，可关闭 thinking 并控制上下文；替换为
vLLM、SGLang 或其他兼容服务时，将 `RULE_ADVISOR_API_STYLE` 设为 `openai`，
并把 `RULE_ADVISOR_BASE_URL` 指向其 `/v1` 根地址。

## 状态检查

启动镜头沙盒后：

```powershell
Invoke-RestMethod http://127.0.0.1:5173/api/rule-advisor/status
```

状态接口返回启用状态、连通性、API 地址和当前模型，不返回 API Key。

使用内置示例对话执行完整协议联调：

```powershell
npm run advisor:smoke
```

Vite 不在默认 `5173` 端口时，先设置
`RULE_ADVISOR_SMOKE_URL` 为实际的 `/api/rule-advisor/analyze` 地址。

## 节拍协议

第一阶段返回 `rule-beat.v1`。每个节拍必须连续覆盖对白，并包含叙事功能、强度、
覆盖策略和可选强调角色。可用覆盖策略包括保持关系镜头、普通主体、反应、强调和
重新建立空间。

规则导演将节拍边界作为剪辑建议，但角色进出场、最长镜头时长、停顿和空间重建
仍可强制拆镜。模型不能输出摄影机坐标。

## 视觉建议协议

第二阶段返回 `rule-advice.v1`，每项建议包含：

- 从 0 开始的 `shot_index`；
- `0..1` 的置信度；
- 简短叙事理由；
- 仅包含待修改字段的 `changes`。

软件只应用置信度不低于 `0.65`、角色引用合法且合并后通过
`DirectorDecisionSchema` 的建议。调整后若投影问题多于原规则方案，则整组回退
到规则基线。

视觉评分包含：

- 构图稳定性 `composition`；
- 主体可读性 `subject_readability`；
- 遮挡质量 `occlusion`；
- 相邻镜头连续性 `continuity`；
- 综合分 `overall`；
- 最多四项可见问题 `issues`。

软件最多均匀抽取四个代表镜头，逐镜单图评分，再把全部结构化分数交给一次文本
建议调用。这样避免端侧模型在多图或联系表中混淆镜头索引。任何单图评分失败时，
整次建议无效并保留规则基线。

## 经验与偏好

两类经验分别存放在“分镜设计数据集”Base：

- `镜头返修案例库`：技术失败、修改前后和验收结果；只有已审核且通过或改善的
  案例会参与视觉返修。
- `导演偏好反馈库`：用户明确采用、拒绝、手动修改或方案选择；同一镜头使用稳定
  指纹更新，避免相互冲突的重复样本。

节拍分析会读取相关偏好；视觉调整会同时读取偏好与返修案例。飞书不可用时仅跳过
经验检索，不阻断本地导演。偏好表可通过 `DIRECTOR_PREFERENCE_TABLE_ID` 替换，
设定 `DIRECTOR_PREFERENCE_LIBRARY_DISABLED=1` 可完全关闭。

## 为什么模型不输出坐标

模型负责表达摄影意图，几何系统负责坐标。直接采用模型生成的 XYZ 会产生四类问题：

- 坐标依赖 UE 世界原点、角色局部轴、单位、槽位缩放和当前姿态，语言模型容易混用
  坐标系；
- 相同焦段、景别和构图对应连续的多组合法位置，单个坐标没有稳定语义；
- 遮挡、安全框、视线空间和运动路径需要投影或搜索才能验证；
- 直接坐标难以复现、缓存和随角色真实体型变化重新求解。

因此模型输出主体、景别、焦段、视觉落点、留白、机位高度和运动意图，确定性系统
将其解析为坐标并验收。未来可以允许模型提出小范围相对偏移或对多个坐标候选排序，
但最终坐标仍不应绕过几何验收。

## 桌面封装

Electron 正式客户端已内置顾问 bridge，并自动探测或启动本机 Ollama。默认地址由
软件管理，普通用户不需要配置端口。开发模式与桌面模式使用同一协议。

真正把推理运行时和约 3.3GB 模型权重放入安装包也可行：将 `ollama.exe` 作为
`extraResources/tools/ollama/ollama.exe`，将模型目录指向应用资源或首次运行数据
目录即可。当前发布采用设置页按需下载，不默认捆绑模型，原因是：

- 主程序每次更新都会携带大模型时，增量更新成本过高；
- GPU/CPU 运行时与模型权重应能独立升级；
- 模型许可证、签名和杀毒软件扫描需要单独处理。

推荐发布为“应用 + 受管 sidecar”：用户感知上仍是一个软件、无需端口配置，但
运行时和模型可以独立安装与更新。`RULE_ADVISOR_RUNTIME_PATH` 已允许桌面端指定
内置或自定义 Ollama 可执行文件。

## 后续视觉增强

后续加入 Depth 和 Instance ID 后，模型可进一步区分真实前后遮挡和环境目标；
几何硬约束与 UE 导出继续由现有确定性链路负责。
