Seria DLSS5 使用说明
====================

用途
  为 Seria D3D11 客户端安装经过验证的 DLSS5 Bridge 组件。
  本包不包含 Seria QA Overlay；任务工具请另行下载 Seria-QA-Overlay。


安装
  1. 完全退出 Seria.exe。
  2. 解压整个 Seria-DLSS5 压缩包。
  3. 双击 Install-DLSS5.cmd。
  4. 粘贴游戏根目录、Seria.exe 或 Seria\Binaries\Win64 路径。
  5. 安装完成后重新启动游戏。

  安装器会配置当前已验证的组合：
  - ReShade 6.8.0
  - DLSS5 DX11 Bridge 1.0.27
  - RTX 4080 Ada 补丁库 310.8.SF.0
  - NeuralUplift=0
  - 2560x1440 兼容分辨率


每天 trunk 更新后
  使用桌面快捷方式：

  Restore Seria DLSS5

  恢复文件位于：
  %USERPROFILE%\Documents\Seria-DLSS5-Recovery


与 QA Overlay 共存
  两个工具共享同一份 ReShade 6.8.0 核心，可任意顺序安装。
  安装 DLSS5 不会安装或删除 QA Overlay。
  已安装 QA Overlay 时，“画面诊断”页会自动出现。


注意
  - 仅用于内部开发或测试客户端。
  - 当前 D3D11 方案不要升级到 DLSS5 Bridge 1.4.x 或 Neural Upstream。
  - 包含未签名的社区组件，不要用于有反作弊要求的环境。
