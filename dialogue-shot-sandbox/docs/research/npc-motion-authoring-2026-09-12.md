# NPC 动作制作模块可行性研究

> 状态：研究建议，不是已实现功能或默认执行任务。
>
> 核对日期：2026-09-12。依据官方仓库、模型卡、许可证、现有源码与本机环境。
> 本次未下载动作模型，未运行模型推理，未访问或写入 UE/Excel 生产资产。

后续部署实测见 [2026-09-13 验证记录](kimodo-validation-2026-09-13.md)：
已完成公开权重加载和静态骨架格式测试，并发现 Llama 3 基座授权与 Windows SDK 前置条件。
下文保留 2026-09-12 的研究状态，不作为当前安装完成情况。

## 结论

值得试验，目标应是“低成本产出可修改的动作初稿”，而不是承诺“一句话生成可直接
上线的任意动作”。生成质量之外，真正的接入工作是目标骨架重定向、接地和根运动
修正、循环处理、动作审核与可追溯导入。

建议优先验证 **Kimodo-SOMA-RP-v1.1 + Blender + 现有 NPC 动作增补链路**。
需要明确表演细节的动作，可增加 **GEM-X 单视频动捕**；具备拍摄条件时再考虑
**FreeMoCap 多机位动捕**。三者是不同输入方式，不应在第一版同时完整接入。

适合首轮试验：招手、指向、摊手、鞠躬、站立交谈等单人短动作。不在首轮承诺精细
手指表演、表情、双人接触、准确握持道具、复杂战斗、长裙防穿模或无缝循环。
坐下、拾取等动作必须有实际座面/道具位置约束，不能只依赖文本。

## 候选与授权

以下是工程选型核查，不替代公司法务对具体部署和发行范围的批准。软件许可、
模型权重许可、人体模型/检测器等依赖许可、输入素材授权需要分别检查。

| 方案 | 能力 | 免费与授权边界 | 本次判断 |
| --- | --- | --- | --- |
| [Kimodo](https://github.com/nv-tlabs/kimodo) | 文本、全身关键姿势、手脚位置/旋转、根路径约束生成动作；SOMA 可导出 BVH | 代码 Apache-2.0；SOMA-RP 权重为 NVIDIA Open Model License，可按条款商用；SMPL-X 变体是不同的研究许可 | 优先验证 SOMA-RP-v1.1，不选择 SMPL-X 变体 |
| [GEM-X](https://github.com/NVlabs/GEM-X) | 单个视频恢复身体与手部运动、世界空间轨迹，输出 SOMA 参数 | 代码 Apache-2.0；模型 NVIDIA Open Model License；检测器和人体模型等依赖另有条款 | 第二阶段候选，先验证完整依赖链和本机显存 |
| [FreeMoCap](https://www.freemocap.org/) | 两台以上普通相机配合标定，重建自演动作；可进入 Blender 流程 | 免费开源，仓库为 AGPL；使用输出、修改/分发程序、提供网络服务的义务不能混为一谈 | 有拍摄空间时考虑，优先以独立工具交换文件，集成方式仍需许可复核 |
| [Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) | 现成动作库和自动绑定，不是文本动作生成 | 官方 FAQ 允许动画用于商业游戏；不支持 Enterprise/Federated ID，且列明中国国家代码账户不可用 | 仅在账户和素材条款允许时作为现成动作补充，不作为核心依赖 |
| [HY-Motion 1.0](https://github.com/Tencent-Hunyuan/HY-Motion-1.0) | 文本生成人体动作 | 自定义社区许可，不是 Apache/MIT；地域和商业规模有约束，见下文 | 不作为本项目默认方案 |
| [GVHMR](https://github.com/zju3dv/GVHMR) | 单视频人体运动恢复 | 原仓库许可只允许教育、研究和非营利用途，商用需另行联系授权 | 不按免费商用方案接入 |
| [Cascadeur](https://cascadeur.com/plans) | AI 辅助摆姿、补间和物理修正 | 免费版仅非商用且只能导出 CASC，不能导出 FBX；Indie 有公司收入/融资门槛 | 可另评估付费制作席位，不符合本次免费商用目标 |

### Kimodo 的具体边界

- [SOMA-RP-v1.1 模型卡](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.1)明确列为可商用，
  模型约 282M 参数。权重许可与代码许可不同。
- [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/)
  明确允许商业使用、不主张输出所有权，同时保留使用、再分发及贸易合规条件。
  分发模型与只在内部制作动作不是同一合规场景。
- [官方仓库](https://github.com/nv-tlabs/kimodo)称全 GPU 运行约需 17GB 显存；
  设置 `TEXT_ENCODER_DEVICE=cpu` 可把显存需求降到 3GB 以下。这是官方说明，
  **不是本机实测峰值**；CPU 编码会增加内存压力和等待时间。
- [官方限制](https://research.nvidia.com/labs/sil/projects/kimodo/docs/key_concepts/limitations.html)：
  每条提示最多 10 秒，单类约束建议少于 20 个关键帧；多段提示逐段生成并过渡。
  原始输出仍可能滑步或未准确命中约束，应保留后处理和人工验收。
- 文本优先用清楚的动作描述。模块可把中文需求翻译成英文动作提示，但必须显示
  实际输入，不承诺原生中文理解质量。
- [BVH 导出说明](https://research.nvidia.com/labs/sil/projects/kimodo/docs/user_guide/cli.html)：
  SOMA 支持 `--bvh`；`--bvh_standard_tpose` 可选择标准 T-pose 参考姿势。
  默认 BVH 参考姿势并非标准 T-pose，不能把它当成目标 NPC 的绑定姿势。
- 模型内部运动关节与对外 SOMA 77 关节表示不是同一个数量概念；输出较多关节
  不等于具备可靠的逐指、面部表演。相关能力必须单独验证。
- 仓库主要在 Linux 开发；Windows 有构建分支，但后处理涉及 CMake/C++ 扩展。
  不能仅凭显卡够用就宣称 Windows 开箱即用。

### 不建议默认采用 HY-Motion 的原因

直接核对的是[原仓库 License.txt](https://github.com/Tencent-Hunyuan/HY-Motion-1.0/blob/master/License.txt)，
而不是第三方包装站的“无限制商用”宣传：

- 第 1(l)、2、5(c) 条：地域排除欧盟、英国和韩国；5(c) 明确涉及模型的输出及结果，
  不只是部署服务器所在地。对有海外版本的项目尤其需要先审查。
- 第 4 条：模型发布日前一个日历月，许可主体全部产品/服务合计月活超过 100 万，
  需要另外获得腾讯授权，不能只按当前制作工具用户数判断。
- 官方 README 给出的最低显存为标准版 26GB、Lite 24GB，且不包含提示改写模块。
  本机 16GB 不满足这套官方基线；社区卸载/量化方案需要额外验证。
- 官方列明不支持无缝循环、原地动作、多人物互动；Lite 不代表低成本直接可用。

### Blender 插件

- [Rokoko Blender 插件](https://github.com/Rokoko/rokoko-studio-live-blender)提供骨骼映射、
  姿势对齐、缩放和动作重定向，可作为免费重定向工具的候选。
  插件免费不代表 Rokoko 云动捕、流送或其他软件服务全部免费。
  README 的“Blender 2.80+”不是已验证 5.2 兼容性的证明。
- [BlendArMocap](https://github.com/cgtinker/BlendArMocap)明确标记停止维护；
  不建议把新模块依赖在它的内置 Python/MediaPipe 环境上。
- Blender 主要承担重定向、清理、烘焙与导出，不是动作生成模型本身。
  升级 Blender 不能自动补齐骨架适配或修复旧插件。

## 现有项目能复用什么

依据 [NPC 迁移专题](../npc-migration.md)、
[`server/npcSupplement.ts`](../../server/npcSupplement.ts) 和
[`src/data/npcSupplement.ts`](../../src/data/npcSupplement.ts)：

- 已支持读取 NPC 目标、扫描 Body FBX、区分新增/更新、清单审核、导入 AnimSequence、
  生成/复用 Montage、Slot 保留及回读。
- 当前导入代码把 FBX 动画绑定到已选中的 `body_skeleton`，没有通用的源骨架重定向。
  **任意 AI 生成的 FBX 不能直接交给该入口并期待自动适配。**
- 已有动作命名是 `A_<NPC>_<Action>.fbx`。新模块应先输出目标骨架兼容文件，再接入
  既有增补审核，不重建 NPC BP/ABP，不覆盖整个动作库。
- 现有镜头预览的人体几何不等于蒙皮动画播放器；骨架/蒙皮加载、动画播放和逐帧
  检查需要新增实现，不能把静态角色预览当成已具备的动作预览能力。

## 建议的最小工作流

1. 选择一个经授权的目标 NPC 骨架和需求，确认输入素材/模型许可。
2. 输入动作文字、时长；需要时提供起止姿势或手脚接触点。
3. 用户明确启动推理，生成一小批候选；显示所有候选、种子、耗时和失败原因。
4. 骨架预览，比较动作语义与时序；技术检查与主观评分分开展示。
5. Blender 将源动作重定向到目标骨架，做接地、曲线清理、根运动和循环处理，
   烘焙后输出 FBX。先复用成熟工具，不自行从零实现通用重定向求解器。
6. 用户审核选定结果，通过既有“动作补充与修改”入口导入 UE4，并在目标 Mesh 上复核。

第一版建议只做离线制作，不把模型放进 UE 游戏运行时，也不在切换工作区时自动加载。
推理环境与 Blender 自带 Python 分离；Blender 作为独立进程处理任务。

工程上需明确：

- 作业由独立业务服务/worker 管理，支持取消、超时、错误信息和结果缓存；
  不把模型部署逻辑堆进 `App.tsx` 或 UE transport。
- 固定模型和依赖版本，记录许可、来源、输入摘要、种子、参数及输出哈希。
  模型下载单独确认，不随镜头沙盘启动或安装自动下载。
- 坐标、单位、FPS、A/T-pose、root/pelvis、扭转骨与辅助骨必须有明确转换配置。
  不能通过重命名骨骼代替真正的绑定姿势对齐和重定向。
- 原地和 Root Motion、循环首尾、Additive 与全身动作分别处理；
  不通过简单删除全部 root 曲线把问题隐藏。
- 质量检查包括脚部接触期间滑移、穿地、旋转突跳、循环首尾位置/速度差、
  动作时长和骨架结构。自动修正后仍需检查目标 NPC 体型与服装。
- VLM 可辅助判断语义，但不是“动作可上线”的证明；默认不隐式调用。
- 所有 UE 写入继续要求精确目标、差异和确认；遵循现有专题的保存与恢复边界，
  不宣称新工作流天然具备跨请求的原子回滚。

## Kimodo 接入细化

以下为 2026-09-12 第二轮源码研究，尚未实现。Kimodo 本轮核对的提交为
`1aece8c124d73d255ceff5086d983b844c9f4e94`，实现时应固定代码、权重和依赖版本，
不让同一个动作任务在更新模型后悄悄改变结果。

### 职责与流程

| 阶段 | 责任方 | 输入与输出 | 当前状态 |
| --- | --- | --- | --- |
| 明确需求 | 镜头沙盘 | NPC、动作语义、时长、起止姿势、原地/根运动要求 | 新模块待实现 |
| 生成候选 | 独立 Kimodo worker | 英文动作提示/约束 -> 原始 NPZ、BVH、种子与日志 | 未安装模型、未实测 |
| 骨架适配 | Blender + 经验证的重定向工具 | SOMA 动作 + 目标绑定骨架 -> NPC 动作 | 需先完成一个骨架族的映射模板 |
| 技术与视觉复核 | 脚本 + 人工 | 目标 Mesh 播放、脚滑、朝向、穿模、循环、根运动 | 不等于现有静态人物预览 |
| 写入目标工程 | 现有 NPC 增补服务 | 仅选定的 Body FBX -> AnimSequence/Montage | 接口可复用，Kimodo 接入待开发 |

**MCP 与生产流程分开：**

- MCP 用于向 AI 展示 Blender 当前状态、检查骨骼/曲线、交互调整和研究工具 API。
- 正式批处理用版本固定的 Blender Python 脚本与结构化作业参数。
  不能每次让 LLM 临时编写完整导出脚本，也不依赖当前激活对象或未保存场景。
- 不让通用 Blender MCP 成为绕过 NPC 写入审核的第二条 UE 通路。
  即使 AI 能执行 Python，也仍由镜头沙盘的精确范围审核决定哪些文件进入工程。

### 一次性骨架准备

现有 `NpcSupplementTarget.skeletonAssetPath` 是 UE 资产路径，**不是可以直接喂给
Blender 的绑定骨架文件**。第一轮应由用户指定经过授权的角色源 FBX，或另行授权
导出只含所需 Mesh/骨架的副本；本轮没有执行这一步。

每个骨架族建立一个版本化适配档案，至少记录：

- UE Skeleton 路径、目标 FBX 哈希、骨骼名称、父子关系和局部绑定矩阵。
- SOMA 到目标骨骼的映射、A/T-pose 修正、体型比例与根骨骼约定。
- 手掌/脚掌接触点、扭转骨和辅助骨处理；没有生成数据的手指采用明确默认姿势，
  不把插值或静态手型描述成 AI 手指表演。
- 导入/导出坐标、单位、采样率和动作命名规则。

同一个骨架族可复用映射，但目标体型、绑定姿势或骨架哈希改变时必须重新检查。
只根据 NPC 名称或男女模板分类不能证明骨架兼容。

### 已核实的格式细节

依据[运动表示](https://research.nvidia.com/labs/sil/projects/kimodo/docs/key_concepts/motion_representation.html)、
[格式转换](https://research.nvidia.com/labs/sil/projects/kimodo/docs/user_guide/motion_convert.html)及
[本轮 BVH 导出源码](https://github.com/nv-tlabs/kimodo/blob/1aece8c124d73d255ceff5086d983b844c9f4e94/kimodo/exports/bvh.py)：

1. Kimodo 使用右手系、Y 向上、+Z 向前；不能直接当作 UE 的 Z-up/X-forward。
   坐标转换只执行一次，并用目标骨架实际朝向校准，不照搬镜头预览的角色缩放。
2. 内部位置为米，当前 BVH 导出代码将位置和骨偏移乘以 100，写成厘米。
   若 Blender 工作场景约定米制，BVH 导入需显式转换；不能把 BVH 和 NPZ 当作
   相同长度单位，也不能叠加角色导入缩放造成百倍误差。
3. 导出的 `Root` 是零位移包装骨，实际根位移与旋转在 `Hips`。
   **读取 `Root` 的平移曲线不会得到角色真实运动轨迹。**
   UE Root Motion 需要按目标骨架约定把水平轨迹/朝向分配给真实根骨，保留 pelvis
   的身体起伏；原地动作也不能简单删除所有 Hips 平移。
4. 默认 BVH 参考姿势不是标准 T-pose，应显式使用 `--bvh_standard_tpose`。
   30 个运动关节扩展成 77 个输出关节时包含默认放松手型，不代表生成了独立指部动作。
5. 生成按 30 FPS 处理。保留 NPZ 中的接触、局部/全局旋转与根轨迹；
   BVH/FBX 是交换文件，不替代原始结果和生成参数。
6. 本地 Blender 往返测试已证实 FBX 默认导入偏移为 1 帧。正式脚本必须明确帧起点，
   核对采样数量和播放区间，不能把默认偏移当成模型生成误差。

部署后可验证的 CLI 形态如下，**本轮未执行，首次运行可能自动下载模型**：

```powershell
$env:TEXT_ENCODER_DEVICE = "cpu"
kimodo_gen "A person stands still and waves their right hand." `
  --model Kimodo-SOMA-RP-v1.1 --duration 4 --num_samples 1 `
  --seed 1201 --bvh --bvh_standard_tpose --output "<job-directory>/candidate_1201"
```

生产环境建议由 worker 逐候选调用，每个候选明确独立种子和输出目录；保留所有结果，
不要把一次批量随机状态误写成每个样本都有同一个可单独重放的种子。
`TEXT_ENCODER_DEVICE=cpu` 只是一种候选部署方式，仍要实测与 UE、Blender 同时运行时
的系统内存、显存和生成耗时。后处理依赖 CMake/C++，不能为安装省事就静默关闭脚滑修正。

### 复用当前审核接口

实际接口来自 [`src/ue/client.ts`](../../src/ue/client.ts) 和
[`server/npcSupplement.ts`](../../server/npcSupplement.ts)：

1. `scanNpcSupplementTarget()`：由用户显式读取目标工程/NPC，获得目标 Skeleton。
2. 新模块只把用户采用且验证通过的 `A_<NPC>_<Action>.fbx` 放到当前任务的独立暂存
   目录，不混入历史 `_Face` 文件或整个动作库，避免自动配对到无关面部动画。
3. `inspectNpcSupplementPlan()`：传入 `kind: "actions"`、目标信息、
   `sourceDirectory` 和精确的 `includedSourceFiles`，生成新增/更新审核清单。
4. 用户确认后调用 `applyNpcSupplement(plan)`，携带该清单的 `reviewToken`。
   继续复用目标工程校验、脏资产检查、Skeleton 回读和 Montage Slot 规则。
5. 在 UE 目标 Mesh 上复核后才将作业标为已导入；“文件导出成功”和“UE 可正确播放”
   必须是两个不同状态。

当前审核令牌是清单 JSON 的 SHA-256，源文件复核使用路径范围与修改时间，
**不是每个 FBX 的内容哈希**。新模块需要另存源/目标骨架和输出内容哈希，
并在交接前复核、保持批准后的暂存文件不变；不能声称现有令牌已经覆盖此保证。

建议新增独立 `motionAuthoring` 业务服务与作业目录，前端只维护需求、候选和审核状态，
UE `services/routes` 继续复用现有增补入口。生成进度应来自真实阶段/采样步回调，
尚无回调时显示阶段和已用时，不编造精确百分比。

## 官方 Blender MCP 配置

[Blender 官方页面](https://www.blender.org/lab/mcp-server/)确认有 Blender Lab MCP，
但也明确说明 Blender 不内置 LLM 连接能力，必须分别安装扩展、MCP 服务并配置客户端。
本轮使用官方发布 `v1.0.3`，不是 `ahujasid/blender-mcp` 社区项目。

### 已完成

- 从 `projects.blender.org/lab/blender_mcp` 固定获取
  `2cea8d566dde07fbac28a61d698909d69724e853`，安装其 `mcp` 子目录。
  官方项目和社区项目存在相同的 Python 包名，不能用未指定来源的
  `uvx blender-mcp` 代替这一安装。
- 独立环境位于 `%LOCALAPPDATA%/BlenderMCP/venv`；入口是
  `python -m blmcp --transport stdio`，应用版本 1.0.3，实测 MCP SDK 1.30.0。
  握手显示的版本来自 SDK，不应误认成插件版本。
- 官方扩展 ZIP 的 9 个文件与发布标签源码比较一致，仅归一化了 Git Windows 换行。
  扩展安装到 Blender 5.2 用户仓库，模块名 `bl_ext.user_default.mcp`。
- TRAE CN 的 `%APPDATA%/Trae CN/User/mcp.json` 新增 `blender-official`，
  保留原有服务器及其启停状态；编辑前已备份到 `%LOCALAPPDATA%/BlenderMCP/backups`。
- `BLENDER_MCP_HOST=127.0.0.1`、`BLENDER_MCP_PORT=9876`；
  `BLENDER_PATH` 指向正式安装的 Blender 5.2。9876 是内部 TCP 桥，不是 HTTP MCP URL；
  TRAE 通过 stdio 启动服务，没有开放 HTTP/CORS 接口。
- 扩展要求允许 Blender Online Access；已启用这一必要偏好，但它并不是仅允许本地
  网络的防火墙。服务器监听实际核对为 `127.0.0.1`。
- 关闭扩展的 Auto Start；普通启动 Blender 不开 MCP。开始菜单
  `Blender 5.2.1 LTS (MCP)` 会显式启动桥接，关闭 Blender 即关闭该监听。
- 使用配置中的真实命令完成 MCP initialize、tools/list 和两个只读查询，
  发现 26 个工具，成功读回 `get_blendfile_summary_datablocks` 与
  `get_objects_summary`，测试场景为默认 Cube/Camera/Light。

TRAE 需要刷新/启用 `blender-official` 并完成首次授权，必要时重载窗口或开启新会话。
协议客户端验证不等于当前对话的工具列表已经刷新，本轮不自动重启用户 IDE。

### 安全和使用边界

- 官方明确警告 MCP 可执行任意 Python、访问本机文件与网络。
  源码中的 `weak_sandbox` 也明确不是安全隔离，不能把少量操作拦截当成完整保护。
- 本机 TRAE 既有配置开启全局 MCP 自动运行，本次未扩大或改动该全局设置；
  因此不能承诺执行类工具每次都会要求点击确认。正式业务制作建议关闭自动运行，
  或在专用、无敏感数据的工作环境中使用。
- 执行修改、保存、导出、打开生产文件之前必须由用户明确授权。当前只做只读查询，
  未通过 MCP 创建动作、修改业务场景或访问 UE。
- 带 `_for_cli` 的查询可能为同一个脏文件创建临时副本，不能只根据工具名称或
  `readOnlyHint` 推断绝对无磁盘写入；本轮没有调用这些变体。
- MCP 不包含 Kimodo、不自动下载动作权重，也不等于已安装骨架重定向工具。

## 下一步验收建议

在用户确认模型下载和测试资产范围后，先做“一个目标 NPC、五类短动作”的离线试验，
再决定是否开发完整工作区：

- 为每类动作固定需求与种子批次，保留全部尝试，不只统计精选成功样本。
- 对比现有动作复用/人工制作的耗时，记录生成等待、重定向、人工修正总时间。
- 验证 Blender 输出与 UE4 实际导入后的朝向、尺寸、骨架、根运动和播放结果。
- 检查相同动作在不同体型 NPC 上能否复用，识别必须逐骨架维护的部分。
- 把可直接采用、修正后采用、拒绝三类结果分开统计。

没有上述实测前，不承诺节约比例、单动作生产成本或替代动画师的能力。

## 本次环境与执行边界

- 只读检测：Windows x64、RTX 4080 16GB、约 32GB 系统内存、原 Blender 4.5.3 LTS。
- [官网稳定版](https://www.blender.org/download/)核对为 Blender 5.2.1 LTS，
  发布于 2026-08-25。第一轮使用官方 ZIP 并行安装；用户随后明确不保留旧版，
  第二轮已改用官方 MSI 正式安装，不使用测试版或第三方重打包。
- 官方卸载程序已移除 4.5.3，残留 Python 缓存及重复的 5.2.1 便携副本也已清理；
  历史个人偏好文件保留，不保留旧版程序。`.blend` 已注册给正式安装的 5.2.1。
- 安装包对照[官方 SHA-256](https://download.blender.org/release/Blender5.2/blender-5.2.1.sha256)
  核验，MSI 与正式安装的 `blender.exe` 的 Blender Foundation 数字签名有效，
  版本为 5.2.1 LTS，build hash 为 `9e2066aef7ef`。
- 开始菜单提供 `Blender 5.2.1 LTS` 和 `Blender 5.2.1 LTS (MCP)` 入口。
- 用临时生成的双骨骼、30 FPS、1-31 帧动画完成 FBX 导出/回读验证：骨骼名称、
  动画帧范围、约 45 度中间姿势与相同首尾姿势均通过。没有使用业务素材。
  首次检查发现默认 FBX 导入会增加 1 帧偏移；测试显式设置 `anim_offset=0.0`
  后通过，正式转换流程也必须明确帧起点。
- 官方 MCP 扩展兼容性与只读通信已经验证；动作模型推理、重定向插件、
  目标 NPC 骨架适配与 UE 导入不属于本次已验证结果。
- 未改动动作模块代码，未提交、推送、发布或覆盖已安装的镜头沙盘。
