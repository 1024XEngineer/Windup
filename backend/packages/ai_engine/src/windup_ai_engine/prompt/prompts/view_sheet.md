# 四向 / 八向立绘 sheet 图生图提示词

身份锚是已确认的**正视图**（`south`，面对镜头）。东 / 北 / 对角从图生图转相机；
西 / 西北 / 西南生产路径水平翻转后上传，不调模型 —— 这三节仍保留，避免执行器误调时
落到空提示词。

正文只写正向计数句。构图约束（单主体、全身、灰底）放在 `## framing`，不抄进每个朝向。

## identity

```text
This is an image-to-image task. The attached image is the confirmed FRONT-VIEW character master.
Preserve that identity exactly: the same face, hairstyle, body proportions, outfit, colors,
accessories, and silhouette. Change only the camera azimuth around the same standing figure.
Same idle pose, same scale, same costume, same character.
```

## identity.first_frame

```text
This is an image-to-image task. The attached image is the confirmed FRONT-VIEW character master.
Preserve that identity exactly: the same face, hairstyle, body proportions, outfit, colors,
accessories, and silhouette. Rotate only the camera azimuth around the same figure to the
compass heading below. Keep that camera lock: do not let the character turn independently of it.
The pose is the action first frame described after the camera heading, not the idle standing pose.
Same scale, same costume, same character.
```

## first_frame.pose_lock

```text
The pose is the action first frame described next, not idle standing. Keep the camera azimuth
and compass heading above for the whole figure. Do not face another direction. Same identity
as the front-view master.
```

## pose

```text
Neutral idle standing pose, weight centered over both feet, knees easy, arms hanging in a
natural A-stance with a little space between the hands and the hips, head upright, no walk,
no attack, no twist of the hips against the torso.
```

## framing

```text
Full body from head to feet, character centered in frame, orthographic sprite projection,
flat even lighting, plain light-gray background. Exactly one character is in the frame,
and the whole body stays inside the frame.
```

## elevation.side

```text
Eye-level camera, orthographic, no vanishing point, feet and head the same scale.
```

## elevation.top-down

```text
Elevated camera looking slightly down, about thirty to forty-five degrees, orthographic
top-down sprite angle, no vanishing point.
```

## elevation.isometric

```text
Elevated three-quarter camera, about thirty to forty-five degrees, isometric sprite angle,
orthographic, no vanishing point.
```

## south

```text
Front view, camera on the south, zero-degree azimuth. The character faces the viewer:
the face, chest, and both shoulders are square to the camera, both eyes visible,
the left and right sides of the outfit matching the master.
```

## east

```text
Right-side profile, camera on the east, ninety-degree azimuth. The character faces right:
a true side view, one eye, the right shoulder and right arm toward the camera,
the left side of the body hidden, the same standing pose as the front master.
```

## north

```text
Back view, camera on the north, one-hundred-eighty-degree azimuth. The character faces away:
the back of the head, the back, and both shoulder blades visible, the face hidden,
left and right reversed from the front master, the same standing pose.
```

## west

```text
Left-side profile, camera on the west, two-hundred-seventy-degree azimuth. The character
faces left: a true side view, one eye, the left shoulder toward the camera,
the same standing pose as the front master.
```

## south_east

```text
Three-quarter front view to the right, camera on the south-east, forty-five-degree azimuth.
The face and the right side are both visible, the left side receding, the same standing pose
as the front master.
```

## north_east

```text
Three-quarter back view to the right, camera on the north-east, one-hundred-thirty-five-degree
azimuth. The back and the right side are both visible, the face mostly hidden,
the same standing pose as the front master.
```

## south_west

```text
Three-quarter front view to the left, camera on the south-west, three-hundred-fifteen-degree
azimuth. The face and the left side are both visible, the right side receding,
the same standing pose as the front master.
```

## north_west

```text
Three-quarter back view to the left, camera on the north-west, two-hundred-twenty-five-degree
azimuth. The back and the left side are both visible, the face mostly hidden,
the same standing pose as the front master.
```
