# Adobe 摄影机语言提炼

更新日期：2026-08-23

本文把 Adobe《Different types of shots and camera angles in film》主文及其
专题页整理为镜头沙盘可执行规则。焦距均按全画幅等效值理解。Adobe 的示例
是叙事建议，不是跨项目都成立的硬定律；系统只把协议一致性、连续性和安全
构图设为硬约束，把审美选择保留为有动机的软约束。

## 决策顺序

模型和规则导演都按以下顺序选择镜头：

1. 判断当前台词段发生了什么变化：信息、情绪、权力、动作或空间。
2. 决定观众需要看个人、关系、共同反应，还是完整空间。
3. 选择景别和角度，再选择能产生所需空间透视的焦距。
4. 判断静态镜头是否已经足够；只有叙事确实需要时才增加镜内运动。
5. 检查运动起点和终点的主体、轴线、视线、构图与 21:9 安全区域。

## 景别与焦距

| 范围 | 视觉作用 | 项目默认用途 |
| --- | --- | --- |
| 24-35mm | 更宽视场，强化前后距离，近距离时会夸张透视 | 建立空间、群像、环境压迫；夸张用法必须声明 |
| 35-50mm | 接近自然视感，空间和人物较平衡 | 中景、双人、普通对话 |
| 50-85mm | 轻度压缩空间并分离主体 | 过肩、中近景、稳定正反打 |
| 85-135mm | 压缩五官和背景，常配合浅景深 | 近景、特写、关键反应 |

- 景别由最终身体关键点投影判定，焦距不能代替景别标签。
- 同一景别可以使用不同焦距，但机位距离会随之改变，空间透视也会改变。
- 建立镜头和群像优先深景深；普通对话可用中等景深；情绪近景和关键细节
  可用浅景深。
- 特写应对准眼睛、表情或关键物体，并保留给重要节点，避免持续滥用。

## 角度

- 平视是中性、平等和客观的默认选择。
- 仰拍通常增强体量、权力或威胁，也可以表达弱者仰望时的主观脆弱。
- 俯拍通常表达脆弱、受困、渺小，也可以用于交代规模和空间信息。
- 侧面机位以约 80-90 度形成清晰 profile，适合疏离、内省、对峙和轮廓；
  普通对话仍优先正面或四分之三正面。
- Dutch angle 通过横滚制造失衡。常用范围为正负 15-25 度，更大角度只
  用于强烈混乱、梦境或心理异常；没有动机时保持 0 度。
- 极端高低角配合近距离广角会放大透视变形，只有需要夸张时才组合使用。

## 镜内运动

| 运动 | 物理定义 | 叙事用途 | 使用限制 |
| --- | --- | --- | --- |
| Static | 机位、朝向和焦距不变 | 普通对话、客观观察、让表演主导 | 默认选择 |
| Pan | 机位不动，水平改变朝向 | 连接人物、跟随横向动作、逐步揭示 | 必须规划起止视线，避免无目的扫视 |
| Tracking | 摄影机随主体穿过空间 | 沉浸、行动连续、环境转换 | 需要明确角色路径和稳定构图 |
| Dolly in | 摄影机物理靠近 | 注意集中、期待、领悟、情绪增强 | 不等同于变焦 |
| Dolly out | 摄影机物理远离 | 孤立、抽离、关系疏远、空间揭示 | 终点仍需读清主体 |
| Zoom in/out | 机位不动，只改变焦距和视场 | 光学聚焦或释放信息 | 空间透视不等同于物理推拉 |
| Dolly zoom in | 推进且同步缩短焦距 | 恐惧、顿悟、逐渐失序 | 主体尺寸近似不变；关键节点专用 |
| Dolly zoom out | 后退且同步增加焦距 | 震惊、隔绝、环境压缩 | 主体尺寸近似不变；关键节点专用 |

- Tracking 的核心是跟随主体，不等同于所有使用轨道设备的镜头。
- Pan 与 tilt 都是固定机位旋转；当前协议先支持水平 Pan，高低视线通过
  `camera_height` 表达。
- 运动速度、方向和终点必须服从叙事。普通对话优先轻微运动，强运动只给
  动作、混乱或重大情绪转折。
- 运动镜头需要足够时长让观众读取变化；短台词不因“想动一下”而单独切镜。
- 复杂 master 可以结合 Pan 或 Tracking，但运动必须帮助覆盖动作和空间，
  不能削弱 master 的定位功能。

## 基础覆盖与剪辑

- Master shot 覆盖整场重要人物、动作和空间关系，可在场景中随时用于
  重新定位；establishing shot 主要交代时间和地点，通常更短，也不一定
  覆盖完整表演。
- Insert 把主动作中的关键细节放大；cutaway 暂时离开主动作，展示相关
  物体、地点或画外事件。当前项目没有道具和环境目标协议，不应伪造这两类
  镜头，后续加入可寻址场景对象后再执行。
- Reaction shot 可以比说话者更重要，应捕捉画外信息引发的真实反应。
- 镜头序列至少要让“哪里、谁、什么”可读，并持续维护银幕方向、眼线与
  180 度关系轴。

## 来源

- [Adobe 主文：Camera shots and angles](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles.html?country=us)
- [Tracking shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/tracking-shot.html)
- [Pan shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/pan-shot.html)
- [Dolly zoom shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/dolly-zoom-shot.html)
- [Eye-level shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/eye-level-shot.html)
- [High-angle shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/high-angle-shot.html)
- [Low-angle shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/low-angle-shot.html)
- [Dutch angle shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/dutch-angle-shot.html)
- [Profile shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/profile-shot.html)
- [Close-up shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/close-up-shot.html)
- [Medium close-up shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/medium-close-up-shot.html)
- [Wide shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/wide-shot.html)
- [Over-the-shoulder shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/over-the-shoulder-shot.html)
- [Master shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/master-shot.html)
- [Establishing shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/establishing-shot.html)
- [Cutaway shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/cut-away-shot.html)
- [Sequence shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/sequence-shot.html)
- [180-degree rule](https://www.adobe.com/creativecloud/video/discover/what-is-the-180-degree-rule.html)
- [Shot/reverse shot](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/reverse-shot.html)
