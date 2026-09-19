# 待机 i2v 提示词(循环类)

判据取自 gold 标注(17 条,排除缺陷母版)验出来的两条,都是**性质**不是幅度:
脚底线位移 ≈ 0(脚离地就不是站着)、无推镜(scale drift ≈ 0)。

三条写法上的硬约束,都由 `prompt/lint.py` 当场拦:

- **不写否定式**。这条通路没有 negative_prompt,模型不处理否定极性、只把名词当成
  要画的东西 —— 写「不要走路」等于点名要走路。要什么就正面写什么。
- **不写解剖学动词**。上一版把同一次呼吸说了三遍(chest breathes / ribcage
  expanding / torso rising),而 `ribcage expanding` 是写实人体的说法,卡通角色
  照做就是胸口一鼓一鼓;重复三次又放大了一轮。
- **不写低于分辨率的幅度**(slightly / a little)。交付尺寸下 0.5% 的躯干起伏不到
  一个像素,要求模型做一件看不见的事,它会拿推镜或错动作来顶。给看得见的幅度。

## side

```text
The character holds a settled standing idle in place, seen from the side facing right.
The upper body eases down and lifts back up in one slow even rhythm, arms and worn cloth
hanging loose and drifting along with it, anything held in the hands kept in the same grip.
Both feet stay flat and planted on the ground for every frame, the stance and the gap
between the feet held constant, the body weight centered between them. The whole figure
stays at the same spot in frame and at the same size. The camera holds one fixed position,
angle, distance and projection for every frame.
```

## front

```text
The character holds a settled standing idle in place, facing the viewer. The upper body
eases down and lifts back up in one slow even rhythm, arms and worn cloth hanging loose and
drifting along with it, anything held in the hands kept in the same grip. Both feet stay
flat and planted on the ground for every frame, the stance and the gap between the feet
held constant, the body weight centered between them. The character keeps FACING THE VIEWER,
stays at the same spot in frame and at the same size. The camera holds one fixed position,
angle, distance and projection for every frame.
```
