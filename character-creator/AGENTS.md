# 角色创建工具 AI 入口

独立 Windows 本地测试工具，React / TypeScript / Vite + Python。
不属于镜头沙盘、ConfigLinker 或 SVNmate 的发布通道。

- 产品范围：[PRODUCT.md](PRODUCT.md)。
- UI 工作先读 [DESIGN.md](DESIGN.md)；数据关系先读
  [配置研究](docs/configuration-research.md)。
- 技能/Buff 编辑读 [模块契约](docs/skill-buff-authoring.md)，UE 扩展读
  [接口复用](docs/ue-interface-reuse.md)；现有图编辑方案不等于已部署 API。
- CSV 只读；保留双表头、重复成员与跨列数组空槽。
- 真实 xlsm 仅允许只读解析或 Excel COM 编辑，禁止 openpyxl 保存真实业务工作簿。
- 编辑白名单、引用命名空间和写入模式由后端校验，不能只在前端限制。
- Excel 写入按整批预检、串行应用、回读、标红、未保存协议执行。
  失败恢复是尽力恢复，不能宣称跨工作簿事务。
- 普通验证仅使用合成工作簿；不改生产表、不运行宏、不导表、不写 UE。
- `.local/`、临时副本、截图、业务数据、目录、会话令牌不提交。
- 保留仓库其他项目未提交改动，不自动提交、发布或升级其他产品。

验证：

```text
npm run build
python -m unittest discover -s tests -v
python -m backend.server
npm run test:ui
```

显式 Excel 合成集成验证：`python tests/excel_smoke.py --run`。
它会打开 Excel，仅操作自动创建的合成临时文件。
技能多行集成：`python tests/authoring_excel_smoke.py --run`；
技能/Buff UI：`node tests/authoring-ui.mjs`（真实读取，commit 替身）。
