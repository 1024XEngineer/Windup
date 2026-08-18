# 各动作所需的母版姿态

attack 按运动拓扑分四节(`attack.<拓扑>`):母版姿态决定动作、提示词只能微调,
而四支的起手姿态互不兼容 —— 拿横挥蓄力母版跑直刺,模型会先把收在腰际的那侧重新抡起来。

## walk

## run

## idle

## jump

```text
deep crouch coiled to spring straight upward: the knees bent low and the hips sunk down, both arms drawn back behind the body,
the weight loaded onto both legs at the very moment before springing straight up, anything held in the hands kept in a fixed grip; leave generous empty space above the head
```

## attack.sweep

```text
extreme wind-up stance for a horizontal strike: the striking hand drawn far BACK behind the body at WAIST height,
the torso twisted back and coiled, weight fully loaded on the back leg, both arms low and pulled back,
that hand and anything held in it staying BELOW the shoulders; leave generous empty space on the swing side
```

## attack.thrust

```text
low coiled stance ready to drive straight forward: the weight sunk onto the back leg with both knees bent,
the striking side pulled in tight against the body at WAIST height and held there ready to fire,
the torso squared low over the front foot, that side and anything held in it staying BELOW the shoulders;
leave generous empty space in front
```

## attack.project

```text
braced stance ready to send something forward at a distance: both feet planted wide and firmly set,
the hips sunk low and the weight centred between the feet, the torso upright and square,
both hands drawn in close in front of the chest and held there, anything held in them kept in a fixed grip;
leave generous empty space in front
```

## attack.lunge

```text
crouched stance coiled to spring forward: all four limbs folded under the body with the chest lowered close to the ground,
the rear limbs deeply loaded and ready to drive, the head and the leading limbs pointing forward along the line of travel,
anything the character carries kept in place; leave generous empty space in front
```
