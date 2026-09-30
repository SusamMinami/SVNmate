# Seria Wwise Migration

SVNmate 管理的 Wwise 音频全量迁移工具。完整流程依次执行：

1. 校验源 Wwise 项目与目标 `WwiseAudio` 的 SVN 新鲜度。
2. 通过 IPC v2 调用 SVNmate 更新落后的工作副本。
3. 校验 SoundBanks 生成凭证。
4. 精确镜像 `WwiseAudio` 并处理 SVN Add/Delete。
5. 无界面生成、保存和复核 Unreal `WwiseSoundData`。

工具包不包含 SoundBanks 或 Wwise 工程数据。默认读取：

```text
C:\Sound\SeriaWwiseProject\GeneratedSoundBanks_2022
```

可通过 `SERIA_WWISE_PROJECT_ROOT` 指定 Wwise 项目根，或通过
`SERIA_WWISE_SOURCE_ROOT` 直接指定生成目录。

发布包由 `Publish-SeriaWwiseMigrationModule.ps1` 构建，并通过
`seria-wwise-migration-latest` 固定 Release 通道交给 SVNmate 安装和更新。
