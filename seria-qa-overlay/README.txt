Seria QA Overlay 使用说明
=========================

用途
  供策划和 QA 查看角色当前任务、任务进度与最近完成节点。
  工具只读取数据，不会接取、完成、删除或修改任务。

  QA Overlay 与 DLSS5 已分开发布：
  - 只需要任务工具：安装 Seria-QA-Overlay 压缩包。
  - 需要 DLSS5：另行下载并安装 Seria-DLSS5 压缩包。
  - 两者可以任意顺序安装，也可以同时使用。


第一次安装
  1. 完全退出 Seria.exe。
  2. 解压整个 Seria-QA-Overlay 压缩包。
  3. 双击 Install-SeriaQA.cmd。
  4. 粘贴游戏根目录、Seria.exe 或 Seria\Binaries\Win64 路径。
  5. 安装成功后启动游戏。

  QA 安装不会安装 DLSS5，也不会修改游戏分辨率。


启动任务采集
  1. 启动游戏并进入角色。
  2. 按 Home 打开 ReShade。
  3. 进入“Seria QA > 全部任务”。
  4. 点击“一键启动采集”。
  5. 左上角显示“实时”即表示启动成功。

  工具会自动关闭 ReShade、打开游戏 GM 面板、粘贴并提交只读采集命令。
  如果一键启动失败，可点击“复制启动命令”后手动执行。


每天 trunk 更新后
  trunk 更新会清除插件，请使用桌面快捷方式：

  Restore Seria QA Overlay

  操作顺序：
  1. 等 trunk 更新完全结束。
  2. 确认 Seria.exe 已关闭。
  3. 双击快捷方式，等待显示 Restore completed。
  4. 启动游戏，进入角色后点击“一键启动采集”。

  恢复文件保存在 trunk 外：
  %USERPROFILE%\Documents\Seria-QA-Overlay-Recovery


常用操作
  Ctrl+Home   显示或隐藏左上角任务窗口。
  Home        打开 ReShade。

  在 ReShade 的 Seria QA 页面中：
  - 全部任务：查看、搜索和筛选角色持有的任务。
  - 最近变化：查看本次采集后的任务事件。
  - 显示设置：调整任务窗口开关和背景不透明度。
  - 画面诊断：仅在另行安装 DLSS5 后显示。


常见问题
  显示“未连接”
    确认已进入角色，然后按 Home 点击“一键启动采集”。

  一键启动未生效
    保持游戏窗口在前台后重试，或使用“复制启动命令”手动执行。

  显示“数据暂停”
    点击“一键启动采集”重新连接，并检查 Saved 目录是否可写。

  trunk 更新后插件消失
    关闭游戏，双击桌面的 Restore Seria QA Overlay。

  需要 DLSS5
    下载独立的 Seria-DLSS5 压缩包并运行 Install-DLSS5.cmd。


注意
  - 仅用于内部开发或测试客户端。
  - 不要只复制某个 addon64 文件，应使用完整安装包。
  - 工具包含未签名的 ReShade 社区组件，不要用于有反作弊要求的环境。

更简短的步骤见 QUICK_START_CN.txt。
