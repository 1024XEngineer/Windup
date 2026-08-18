# 攻击 i2v 提示词(一次性类)

节名是 `<运动拓扑>.<朝向>`。分支依据是**身体怎么发力**,不是手里拿着什么:
写"宽面""弧线"这类形状词等于断言角色手握一件有宽面的长条物,喂法杖 / 空手 / 四足角色时
模型会凭空补出那件东西来调和图文矛盾(与 #195 同一个坑,只是从名词层退到形状层)。

四支都要写整体位移(whole body / torso / hips):i2v 强跟身体、弱跟持物,
只描述持物的运动会让它自行漂移。

## sweep.side

```text
Seen from the side facing right, the character makes ONE single committed strike, staying in STRICT SIDE VIEW the whole time:
starting coiled with the weight on the back foot, the whole body uncoils and the hips drive forward as the weight surges onto the front foot,
the striking side of the body travelling in one continuous path from far behind the body, down across the front of the torso, out to full extension low in front,
whatever the character already wears or carries keeps its own shape and moves with the body, anything held in the hands stays in the same grip at the same angle,
then the torso settles back upright into guard and holds that stance.
The torso and hips keep pointing to the right the entire time and the character never turns toward or away from the viewer.
```

## sweep.front

```text
Facing the viewer, the character makes ONE single committed strike: starting coiled with the weight on the back foot,
the whole body uncoils forward and the hips turn into the motion as the weight surges onto the front foot,
the striking side of the body travelling in one continuous path across the front of the torso out to full extension,
whatever the character already wears or carries keeps its own shape and moves with the body, anything held in the hands stays in the same grip at the same angle,
then the torso settles back upright into guard and holds that stance, standing steady and keeping FACING THE VIEWER.
```

## thrust.side

```text
Seen from the side facing right, the character drives ONE single committed strike straight forward, staying in STRICT SIDE VIEW the whole time:
starting coiled low with the weight on the back foot and the striking side pulled in at waist height,
the hips snap forward and the whole body drives straight ahead as the weight lands on the front foot,
the striking side of the body extending in one straight line directly forward to full reach and stopping there,
whatever the character already wears or carries keeps its own shape and moves with the body, anything held in the hands stays in the same grip at the same angle,
then the torso draws back over the hips and settles into guard and holds that stance.
The torso and hips keep pointing to the right the entire time and the character never turns toward or away from the viewer.
```

## thrust.front

```text
Facing the viewer, the character drives ONE single committed strike straight toward the viewer:
starting coiled low with the weight on the back foot and the striking side pulled in at waist height,
the hips snap forward and the whole body drives straight ahead as the weight lands on the front foot,
the striking side of the body extending in one straight line directly toward the viewer to full reach and stopping there,
whatever the character already wears or carries keeps its own shape and moves with the body, anything held in the hands stays in the same grip at the same angle,
then the torso draws back over the hips and settles into guard and holds that stance, standing steady and keeping FACING THE VIEWER.
```

## project.side

```text
Seen from the side facing right, the character makes ONE single committed ranged release, staying in STRICT SIDE VIEW the whole time:
starting settled with the weight low over both feet, the torso presses forward over the front foot and the hips square up behind the motion,
the releasing side of the body reaching straight out in front of the chest and coming to a firm stop at full extension,
the whole body braced and steady at that moment,
whatever the character already wears or carries keeps its own shape and moves with the body, anything held in the hands stays in the same grip at the same angle,
then the character keeps that extended pose and stays still.
The torso and hips keep pointing to the right the entire time and the character never turns toward or away from the viewer.
```

## project.front

```text
Facing the viewer, the character makes ONE single committed ranged release toward the viewer:
starting settled with the weight low over both feet, the torso presses forward and the hips square up behind the motion,
the releasing side of the body reaching straight out in front of the chest toward the viewer and coming to a firm stop at full extension,
the whole body braced and steady at that moment,
whatever the character already wears or carries keeps its own shape and moves with the body, anything held in the hands stays in the same grip at the same angle,
then the character keeps that extended pose and stays still, keeping FACING THE VIEWER.
```

## lunge.side

```text
Seen from the side facing right, the character makes ONE single committed lunge forward, staying in STRICT SIDE VIEW the whole time:
starting crouched low with the weight loaded onto the rear limbs, the whole body surges forward in one burst with the head and the leading limbs arriving first,
the hips and torso following along that same line and the back stretching out level and low over the ground,
whatever the character already wears or carries keeps its own shape and moves with the body,
then the body gathers back under itself, settles low and holds that crouched stance.
The torso and hips keep pointing to the right the entire time and the character never turns toward or away from the viewer.
```

## lunge.front

```text
Facing the viewer, the character makes ONE single committed lunge toward the viewer:
starting crouched low with the weight loaded onto the rear limbs, the whole body surges forward in one burst with the head and the leading limbs arriving first,
the hips and torso following along that same line and the back stretching out level and low over the ground,
whatever the character already wears or carries keeps its own shape and moves with the body,
then the body gathers back under itself, settles low and holds that crouched stance, keeping FACING THE VIEWER.
```
