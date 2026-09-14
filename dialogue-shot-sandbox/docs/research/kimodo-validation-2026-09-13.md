# Kimodo 离线验证记录

> 日期：2026-09-13。状态：部分验证通过，尚未生成文本驱动动作，未接入运镜助手 UI。
> 用户授权开始离线验证与制作；未指定业务 NPC 源资产，未访问 UE/Excel。

2026-09-14 后续已经改用用户级 MSYS2 工具链完成原生后处理编译、无文本约束动作
生成和 Blender 动态往返，见[约束动作验证记录](kimodo-constraint-validation-2026-09-14.md)。
下文保留 2026-09-13 当时的环境与结论。

## 实际完成

| 项目 | 结果 |
| --- | --- |
| 独立 Python 环境 | Python 3.11.6，位于 `%LOCALAPPDATA%/Kimodo/venv` |
| Kimodo Python 主程序 | 已安装；代码固定至 `1aece8c124d73d255ceff5086d983b844c9f4e94` |
| CUDA | PyTorch 2.10.0+cu128，RTX 4080，GPU 矩阵运算检查通过 |
| Python 依赖 | `uv pip check` 检查 84 个包通过；Transformers 5.1.0 |
| 动作模型 | SOMA-RP-v1.1 公开权重已下载，约 1.13 GB，大小及 LFS SHA-256 校验通过 |
| 权重加载 | 完全离线加载到 GPU 成功；30 FPS、77 个输出关节 |
| Blender 格式 | 官方 SOMA 标准 T-pose BVH -> Blender 5.2.1 -> FBX -> 回读通过 |
| MotionCorrection | 尚未编译安装，缺 Windows SDK |
| 文本编码器 | 尚未安装；Llama 3 基座下载要求账号授权，匿名访问返回 HTTP 401 |
| 文本动作生成 | 未执行，无生成质量或生成耗时结论 |
| 真实 NPC 重定向、UE 导入 | 未执行 |

动作模型固定到 Hugging Face revision
`6c9233af1180b8151e3c4703477104af5dce9dd5`，`model.safetensors` 为
1,133,185,036 字节，SHA-256：

```text
ef0a0ca45a6089ab4532dde609785771ae3f38755b4ae6cf314b0213e07cd4a3
```

加载测试以空文本编码器占位，仅构造动作模型，没有调用采样。加载耗时约 1.03 秒，
PyTorch 统计的峰值 allocated 显存约 1.094 GiB；不包含文本模型、采样、后处理，
不是整个制作流程的显存或速度指标。

## 新发现的依赖与授权边界

上一轮研究只明确了 Kimodo 的代码/动作权重许可，实际部署进一步确认：

1. 默认文本编码器依赖
   `McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp` 及 supervised adapter。
2. MNTP 仓库主要提供 adapter，而不是完整 8B 权重；其 `adapter_config.json`
   指向 `meta-llama/Meta-Llama-3-8B-Instruct`。
3. [Llama 官方模型页](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct)
   使用人工审批的 gated access。测试匿名访问固定 revision 的 `config.json`
   返回 401，要求访问许可和认证。本机未发现 `HF_TOKEN` 环境变量或默认 Token 文件。
4. 需要用户以有权代表使用主体的账号申请访问、接受相应条款，并在本机登录。
   不把 Token 写入聊天、项目配置、脚本或版本库，不寻找镜像绕过访问控制。
5. LLM2Vec 仓库的 MIT 标签不能覆盖 Llama 基座的 Community License。
   未来分发/提供包含该模型的产品服务还需核对署名、使用政策及商业规模条款。
6. 测试开始时可用 RAM 约 8.8 GB。8B 文本模型 BF16 参数约 16 GB，
   因而 `TEXT_ENCODER_DEVICE=cpu` 不意味着当前内存一定足够。
   授权后需先复核 RAM，再评估分阶段编码/缓存/释放或经过验证的卸载方式。
   不静默更换文本编码器，因为特征空间不兼容可能使动作语义失效。

## Windows 构建状态

- 现有 Visual Studio 2022 Community MSVC 14.44 存在，但没有 Windows SDK。
- 初次 Visual Studio generator 未识别编译器；显式加载 Developer Shell 并使用 Ninja
  后定位到真正缺项：`rc.exe` / `mt.exe` 及 SDK 库。
- 已安装独立环境内的 CMake 3.31.6、Ninja 1.13.0、pybind11 2.11.1。
- 尝试从微软官方来源安装 Windows SDK 10.0.26100.7705 的 Desktop C++ x64 功能，
  winget 已校验安装程序哈希，但管理员授权未确认。等待后撤销本次尚未执行的安装，
  不宣称 SDK 安装成功，不修改系统安全策略。
- 使用官方支持的 `SKIP_MOTION_CORRECTION_IN_SETUP=1` 暂时只安装 Python 主程序。
  **这是分阶段安装状态，不是完整 Kimodo 安装通过，也没有关闭后处理去宣称生成成功。**
- 已准备本地 `complete_postprocess_install.ps1`，在 SDK 安装成功后重新构建完整包；
  它先检查 `rc.exe` / `mt.exe`，不满足条件则明确停止。

## Blender 格式验证

输入是源码自带的 `kimodo/assets/skeletons/somaskel77/somaskel77_standard_tpose.bvh`，
只有一帧静态绑定姿势，不是 AI 生成动作。

- 显式厘米到米缩放 `0.01`，Y-up/+Z-forward 转 Blender 场景坐标。
- 读取 78 个骨骼：77 个 SOMA 关节加包装 `Root`。
- 骨架关节点高度约 1.764 m；导出前后骨骼名称集合一致。
- 回读最大位置差约 `1.0e-6 m`，最大最短旋转差约 `0.00069 rad`。
- 四元数用 `abs(dot(q1, q2))` 计算最短旋转角，避免等价 `q/-q` 被误报为 360 度差。
- BVH 的末端关节存在零长度，Blender 会提示并调整可视骨长。
  本次只核验关节姿势与位置，不把可视骨长、蒙皮或手指效果宣称为已验证。
- 保存了 `.blend`、`.fbx` 和 JSON 报告，没有写生产目录。

## 本地复跑入口

本地工作目录为 `%LOCALAPPDATA%/Kimodo`，不放进产品安装包或 Git。

| 文件/目录 | 用途 |
| --- | --- |
| `source/` | 固定版本的官方源码 |
| `checkpoints/Kimodo-SOMA-RP-v1.1/` | 已校验的公开动作权重 |
| `validate_pipeline.py` | 权重加载或无文本条件采样的技术测试，不允许冒充文字语义测试 |
| `validate_blender.py` | 独立 Blender 进程中的 BVH/FBX 往返检查 |
| `complete_postprocess_install.ps1` | SDK 就绪后的完整构建入口 |
| `runs/20260913-load-check/validation.json` | 已通过的权重加载记录 |
| `runs/20260913-soma-format-verified/` | 已通过的静态骨架格式记录及文件 |

`validate_pipeline.py --load-only` 已执行；不带该标志的采样分支尚未执行，
并保持 `post_processing=True`。不得把静态样本或空文本技术测试纳入动作语义通过率。

## 继续制作的前置条件

1. 用户取得官方 Llama 3 模型访问权限，在本机完成 Hugging Face 登录。
   已安装的 CLI 可使用以下命令，Token 通过交互提示输入，不放在命令参数中：

   ```powershell
   & "$env:LOCALAPPDATA\Kimodo\venv\Scripts\hf.exe" auth login
   ```

2. 重新启动 SDK 安装并由用户确认管理员提示，完成原生后处理构建及调用验证。
3. 先生成一个固定种子的 4 秒短动作，记录文本编码、采样、后处理时间与峰值内存，
   在 Blender 检查实际运动。静态格式检查不能替代此步骤。
4. 用户指定一个有使用权限的 NPC 源 FBX（Mesh + 绑定骨架），再建立首个重定向模板。
5. 真实 NPC 播放验收通过后，再授权精确的 UE 测试目标、导入范围与 BP 注册检查。

架构和现有审核接口见[动作制作研究](npc-motion-authoring-2026-09-12.md)。
本轮没有实现运镜助手前端、升级产品版本、提交、发布或覆盖业务资产。
