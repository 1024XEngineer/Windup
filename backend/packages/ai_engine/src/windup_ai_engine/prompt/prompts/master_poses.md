# 各动作所需的母版姿态

**核心规律(三次实测验证,写死为契约):母版姿态决定动作,提示词只能微调。**

- walk:母版**朝侧向**才不转身;正面母版配侧走词 → 模型靠转身调和图文矛盾。
- jump:母版**顶部留白**才不被视频画面裁掉。
- attack:必须给**极限蓄力母版**(出手那只手已拉到身后腰际)。用站立母版时,即使提示词
  写死"不过头顶 / 不转身 / 只做一次",模型仍会抡过头顶、转到背面、劈两次 —— 强动作
  先验压不住;换蓄力母版后模型只能"接着往前挥",没有再抡起的空间。

**姿势描述里不写装备名词(#195)。** 这几段是拿去生成母版的提示词,写 "the weapon" 等于
断言角色持械 —— 空手角色会被凭空塞一把武器,而母版是整条 i2v 链的身份来源,污染会一路
带到所有动作。改为"出手的那只手 / 手里若有东西"这类存在无关的写法,几何约束(拉到腰际、
不过肩)一条不少。

> **空节是有意义的**:该动作用中性站立母版即可,不需要专门生成。这是本文件里**唯一**
> 允许空节的地方(加载时显式传 `allow_empty=True`),别照抄到别的提示词文件 ——
> 那边空节意味着提示词变空串、付费调用照发、任务还显示成功。

## walk

## run

## idle

## jump

```text
deep crouch coiled to spring straight upward: the knees bent low and the hips sunk down, both arms drawn back behind the body,
the weight loaded onto both legs at the very moment before springing straight up, anything held in the hands kept in a fixed grip; leave generous empty space above the head
```

## attack

```text
extreme wind-up stance for a horizontal strike: the striking hand drawn far BACK behind the body at WAIST height,
the torso twisted back and coiled, weight fully loaded on the back leg, both arms low and pulled back,
that hand and anything held in it staying BELOW the shoulders; leave generous empty space on the swing side
```
