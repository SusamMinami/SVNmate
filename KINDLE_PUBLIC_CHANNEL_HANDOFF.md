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

该通道与 SVNmate 主程序 `v1.4.0`、ConfigLinker
`config-linker-latest` 相互独立，并保持 `latest=false`。

## SVNmate 侧状态

- `tool_modules.py` 已指向上述公共 manifest。
- 回归测试锁定公共 URL，防止再次指向私有仓库。
- 客户端仍执行 manifest 字段、HTTPS、SHA-256、ZIP 路径和入口文件校验。
- 更新只替换 `KindleLarkStatus.exe` 和公开 `VERSION`。
- 用户配置、OAuth Token、输出、日志和 SSH 私钥不在更新包内。

在 Kindle 仓库完成首次发布前，预留 URL 返回 `404`，SVNmate 会显示
“检查失败”；这不影响选择已有 EXE、打开或启动联动。

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

Kindle 仓库本地还保留 README 和 `MAINTENANCE.md` 的未提交说明更新。

## 切换到 Kindle 仓库后的操作

1. 创建 GitHub fine-grained personal access token。
2. Repository access 只选择 `SusamMinami/SVNmate`。
3. Repository permissions 只开启：

```text
Contents: Read and write
```

4. 在私有 `KindleLarkStatus` 仓库进入：

```text
Settings
-> Secrets and variables
-> Actions
-> New repository secret
```

5. Secret 名称必须为：

```text
SVNMATE_RELEASE_TOKEN
```

6. 在 Actions 中重新运行提交 `cc78798` 的 `Build desktop clients`，
   或使用 `workflow_dispatch`，版本填写 `0.4.0`。
7. 提交 Kindle 仓库本地 README、中文 README 和维护文档更新。

不要把 PAT 写入源码、manifest、日志或本文档。

## 首次发布验收

使用未登录请求完成以下检查：

1. manifest 返回 `200`，且字段为：

```text
id = kindle-lark-status
version = 0.4.0
entrypoint = KindleLarkStatus.exe
```

2. `download_url` 指向 SVNmate 公共仓库的
   `kindle-windows-latest/KindleLarkStatus.zip`。
3. 下载 ZIP 并重新计算 SHA-256，必须与 manifest 一致。
4. ZIP 只能包含：

```text
KindleLarkStatus.exe
VERSION
```

5. 用发布版 SVNmate 验证：

```text
未安装 -> 检查 -> 安装 -> 打开
已安装旧版 -> 检查 -> 更新 -> 按原状态重启
```

6. 确认 `%APPDATA%\KindleLarkStatus` 下的配置、Token、输出和日志未被修改。
7. 确认应用内“更新 Kindle”仍只负责 SSH 投放 KUAL 和 Kindle Shell 文件。
