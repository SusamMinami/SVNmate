# Seria Config Rust Core

状态：第一阶段可运行原型，尚未替换任何产品的生产数据读取路径。

该 workspace 为镜头沙盘与 ConfigLinker 提供共享的只读配置核心。每个产品应
私有打包对应版本，不安装全局 DLL，也不共享常驻进程。

## 当前范围

- UTF-8 BOM、标准引号和多行字段的 CSV 解析。
- 按成员名、中文表头或中文表头前缀定位列。
- 保留真实 CSV 行号和重复 ID。
- 加载 `m目标物表.csv`、`NPC表.csv`、`m模型资源表.csv`。
- 建立目标物、NPC、模型资源正反向多值索引。
- 支持目标物 ID、NPC ID、NPC 名称和模型资源 ID 查询。
- 加载失败时保留上一份成功数据库。
- 版本化 JSON Lines 协议 `seria-config.v1`。

镜头沙盘的对白、任务、地图专用字段和 ConfigLinker 的武器关系将在后续阶段
作为独立领域模块接入。路径选择、正式服限制、UI 状态和写入逻辑仍由各产品负责。

## 目录

| Crate | 职责 |
| --- | --- |
| `seria-config-core` | 双表头解析、公共记录、索引和关系查询 |
| `seria-config-service` | 保持数据库驻留的 stdin/stdout JSON Lines 服务 |

## 构建与验证

当前机器的 Visual Studio 未安装 Windows SDK，因此使用已安装的 GNU Rust
工具链。Windows SDK 完整的环境可直接使用默认 MSVC 工具链。

```powershell
cd rust
rustup run stable-x86_64-pc-windows-gnu cargo fmt --all -- --check
rustup run stable-x86_64-pc-windows-gnu cargo clippy --workspace --all-targets -- -D warnings
rustup run stable-x86_64-pc-windows-gnu cargo test --workspace
rustup run stable-x86_64-pc-windows-gnu cargo build --release
```

## 协议

每行一个 JSON 请求和响应。`id` 原样返回，用于并发调用方匹配响应。

```json
{"id":1,"command":"hello"}
{"id":2,"command":"load","csvDirectory":"C:\\trunk\\doc\\csvdir"}
{"id":3,"command":"query","kind":"npc","value":113}
{"id":4,"command":"status"}
{"id":5,"command":"shutdown"}
```

服务只在一次成功加载后原子替换内存数据库。查询仅返回命中切片，不返回整库，
以免在 Rust 与 JavaScript/Python 之间复制全部配置数据。

## 初始基线

2026-09-14 在本机使用每张表 50,000 行的合成数据，执行三表加载和一次 NPC
关系查询：

| 实现 | 耗时 |
| --- | ---: |
| Rust release 服务（包含进程启动） | 152.2 ms |
| ConfigLinker Python 仓库（不含进程启动） | 705.2 ms |

该单次结果约为 4.63 倍差距，只用于确认原型具备继续集成的价值。它不是正式性能
承诺，也没有覆盖镜头沙盘完整对白数据库、IPC 高频查询或真实 CSV 内容分布。
