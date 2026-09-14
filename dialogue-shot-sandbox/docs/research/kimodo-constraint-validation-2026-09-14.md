# Kimodo 约束动作验证记录

> 日期：2026-09-14。状态：无文本约束生成、原生后处理、Blender 动态格式链路已通过。
>
> 本记录不是文本语义质量验收、目标 NPC 重定向验收或 UE 导入验收。

## 验证目标

在 Llama 3 文本编码器仍等待 Hugging Face 审核时，先验证其余制作链路：

```text
稀疏关键姿势与原地约束
  -> Kimodo SOMA-RP-v1.1
  -> MotionCorrection
  -> NPZ / 标准 T-pose BVH
  -> Blender 5.2.1
  -> FBX
  -> Blender 回读
```

没有使用文字提示、第三方镜像、业务 NPC、UE 或 Excel。本次测试动作不能证明模型
理解“挥手”语义，只证明它能在给定关键姿势之间生成连续动作并通过后续格式链路。

## 环境补齐

上一轮因系统缺少 Windows SDK，MotionCorrection 没有编译。本轮不再等待管理员
UAC，改用 MSYS2 官方 UCRT64 用户级工具链：

- 官方 `msys2-base-x86_64-20260611.sfx.exe`，对照同发布页 `.sha256` 后解压；
  SHA-256 为 `c105946e64e08f099ac0e4647461ce762b95333ad211777666476a9a41451d65`。
- 安装于 `%LOCALAPPDATA%/Kimodo/toolchains/msys64`，没有写系统 PATH 或安装系统服务。
- 使用 MSYS2 签名仓库中的 UCRT64 GCC 16.2.0 与 Make 4.4.1。
- Kimodo `setup.py` 的官方 MinGW 路径完成 C++17 扩展编译，并按其逻辑复制
  `libstdc++-6.dll`、`libgcc_s_seh-1.dll` 和 `libwinpthread-1.dll`。
- `_motion_correction.cp311-win_amd64.pyd` 生成并通过 Python 导入检查。
- 独立环境执行 `uv pip check`，84 个包兼容。

`%LOCALAPPDATA%/Kimodo/complete_postprocess_install.ps1` 已改为复用该用户级工具链，
不再依赖 Windows SDK 或管理员权限。

## 测试动作

测试使用已经校验的 `Kimodo-SOMA-RP-v1.1`，代码与权重版本保持上一轮固定值。

输入由脚本生成，不包含文本：

- 120 帧，30 FPS，共 4 秒。
- 固定种子 `1201`，100 个扩散步骤。
- 文本特征走空文本的零条件分支。
- CFG 使用 `separated`，文字权重 `0.0`、约束权重 `2.0`。
- 每 5 帧约束水平 Root 为原点且朝向不变。
- 在 1、25、43、61、79、97、120 帧提供完整身体关键姿势：
  双脚和躯干保持站立，右臂从放下抬至头侧并往复摆动，最后放下。
- 启用官方 MotionCorrection 后处理，没有使用 `--no-postprocess`。

测试先用 10 步完成技术冒烟，再以 100 步生成最终样本。早期仅给手部目标位置的
尝试不能被后处理精确恢复，因为后处理消费的是一致的关节旋转/Root，而不是任意覆盖的
末端位置；最终版本改用由局部骨骼旋转经 FK 得到的完整身体关键姿势。失败尝试没有
覆盖或混入最终目录。

## 生成结果

最终结果位于：

```text
%LOCALAPPDATA%/Kimodo/runs/20260914-constrained-gesture-final/
```

| 指标 | 实测值 |
| --- | ---: |
| 模型加载 | 约 1.14 秒 |
| 100 步生成与后处理 | 约 2.24 秒 |
| PyTorch 峰值 allocated 显存 | 约 1.13 GiB |
| PyTorch 峰值 reserved 显存 | 约 1.16 GiB |
| 最大完整姿势约束误差 | `2.98e-7 m` |
| 最大右手约束误差 | `1.91e-7 m` |
| 水平 Root 最大漂移 | `0.00440 m` |
| 左脚接触期间平均单帧滑移 | `0.000272 m` |
| 右脚接触期间平均单帧滑移 | `0.000308 m` |
| 左/右脚接触期间最大单帧滑移 | `0.00110 / 0.00122 m` |

在相同代码、权重、参数和种子下独立重复 100 步采样，NPZ 与 BVH 的 SHA-256
均逐字节一致；该测试配置在本机可复现。此结论不外推到未来依赖、驱动或模型版本。

脚滑指标按相邻两帧均判定接触时的水平位移统计，不等于目标 NPC 上的视觉验收。
当前每只脚都有 119 对接触帧，说明模型把整段动作识别为站立接触；最大约 1.2 mm/帧
仍需要在真实角色、鞋底和地面尺度下判断是否可接受。

关键姿势和插值中间帧的正面/侧面检查显示：

- 右臂完成放下、抬起、摆动、放下的完整时序。
- 关键姿势之间不是简单逐帧复制，存在连续的过渡姿势。
- 双脚在骨架视图中持续接地，躯干没有明显水平漂移。
- 这只是无蒙皮骨架检查，未覆盖肩部蒙皮形变、衣物穿插、手指表演或目标体型。

## Blender 动态往返

生成 BVH 使用标准 T-pose、SOMA 77 关节和 30 FPS。Blender 5.2.1 在
`--factory-startup --disable-autoexec` 的独立后台进程中完成：

1. BVH 导入，显式厘米到米缩放 `0.01`。
2. 读取 120 帧、77 个 SOMA 关节加包装 `Root`。
3. 保存 `.blend`，烘焙并导出只含 Armature 的 FBX。
4. 清空场景，用 `anim_offset=0.0` 回读 FBX。
5. 对首帧、中间帧和末帧比较全部骨骼的世界姿势。

| 指标 | 实测值 |
| --- | ---: |
| 骨架关节点高度 | 约 1.768 m |
| 最大世界位置往返误差 | `8.45e-7 m` |
| 最大最短旋转误差 | `0 rad` |
| 骨骼名称、帧范围、FPS | 一致 |

Blender 对零长度末端关节给出预期警告；本次比较关节姿势，不把显示骨长当作蒙皮结果。

## 合成骨架重定向

在没有业务 NPC FBX 的前提下，额外建立了一个骨骼名称全部改变、横向/纵深/高度比例
分别为 `0.88 / 0.92 / 1.08` 的合成目标骨架，用于验证“源 SOMA 动作 -> 不同骨架
-> 烘焙 -> FBX”的工程链路。

测试固定使用 Rokoko Blender 插件 `v1.4.3`、commit
`b031e5a001b3d87e62359d18159c4e4ab479c732`。需要注意：

- 官方支持文档说明动画重定向不要求付费账户，但插件完整的流送/登录能力是另一范围。
- 仓库 README 徽章称 MIT，实际 `LICENSE.md` 是 LGPL-3.0；正式集成前必须按实际
  许可证处理，不能依据 README 徽章。
- 插件能在 Blender 5.2.1 注册三项重定向操作，但原版重定向仍调用
  Blender 5 已移除的 `Action.fcurves` 与 `Bone.select` API，不能直接投入使用。
- 本地验证副本对 `Bone.select` 做版本分支，并在测试驱动中用 Action Slot /
  Channelbag 读取 FCurve、单次 NLA bake；没有篡改上游提交标识，也没有把补丁写入产品。
- 完整插件仍提示缺少登录/流送依赖；本次只验证离线重定向，没有登录 Rokoko、
  启动接收端口或安装到 Blender 全局插件目录。

适配后合成测试通过：

| 指标 | 实测值 |
| --- | ---: |
| 映射骨骼 | 77 |
| 动画范围 | 1-120 帧 |
| 关键帧右手累计位移 | 约 1.729 m |
| 左/右脚关键帧位置范围 | 各约 `3.73e-9 m` |
| 目标 FBX 回读最大映射关节位置误差 | `5.09e-7 m` |

第一次目标 FBX 导出暴露出另一项默认行为：若不显式设置场景结束帧，Blender 会把
120 帧动作烘焙到默认的 250 帧。最终脚本在导出前固定 `frame_start=1`、
`frame_end=120`，回读范围一致。

这证明重命名骨架和比例变化的离线重定向链路可以工作，但合成骨架与真实 NPC 的
绑定姿势、扭转骨、辅助骨、蒙皮权重和 Root Motion 结构不同，不能替代真实角色验收。

## 产物

最终目录包含：

| 文件 | 用途 |
| --- | --- |
| `constraints.json` | 可复查的 Root 与完整身体关键姿势 |
| `constrained_gesture.npz` | Kimodo 原始结果 |
| `constrained_gesture.bvh` | 标准 T-pose SOMA 动作 |
| `constrained_gesture_soma.blend` | Blender 动态场景 |
| `constrained_gesture_soma.fbx` | 已完成 Blender 回读验证的测试 FBX |
| `constrained_gesture_preview.gif` | 15 FPS 正面/侧面骨架预览 |
| `contact_sheet_verified.png` | 关键姿势检查图 |
| `contact_sheet_inbetweens.png` | 非约束中间帧检查图 |
| `validation.json` | 生成性能和约束指标 |
| `blender_validation.json` | Blender 动态导入、FBX 导出与回读指标 |

合成重定向结果另存于：

```text
%LOCALAPPDATA%/Kimodo/runs/20260914-synthetic-retarget-final/
```

本地可复跑脚本：

- `%LOCALAPPDATA%/Kimodo/generate_constrained_gesture.py`
- `%LOCALAPPDATA%/Kimodo/render_motion_contact_sheet.py`
- `%LOCALAPPDATA%/Kimodo/validate_blender.py`
- `%LOCALAPPDATA%/Kimodo/complete_postprocess_install.ps1`

这些是验证工具，不随镜头沙盘发布；未把模型、编译器或缓存写入 Git。

## 剩余边界

仍未完成：

1. **文本语义生成**：等待 Llama 3 官方访问批准及本机登录。
2. **目标 NPC 骨架适配**：需要用户指定有权使用的 Mesh + 绑定骨架 FBX。
3. **蒙皮视觉验收**：需在真实 NPC 体型、服装、鞋底和手型上检查。
4. **UE 导入与 BP 注册**：需用户指定测试工程和精确资产范围后，走现有审核流程。
5. **运镜助手前端/worker**：外部链路已证明可行，但产品接入尚未实现。

因此当前最准确的结论是：**Kimodo 动作模型、约束生成、原生后处理、动态 BVH/FBX
链路已经可用；文本输入、目标角色和 UE 生产闭环仍未验收。**

前期许可与架构研究见[动作制作研究](npc-motion-authoring-2026-09-12.md)，上一轮安装
证据见[离线验证记录](kimodo-validation-2026-09-13.md)。
