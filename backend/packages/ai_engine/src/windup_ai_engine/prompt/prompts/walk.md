# 走路 i2v 提示词(视频路线)

实测要点(Issue #35):

- 只写正向词、逐条写腿部可见动作(抬 / 摆 / 蹬 / 承重),锁死手持武器不乱动。
- **提示词的朝向必须与母版朝向一致**。给正面母版喂侧走词(STRICT SIDE)会让模型靠"转身"
  调和图文矛盾 —— 早期"正面母版必转身"的结论正是这么造成的。故按 facing 分流:
  `side`(横版侧走)/ `front`(俯视·2.5D 朝观者行进),对应 `Project.perspective`。
- "半侧"母版(头侧脸 + 身体略正)配 `side` 词,实测会被自然解析成正侧面走,不转身,够用。
- **提示词只描述动作,不描述角色穿什么拿什么**(#195)。装备名词一旦写进模板就是在断言
  该物件存在:母版没有斗篷,模型会为了满足文字凭空长一件出来,母版真有的特征(软管、
  胸铠)反被挤掉。这与 `ports.CharacterGeneratorPort` 那条"身份由母版承载,身份描述再写
  一遍反而会和母版打架"是同一条。故衣饰 / 手持物一律写成**存在无关**的保持句
  ("whatever the character already wears or carries"),既锁住"别乱动",又不断言有什么。

> 改正文前先读上面四条。它们每一条都对应一次真花过钱的失败,不是风格偏好。
> 正文按逗号断行只为可读,加载时会折回一整段(见 `prompt/_md.py`),故**别在句中加空行**。

## side

The character walks steadily to the right through the open space, the whole body advancing with every stride:
the front foot lifts, swings forward and plants heel first, the rear foot pushes off the ground,
the hips and torso carry the weight forward over the planted foot, whatever the character already wears or carries keeps its own shape and sways with the steps,
anything held in the hands stays in the same grip at the same angle, the upper body stays calm and upright,
SIDE VIEW facing right the whole time, the legs clearly visible.

## front

The character walks in place toward the viewer, marching forward on the spot: each foot lifts,
swings forward and plants down in turn while the other pushes off, the knees rise alternately toward the camera,
the hips and shoulders sway naturally with each step, whatever the character already wears or carries keeps its own shape and sways with the steps,
anything held in the hands stays in the same grip at the same angle, the upper body stays calm and upright,
the character keeps FACING THE VIEWER the whole time and stays centered in frame, both legs clearly visible.
