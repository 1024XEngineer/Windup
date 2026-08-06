const GRID_SIZE = 17
const CENTER = (GRID_SIZE - 1) / 2

/**
 * 光标笔画占用的格子，坐标以 (x, y) 记，原点在左上。
 * 这组坐标画的是一支指向右下的箭头，纯装饰，不跟随真实鼠标。
 */
const CURSOR_CELLS = [
  [8, 7],
  [8, 8],
  [8, 9],
  [8, 10],
  [8, 11],
  [9, 8],
  [9, 9],
  [9, 10],
  [10, 9],
  [10, 10],
  [10, 11],
  [11, 10],
  [11, 12],
]

/**
 * 创建页左侧的点阵标记：一张画布方框、四角把手和一支光标。
 * 整块是装饰，没有语义也不接受输入，因此对辅助技术隐藏。
 * 动画全部由 CSS 承担：环号决定底噪的相位差，(x+y)%4 决定实心格的相位差，
 * 换算成 animation-delay，让 289 个格子错峰呼吸而不是整块一起闪。
 */
export function ProjectCreatePixelMark() {
  return (
    <div aria-hidden="true" className="project-pixel-mark">
      {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
        const x = index % GRID_SIZE
        const y = Math.floor(index / GRID_SIZE)
        const frame =
          ((y === 3 || y === 13) && x >= 3 && x <= 13) ||
          ((x === 3 || x === 13) && y >= 3 && y <= 13)
        const handle = (x === 2 || x === 14) && (y === 2 || y === 14)
        const cursor = CURSOR_CELLS.some(([cellX, cellY]) => cellX === x && cellY === y)
        const guide = (y === 6 && x >= 5 && x <= 7) || (x === 6 && y >= 5 && y <= 7)
        const ring = Math.min(8, Math.floor(Math.hypot(x - CENTER, y - CENTER)))
        const role = handle
          ? 'is-active is-handle'
          : cursor
            ? 'is-active is-cursor'
            : frame || guide
              ? 'is-active'
              : ''
        return (
          <i
            key={index}
            className={`pixel-ring-${ring} pixel-phase-${(x + y) % 4} ${role}`.trim()}
          />
        )
      })}
    </div>
  )
}
