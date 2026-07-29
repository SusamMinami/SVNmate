# Kindle Windows 公共更新通道交接

更新时间：2026-07-29

## 目标

KindleLarkStatus 源码仓继续保持私有，只将 Windows 模块 ZIP 和
`manifest.json` 发布到 SVNmate 公共仓库的独立固定 Release：

```text
tag: kindle-windows-latest
manifest: https://github.com/SusamMinami/SVNmate/releases/download/kindle-windows-latest/manifest.json
package: https://github.com/SusamMinami/SVNmate/releases/download/kindle-windows-latest/KindleLarkStatus.zip
```

该通道与 SVNmate 主程序 `v1.4.1`、ConfigLinker
`config-linker-latest` 相互独立，并保持 `latest=false`。

## SVNmate 侧状态

- `tool_modules.py` 已指向上述公共 manifest。
- 回归测试锁定公共 URL，防止再次指向私有仓库。
- 客户端仍执行 manifest 字段、HTTPS、SHA-256、ZIP 路径和入口文件校验。
- 更新只替换 `KindleLarkStatus.exe` 和公开 `VERSION`。
- 用户配置、OAuth Token、输出、日志和 SSH 私钥不在更新包内。
- 公共 manifest 和 ZIP 已发布，SVNmate 可以匿名检查、安装和更新。

## KindleLarkStatus 侧状态

私有仓库已有提交：

```text
cc78798 Publish Windows module through public channel
```

该提交修改 `.github/workflows/build-desktop.yml`：

- Windows 构建继续生成 `KindleLarkStatus.zip` 和 `manifest.json`。
- manifest 下载地址改为 SVNmate 公共固定 Release。
- 发布目标改为 `SusamMinami/SVNmate` 的 `kindle-windows-latest`。
- 跨仓发布凭据改用 `SVNMATE_RELEASE_TOKEN`。
- 工作流文件在 `main` 更新时可触发一次 Windows 构建，便于首次发布。

私有仓库已经配置 `SVNMATE_RELEASE_TOKEN`，首次 Windows 发布成功。
README 和 `MAINTENANCE.md` 已同步公共通道说明。

## 后续版本发布

1. 更新 KindleLarkStatus 的 `VERSION` 和版本说明。
2. 通过版本标签或 `workflow_dispatch` 运行 `Build desktop clients`。
3. 工作流会覆盖固定 Release 中的 ZIP 和 manifest，并保持
   `latest=false`。
4. 发布后重新执行匿名下载、SHA-256、ZIP 内容和 SVNmate 更新验收。

跨仓 Token 使用 fine-grained PAT，只允许访问 `SusamMinami/SVNmate`，
Repository permissions 仅开启：

```text
Contents: Read and write
```

Secret 名称固定为 `SVNMATE_RELEASE_TOKEN`。不要把 PAT 写入源码、
manifest、日志或本文档。

## 首次发布验收结果

2026-07-29 已完成：

1. 未登录下载 manifest 和 ZIP 成功，manifest 字段为：

```text
id = kindle-lark-status
version = 0.4.0
entrypoint = KindleLarkStatus.exe
```

2. `download_url` 指向 SVNmate 公共固定 Release。
3. ZIP SHA-256 与 manifest 一致：

```text
8e560e33cbeef83359630f410364c4b6295f86c86240166c609d86a11be255f8
```

4. ZIP 只包含 `KindleLarkStatus.exe` 和 `VERSION`。
5. SVNmate 的匿名检查、首次安装、旧版覆盖更新、备份和配置保留验证通过。
6. 发布版 EXE 的隔离 `--check --data-dir` 验证通过。
7. SVNmate 项目的 latest Release 为 `v1.4.1`。
8. 应用内“更新 Kindle”仍只负责 SSH 投放 KUAL 和 Kindle Shell 文件。
