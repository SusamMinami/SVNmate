# Wwise 音频迁移工具

本目录是 SVNmate 受管的 `seria-wwise-migration` bundle 源码。

## 边界

- 只提交程序、工作流、测试、版本和发布脚本。
- 不提交 `GeneratedSoundBanks_2022`、Wwise 工程内容、业务音频、日志或生成凭证。
- 默认数据源为 `C:\Sound\SeriaWwiseProject\GeneratedSoundBanks_2022`；
  `SERIA_WWISE_PROJECT_ROOT` 或 `SERIA_WWISE_SOURCE_ROOT` 可覆盖。
- SVN 更新必须通过 `SVNmateCLI.exe` / IPC v2，不直接执行裸 `svn update`。
- 源与目标需要更新时作为一个批量请求提交；不同 WC Root 由 core 并行，同 Root 串行。

## 验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Tests\Test-WwiseFullMigration.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Tests\Test-WwiseUnrealReconcile.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Build-SeriaWwiseMigration.ps1 -OutputPath "$env:TEMP\SeriaWwiseMigration-test.exe"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Publish-SeriaWwiseMigrationModule.ps1 -OutputRoot "$env:TEMP\SeriaWwiseMigration-module"
```

只有用户明确授权发布时才为最后一条命令增加 `-Publish`。
