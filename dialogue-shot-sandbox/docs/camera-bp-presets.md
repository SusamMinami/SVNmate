# Camera BP 预设机位与小窗实现边界

## 调查范围

2026-09-11，读取本地工程接口声明，并通过已经连接的 UE MCP 查询类型和组件属性。
没有调用切换相机函数，没有创建 Actor、修改节点或保存资产。
当时 `get_current_selected_dialog_node_info()` 返回空，因此没有验证用户当前对话。

## 已确认的结构

- `DialogNPCTable` 的 `CameraBPPath` 独立于角色 BP、Mesh 和动画类。
- `/Game/Seria/Task/Mod/CameraMode/CameraModeBase` 的父类为
  `/Script/Seria.SeriaDialogCharacter`。
- `Camera_Normal_Male` 继承 `CameraModeBase`，包含数字命名的相机组件 `1` 到 `5`。
- 通过限定资产路径的 `ObjectIterator(CameraComponent)` 再次验证，模板对象路径为
  `/Game/Seria/Task/Mod/CameraMode/Camera_Normal_Male.Camera_Normal_Male_C:1_GEN_VARIABLE`
  等，而不是根据反射工具返回的短对象名称猜测路径。
- 基类蓝图导出中的 BeginPlay、Overlap、Tick 事件节点均被禁用。这不能证明所有
  原生父类或实例都没有 Tick，也不能推广到全部 Camera BP。

普通男性机位的实测模板参数如下，位置单位为 UE 厘米，旋转单位为度：

| 相机编号 | RelativeLocation X/Y/Z | RelativeRotation Pitch/Yaw/Roll | FOV |
| --- | --- | --- | --- |
| 1 | 186.001 / 0.000 / 70 | 0 / -180.000 / 0 | 70 |
| 2 | 174.673 / 46.938 / 67 | 0 / -160.000 / 0 | 70 |
| 3 | 156.902 / 80.554 / 63 | 0 / -145.000 / 0 | 70 |
| 4 | 182.473 / -43.122 / 66 | 0 / -195.000 / 0 | 70 |
| 5 | 179.696 / -83.920 / 66 | 0 / -205.000 / 0 | 70 |

这些是组件局部参数，不是世界坐标，也不是眼睛离地高度。
不能根据此表给全部角色硬编码“左 45°”“右 45°”：
模板并不左右对称，编号也不保证跨 Camera BP 使用同一含义。

## 两种调用路线

### 原生角色机位引用

UE Python 反射确认存在以下函数：

```python
# 示意签名，未在本轮执行；format_actor 必须是正确的对话预览/运行实例。
format_actor.use_model_camera(model_index, camera_index)
format_actor.use_formation_camera(camera_string)
format_actor.use_camera(
    camera_string,
    camera_move_string="",
    dialog_blend_camera_data_string="",
    school_move_cameras_map_string="",
)
```

`model_index` 对应对话数字角色槽，不是 NPC 配表 ID，也不是 BP 列表下标。
`use_model_camera(1, 3)` 从签名上表达“槽 1 的机位 3”，但仍需在真实对话预览
实例中验证参数的索引规则和实际切换效果。

直接调用这些函数属于切换当前实例视角，不等于持久化节点配置。
小窗要保存配置，应继续写入节点的 `CameraPosition` 等数据，由 UE 对话播放流程使用。

现有配置中有 `0-1`、`1-1`、`2-1` 这样的引用，结合接口很可能是
“角色槽-机位编号”。但没有读取到 `UseCamera` 的原生解析实现，也没有执行真实
节点播放验证，因此 `CameraPosition="1-3"` 目前是待验证方案，不能直接承诺可用。

如果该规则确认，普通静态对白可只保存引用，不复制机位坐标，也不新建相机组件。
这是首选低开销路线，但必须确认 `MoveCameras`、`SchoolMoveCamerasMap`、
Blend、FOV 覆盖和角色走位后的跟随行为，避免旧参数遮盖新的选择。

### 预设变换作为 c1 运镜起点

读取对应相机的有效 Transform 与 FOV，合成相机父级、Camera BP 实例、角色槽
在当前节点的位置和朝向，再转换到现有 `c1 / EPush` 导出的坐标系。
之后可使用当前镜头编辑逻辑继续修改起止位置。

这种方式更适合“选好角度后继续推拉”，但烘焙的固定变换不必然继续跟随角色，
不能当作原生引用的等价替代。还必须处理继承覆盖、缩放、旋转和
`RelativeTransformsString` / `ERotate` / `EWalk` 等节点前置变化。

## 当前小窗实现

现有“添加默认镜头”操作已扩展为紧凑的“角色 / 预设机位”选择，不另建工作区：

1. 展开选择器时仍先生成原有默认 `c1 / EPush` 草稿，并按需读取当前 Formation
   预览中的角色实例与数字命名 CameraComponent。
2. 读取要求 UE 当前只选中目标对白节点、存在唯一匹配的 Formation 预览实例，
   且该实例缩放为 `1 / 1 / 1`；不满足时显示具体错误，不猜测其他实例。
3. 机位列表保留真实数字编号，并根据组件相对位置计算角度标签。选择角色后再选
   机位，不为全部候选创建 SceneCapture 或 WebGL 预览。
4. 服务端同时记录相机的 Formation 局部 Transform 与世界 Transform。当前
   `EPush.bRelative` 决定写入哪一组值，Start/End 使用同一预设位置和旋转。
5. 当前节点没有运镜时基于默认 `EPush` 创建；已有单段 `EPush` 时保留其余参数
   并替换起止 Transform。多段运镜或非 `EPush` 节点明确阻断。
6. 选择只形成草稿，通过现有差异区和底栏“写入节点”提交。预设快照包含指纹，
   检查前重新读取并验证角色、机位和 UE 当前节点，应用继续沿用审核令牌、回读、
   单次保存和失败恢复。
7. `00` 节点不开放预设机位写入。角色职业相机 `SchoolMoveCamerasMap` 保持原有
   规则，不与 NPC 预设机位混用。

当前“添加角色相机”维护的是 `SchoolMoveCamerasMap` 的职业覆盖，
不是 NPC 的预设机位选择，两者不能复用同一个含混的操作名称。

## 仍需验证

- 选定真实对话和一个普通对白节点，确定预览 Format 实例及数字角色槽映射。
- 验证一个前视与一个侧视引用，记录 UE 实际使用的 CameraComponent。
- 比较空运镜、已有 EPush、已有职业覆盖三种节点；明确覆盖优先级。
- 使用角色转身/走位后的节点验证跟随和坐标，再测试 0 号玩家职业切换。
- 在显式授权的测试资产上进行写入、保存、重开验证；只切视角不足以证明配置已保存。

小窗选择、差异审核和写入链路已经实现。当前仍采用“将预设 Transform 烘焙为
`c1 / EPush`”的路线，不写入 `CameraPosition="角色槽-机位编号"` 原生引用；
后者只有在真实播放验证覆盖优先级与走位跟随后才能考虑接入。
