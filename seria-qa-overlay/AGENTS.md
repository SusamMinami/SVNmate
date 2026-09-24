# Seria QA Overlay 开发入口

## 边界

- 本目录是 Seria QA Overlay 与可选 DLSS5 安装包的唯一源码位置。
- `C:\trunk` 只作为默认构建依赖和部署目标，不保存本工具源码。
- QA 与 DLSS5 必须保持独立清单、独立 ZIP、独立恢复目录。
- QA 可以独立安装；未安装 DLSS5 时不显示画面诊断或 DLSS5 警告。
- 两个包共享相同哈希的 ReShade `dxgi.dll`，必须支持任意顺序叠加安装。
- 任务浏览、状态采集和导出默认只读；接取、添加、完成、删除、提交或
  改变追踪等写操作可按需求逐项接入，但必须使用审核过的固定白名单、
  严格参数校验，并在 UI 中明确目标、影响范围和提交结果。

## 入口

| 职责 | 文件 |
| --- | --- |
| 产品与交互边界 | `PRODUCT.md`、`DESIGN.md` |
| 技术架构与协议 | `TECHNICAL_SPEC.md` |
| QA 使用说明 | `README.txt`、`QUICK_START_CN.txt` |
| DLSS5 使用说明 | `README-DLSS5.txt` |
| 安装与校验 | `Install-SeriaQA-GUI.ps1`、`Reapply-DLSS5.ps1`、`manifest*.json` |
| 构建 ZIP 与单文件 EXE | `Build-SeriaQA-Distribution.ps1`、`Build-SeriaQA-InstallerExe.ps1`、`src/SeriaQAInstaller/` |
| SVNmate 模块发布 | `Publish-SeriaQAModule.ps1` |
| GM 指令调研 | `GM_COMMAND_RESEARCH.md`、`tools/collect_gm_commands.py` |
| Overlay 源码与测试 | `src/SeriaQAOverlay/` |

## 验证

在本目录执行：

```powershell
.\src\SeriaQAOverlay\Build-SeriaQAOverlay.ps1
.\Build-SeriaQA-Distribution.ps1 -Package All
```

未设置 `SERIA_TRUNK` 时，构建测试默认从 `%SystemDrive%\trunk` 获取项目 Lua
解释器和模块路径。最终还需分别执行 QA-only、DLSS5-only 与叠加安装校验。

完整 GM 清单只生成到 `.generated/`，不得提交公开仓库。新增自动执行入口必须使用
固定白名单；`RunLuaString` 只能执行现有 QA bootstrap，不开放任意 Lua 或命令文本。
高频调试动作可直接执行，不强制二次确认；批量或不可逆操作必须在交互与文档中明确
作用对象和恢复方式。

`payload` 中的大型第三方 DLL/addon 与 shader、`dist`、`build`、日志和备份仅在
本机保留，不提交 Git。更新这些二进制后必须同步 manifest 哈希并重新构建验证。
发布 QA 更新时同步递增 `manifest.json` 的 `moduleVersion` 与插件版本，再显式运行
`Publish-SeriaQAModule.ps1 -Publish`；普通构建和测试不得更新远端固定通道。
