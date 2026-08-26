# 四向 / 八向立绘 sheet 图生图提示词

身份锚是已确认的**正视图**（`south`，面对镜头）。东 / 北 / 对角从图生图转相机；
西 / 西北 / 西南生产路径水平翻转后上传，不调模型 —— 这三节仍保留，避免执行器误调时
落到空提示词。

朝向节的三件套（Required view / Body / Visibility）来自 PerfectPixel Studio 的
`facingDescs`。正文只写正向计数句。构图约束放在 `## framing`，定妆构图放在
`## master`。

## identity

```text
This is an image-to-image task. The attached image is the confirmed FRONT-VIEW character master.
It supplies identity only: the same face, hairstyle, body proportions, outfit, colors,
accessories, and silhouette. Facing direction lock (overrides any other facing or view
instruction in this prompt): redraw that identical standing figure at the facing lock below.
Hold that viewing angle for the whole figure. Never drift back toward a front view and never
mirror the character. Left and right of the outfit stay on their own sides of the body.
Same idle pose, same scale, same costume, same character.
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

## master

定妆 `/generation/image` 用。站立参考，不是动作条带。灰底仍由执行器那句
Plain light-gray 负责，不写洋红。

```text
Before drawing, identify and keep the subject's hairstyle, hair color, eye color, outfit
layers, accessories, weapon or signature prop, and dominant colors. Relaxed idle standing
pose, feet level, weight balanced, arms relaxed and readable. A single figure, head to feet,
vertically centered, occupying about three quarters of the canvas height with breathing room
on every side. Almost flat 2D game-sprite view.
```

## pixel

像素项目才拼这一节。措辞全是正面约束:静态图通路没有 negative_prompt。
来源是 PerfectPixel Studio 的 sprite / low-res 合同,适配本管线:身份锁正视母版,
灰底由 framing 负责,逻辑分辨率由项目精灵尺寸负责,不要写 16×16 / 纯白底 / 洋红。

```text
TRUE pixel art on a square grid, like a 32-64px game sprite enlarged on the canvas.
Each cell of the grid holds one flat solid color. Use a palette of six to eight solid colors;
when a reference image is attached, match that image's colors. Chunky square pixels aligned
to the grid, a clean dark 1px outline around the silhouette, solid tone clusters, at most one
highlight step and one shadow step. Compact torso, clear head shape, simple arms and legs.
Faces stay a flat color plane with readable eyes and mouth. The subject is centered with
empty margin on all sides. Every important shape stays readable at thumbnail size.
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
Facing direction lock: front view, camera on the south, zero-degree azimuth, camera directly
in front at eye level. Body orientation: the character faces the viewer directly.
Visibility: full face visible, eyes and mouth, both arms and both legs fully visible and
symmetric.
```

## east

```text
Facing direction lock: right-side profile view, camera on the east, ninety-degree azimuth,
camera at the character's right side, perpendicular to the body, strictly 2D profile.
Body orientation: the character faces toward the RIGHT edge of the canvas.
Visibility: true side view, right profile of the face only, one eye and one ear; right arm
and right leg prominent, left limbs fully hidden behind the body.
```

## north

```text
Facing direction lock: back view, camera on the north, one-hundred-eighty-degree azimuth,
camera positioned directly behind the character. Body orientation: the character faces away
from the viewer. Visibility: face completely hidden, only the back of the head and hair
visible; back of the outfit, both arms and legs seen from behind.
```

## west

```text
Facing direction lock: left-side profile view, camera on the west, two-hundred-seventy-degree
azimuth, camera at the character's left side, perpendicular to the body, strictly 2D profile.
Body orientation: the character faces toward the LEFT edge of the canvas.
Visibility: true side view, left profile of the face only, one eye and one ear; left arm
and left leg prominent, right limbs fully hidden behind the body.
```

## south_east

```text
Facing direction lock: three-quarter front-right view, camera on the south-east,
forty-five-degree azimuth, camera at front-right, rotated about forty-five degrees from
straight ahead. Body orientation: the character is turned about forty-five degrees to the
right, mostly facing the viewer. Visibility: three-quarter face with both eyes visible,
right side emphasized; right arm and leg fully visible, left side partially visible.
```

## north_east

```text
Facing direction lock: three-quarter back-right view, camera on the north-east,
one-hundred-thirty-five-degree azimuth, camera behind and to the right.
Body orientation: the character is turned away from the viewer, showing the back-right side.
Visibility: face hidden except a hint of the right jaw; back and right shoulder prominent,
right arm and leg visible from behind.
```

## south_west

```text
Facing direction lock: three-quarter front-left view, camera on the south-west,
three-hundred-fifteen-degree azimuth, camera at front-left.
Body orientation: the character is turned about forty-five degrees to the left, mostly
facing the viewer. Visibility: three-quarter face with both eyes visible, left side
emphasized; left arm and leg fully visible, right side partially visible.
```

## north_west

```text
Facing direction lock: three-quarter back-left view, camera on the north-west,
two-hundred-twenty-five-degree azimuth, camera behind and to the left.
Body orientation: the character is turned away from the viewer, showing the back-left side.
Visibility: face hidden except a hint of the left jaw; back and left shoulder prominent,
left arm and leg visible from behind.
```
