# Seria QA Overlay 开发入口

## 边界

- 本目录是 Seria QA Overlay 与可选 DLSS5 安装包的唯一源码位置。
- `C:\trunk` 只作为默认构建依赖和部署目标，不保存本工具源码。
- QA 与 DLSS5 必须保持独立清单、独立 ZIP、独立恢复目录。
- QA 可以独立安装；未安装 DLSS5 时不显示画面诊断或 DLSS5 警告。
- 两个包共享相同哈希的 ReShade `dxgi.dll`，必须支持任意顺序叠加安装。
- 任务功能只读，不得接取、完成、删除、提交或改变任务追踪状态。

## 入口

| 职责 | 文件 |
| --- | --- |
| 产品与交互边界 | `PRODUCT.md`、`DESIGN.md` |
| 技术架构与协议 | `TECHNICAL_SPEC.md` |
| QA 使用说明 | `README.txt`、`QUICK_START_CN.txt` |
| DLSS5 使用说明 | `README-DLSS5.txt` |
| 安装与校验 | `Reapply-DLSS5.ps1`、`manifest*.json` |
| 构建分发包 | `Build-SeriaQA-Distribution.ps1` |
| Overlay 源码与测试 | `src/SeriaQAOverlay/` |

## 验证

在本目录执行：

```powershell
.\src\SeriaQAOverlay\Build-SeriaQAOverlay.ps1
.\Build-SeriaQA-Distribution.ps1 -Package All
```

未设置 `SERIA_TRUNK` 时，构建测试默认从 `%SystemDrive%\trunk` 获取项目 Lua
解释器和模块路径。最终还需分别执行 QA-only、DLSS5-only 与叠加安装校验。

`payload` 中的大型第三方 DLL/addon 与 shader、`dist`、`build`、日志和备份仅在
本机保留，不提交 Git。更新这些二进制后必须同步 manifest 哈希并重新构建验证。
