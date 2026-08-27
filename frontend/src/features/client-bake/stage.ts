/**
 * 三渲二出帧台 —— 绑骨模型 → 逐帧 WebGL 缓冲。
 *
 * 与后端 `providers/render3d/stage/bake_stage.html` 是**同一个台子的两个宿主**:那份由
 * Playwright 无头驱动,这份跑在用户浏览器里(#714)。七条硬约束逐条对齐,它们都是拿
 * 教训换的,任何一条走样都不会报错、只会安静地渲出另一个东西:
 *
 *  1. 取 WebGL 缓冲,不截页面 —— 页面合成会把 canvas 的透明底换成 body 背景色,
 *     于是 alpha 全 255、四条门禁全"PASS"全是假的。
 *  2. `mixer.setTime(t)` 取样,不靠实时播放 —— 同一帧两次跑必须一致。
 *  3. `setPixelRatio(1)` + 关 AA —— 前者免得 devicePixelRatio 让不同机器出不同尺寸,
 *     后者因为像素精灵要硬边(开 AA 实测留下上万个半透明柔边像素)。
 *  4. 构图一次算定、跨所有片段与所有朝向固定;横向跨度取 `max(X, Z)`,多朝向转相机
 *     不转模型 —— 按单一水平轴定构图的话转到 90° 时取景就变了,各朝向对不齐。
 *  5. 覆盖率不足视为失败,不上传全透明帧。
 *  6. 不在 3D 里锁地 —— 实测 hip 设成常量后 12 帧输出完全一致,即位移信息没了。
 *  7. 材质取值严格校验,认不出当场抛 —— 静默兜底会让"换材质做对照"实际没换。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** 出帧台**真正认识**的材质,每个对应一个不同的渲染分支。与后端 `MATERIALS` 同表。 */
export const MATERIALS = ['cel', 'lit', 'clay', 'toon', 'orig'] as const
export type StageMaterial = (typeof MATERIALS)[number]

export function isStageMaterial(value: string): value is StageMaterial {
  return (MATERIALS as readonly string[]).includes(value)
}

/**
 * 要渲的动作名 → 模型里真实存在的片段名。
 *
 * 绑骨接口一次只烘一个动作,而片段名由它的动作库自己起(实测 08-19 与 08-27 两次任务
 * 拿到的都是 `Armature|32795ddb244644eac67ccfd8b84060c3_remap`),**永远对不上产品动作
 * 名**。所以只有一个片段时就用它 ——
 * 这不是兜底:只有一个候选就不存在"选错"。"这份资产会不会这个动作"由派单那一侧保证
 * (资产只烘了一个动作,别的动作在编排层就被拒了),不由片段名保证。
 *
 * 多于一个片段还对不上名字仍然抛:那时候选谁都是猜,而猜错会渲出另一个动作,
 * 帧数、时长、成色全部正常,没有一道会红。
 */
export function resolveClip(want: string, available: string[]): string {
  if (available.includes(want)) return want
  if (available.length === 1) return available[0]
  throw new StageError(`模型里没有片段 ${JSON.stringify(want)};有的是 ${JSON.stringify(available)}`)
}

export interface StageRigInfo {
  loader: string
  rootBone: string | null
  bones: number
  skinned: number
  verts: number
  orthoH: number
  material: StageMaterial
}

export interface StageOptions {
  modelUrl: string
  material: string
  width: number
  height: number
}

export class StageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StageError'
  }
}

/** 一次出帧的全部状态。用完必须 `dispose()`,WebGL 上下文数量浏览器有上限。 */
export class BakeStage {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -20, 20)
  private readonly material: StageMaterial
  private readonly width: number
  private readonly height: number

  private model!: THREE.Object3D
  private mixer!: THREE.AnimationMixer
  private clips: Record<string, THREE.AnimationClip> = {}
  private current: THREE.AnimationAction | null = null
  private unionBox!: THREE.Box3
  private orthoH = 1.2
  private camYaw = 0
  private rootBone: string | null = null
  private loader = 'gltf'
  private probe: HTMLCanvasElement | null = null

  private constructor(options: StageOptions) {
    if (!isStageMaterial(options.material)) {
      throw new StageError(
        `未知材质 ${options.material};只认 ${MATERIALS.join(' / ')}。别兜底 —— 静默落到同一分支正是这条线踩过的仪器陷阱。`,
      )
    }
    this.material = options.material
    this.width = options.width
    this.height = options.height
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(this.width, this.height, false)
    this.renderer.setClearColor(0x000000, 0)
  }

  static async create(options: StageOptions): Promise<BakeStage> {
    // 构造函数里就拿到了 WebGL 上下文,而 load 会因为模型坏 / 没动画 / 归一化量不出高度
    // 而抛。抛出去的话调用方手里还是 null,dispose 永远轮不到 —— 用户重试几次就把浏览器
    // 的上下文配额耗光,之后连本来能出的帧也出不了。
    const stage = new BakeStage(options)
    try {
      await stage.load(options.modelUrl)
    } catch (error) {
      stage.dispose()
      throw error
    }
    return stage
  }

  private async load(url: string): Promise<void> {
    // cel 是零光照平涂(灯位变化不改颜色),其余分支才需要灯。
    if (this.material !== 'cel') {
      const lights = new THREE.Group()
      lights.add(
        new THREE.DirectionalLight(0xfff4e0, 2.2).translateX(1.2).translateY(1.6).translateZ(1.0),
        new THREE.DirectionalLight(0xc8dcff, 0.6).translateX(-1.3).translateY(0.4).translateZ(0.8),
        new THREE.AmbientLight(0xffffff, 0.35),
      )
      this.scene.add(lights)
    }
    const root = new THREE.Group()
    this.scene.add(root)

    let animations: THREE.AnimationClip[]
    if (/\.fbx(\?|$)/i.test(url)) {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
      const object = await new FBXLoader().loadAsync(url)
      this.model = object
      animations = object.animations ?? []
      this.loader = 'fbx'
    } else {
      const gltf = await new GLTFLoader().loadAsync(url)
      this.model = gltf.scene
      animations = gltf.animations ?? []
      this.loader = 'gltf'
    }
    root.add(this.model)
    this.normalize()
    if (this.material !== 'orig') this.rebuildMaterials()
    for (const clip of animations) this.clips[clip.name] = clip
    this.mixer = new THREE.AnimationMixer(this.model)
    this.rootBone = this.topBoneName()
    if (this.rootBone) for (const clip of animations) this.flattenRootXZ(clip, this.rootBone)
    this.unionBox = this.computeUnionBox()
    this.placeCam()
  }

  /** 总高缩到 1.0、脚底落在 y=0 —— 1.0 与 root_motion 的单位一致。 */
  private normalize(): void {
    this.model.updateMatrixWorld(true)
    let box = new THREE.Box3().setFromObject(this.model)
    const rawH = box.max.y - box.min.y
    if (!Number.isFinite(rawH) || rawH <= 0) {
      throw new StageError('模型包围盒量不出高度 —— 空模型或坏 GLB')
    }
    this.model.scale.setScalar(1.0 / rawH)
    this.model.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(this.model)
    this.model.position.y -= box.min.y
    this.model.position.x -= (box.max.x + box.min.x) / 2
    this.model.position.z -= (box.max.z + box.min.z) / 2
    this.model.updateMatrixWorld(true)
  }

  private toonRamp(): THREE.Texture {
    const canvas = document.createElement('canvas')
    canvas.width = 3
    canvas.height = 1
    const ctx = canvas.getContext('2d')!
    ;['#4a4a52', '#9a9aa6', '#f2f2f6'].forEach((color, i) => {
      ctx.fillStyle = color
      ctx.fillRect(i, 0, 1, 1)
    })
    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    return texture
  }

  private rebuildMaterials(): void {
    const ramp = this.material === 'toon' ? this.toonRamp() : null
    const rebuild = (src: THREE.Material): THREE.Material => {
      // side 必须继承源材质:图生 3D + 减面的网格普遍带 doubleSided,丢掉等于开背面
      // 剔除,而减面后一个三角形只有约一个像素,表现为满身单像素白斑。
      const side = (src as THREE.MeshStandardMaterial).side ?? THREE.FrontSide
      const map = (src as THREE.MeshStandardMaterial).map ?? null
      const srcColor = (src as THREE.MeshStandardMaterial).color
      const color = srcColor ? srcColor.clone() : new THREE.Color(0xcccccc)
      switch (this.material) {
        case 'cel':
          return new THREE.MeshBasicMaterial({
            map,
            color: map ? new THREE.Color(0xffffff) : color,
            side,
          })
        case 'lit':
          return new THREE.MeshStandardMaterial({
            map,
            color: 0xffffff,
            roughness: 0.68,
            metalness: 0.15,
            side,
          })
        case 'clay':
          return new THREE.MeshStandardMaterial({
            color: 0xb9bec4,
            roughness: 0.62,
            metalness: 0.0,
            side,
          })
        case 'toon':
          return new THREE.MeshToonMaterial({ map, color, gradientMap: ramp, side })
        default:
          throw new StageError(`材质 ${this.material} 在表里但没有对应分支 —— 别静默兜底`)
      }
    }
    this.model.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      // 逐个材质组替换,不能只拿 material[0] 赋给整个网格:一个 mesh 可以有多个材质组
      // (皮肤 / 头发 / 眼睛 / 衣服),那样做会让所有组都用第一个组的贴图渲染 ——
      // 外观整个变了,而帧数、覆盖率、成色一道都不会红。
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => (m ? rebuild(m) : m))
      } else if (mesh.material) {
        mesh.material = rebuild(mesh.material)
      }
    })
  }

  private topBoneName(): string | null {
    let top: string | null = null
    this.model.traverse((node) => {
      const bone = node as THREE.Bone
      if (bone.isBone && !top && !(bone.parent && (bone.parent as THREE.Bone).isBone)) {
        top = bone.name
      }
    })
    return top
  }

  /**
   * 把根骨的水平位移就地压平。留着它有两个后果:构图会把整条行进路径纳进来,角色被
   * 缩成一小点;序列帧里角色在画布上平移,引擎侧没法用。竖直分量保留 —— 重心起伏是
   * 姿态的一部分,不是位移。
   */
  private flattenRootXZ(clip: THREE.AnimationClip, boneName: string): void {
    // 只认根骨自己的位置轨。认宽了会把子骨(如 Spine)的位移也剥掉,那是姿态不是位移。
    const track = clip.tracks.find((t) => t.name === `${boneName}.position`)
    if (!track) return
    const values = track.values
    const x0 = values[0]
    const z0 = values[2]
    for (let i = 0; i < values.length; i += 3) {
      values[i] = x0
      values[i + 2] = z0
    }
  }

  /**
   * 构图包围盒。**不能用 `Box3.setFromObject` 量 SkinnedMesh 的动画包围盒**:蒙皮变形
   * 在 GPU 上做,CPU 侧的几何顶点从来不动,量出来永远是绑定姿态的盒子(症状:含跳跃
   * 在内的五个动作量出来高度全一样,于是跳跃腾空时头切出画面)。改量骨骼世界位置。
   */
  private computeUnionBox(nPerClip = 24): THREE.Box3 {
    const box = new THREE.Box3()
    const bones: THREE.Object3D[] = []
    this.model.traverse((node) => {
      if ((node as THREE.Bone).isBone) bones.push(node)
    })
    const names = Object.keys(this.clips)
    if (!names.length) {
      // 无动画时量绑定姿态。少了这一支循环一次都不执行,空 Box3 的 min/max 是 ±Infinity,
      // 相机位置算成 NaN,渲出全透明帧而不报错。
      box.expandByObject(this.model)
      return box
    }
    const v = new THREE.Vector3()
    for (const name of names) {
      this.useClip(name)
      for (let i = 0; i < nPerClip; i++) {
        this.sample(i, nPerClip)
        if (bones.length) {
          for (const bone of bones) box.expandByPoint(v.setFromMatrixPosition(bone.matrixWorld))
        } else {
          box.expandByObject(this.model)
        }
      }
    }
    if (bones.length) box.expandByScalar(0.1) // 骨骼是线,网格有厚度
    if (!Number.isFinite(box.min.y) || !Number.isFinite(box.max.y)) {
      throw new StageError('构图包围盒是空的 —— 相机会被算成 NaN 并渲出全透明帧')
    }
    return box
  }

  private placeCam(): void {
    const pad = 0.08
    const spanY = this.unionBox.max.y - this.unionBox.min.y + pad * 2
    const spanH =
      Math.max(
        this.unionBox.max.x - this.unionBox.min.x,
        this.unionBox.max.z - this.unionBox.min.z,
      ) +
      pad * 2
    this.orthoH = Math.max(spanY, spanH * (this.height / this.width), 1.2)

    // 基准视角:相机在 −X,屏幕右 = 前进轴 +Z,角色天然朝右。不用"把精灵水平镜像"
    // 代替 —— 角色左右不对称(单侧腕带),镜像会把不对称细节翻到另一边。
    let v: [number, number, number] = [-1, 0, 0]
    if (this.camYaw) {
      const r = (this.camYaw * Math.PI) / 180
      const c = Math.cos(r)
      const s = Math.sin(r)
      v = [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
    }
    const n = Math.hypot(v[0], v[1], v[2])
    const d = 4
    const cy = (this.unionBox.max.y + this.unionBox.min.y) / 2
    this.cam.position.set((v[0] / n) * d, cy + (v[1] / n) * d, (v[2] / n) * d)
    this.cam.lookAt(0, cy, 0)
    const aspect = this.width / this.height
    this.cam.top = this.orthoH / 2
    this.cam.bottom = -this.orthoH / 2
    this.cam.left = (-this.orthoH * aspect) / 2
    this.cam.right = (this.orthoH * aspect) / 2
    this.cam.updateProjectionMatrix()
  }

  private useClip(name: string): boolean {
    const clip = this.clips[name]
    if (!clip) return false
    this.mixer.stopAllAction()
    this.current = this.mixer.clipAction(clip)
    this.current.reset().play()
    return true
  }

  /** 摆到 clip 的第 i/n 个取样点。**不含尾点** —— 循环动画首尾重复会多一张卡顿帧。 */
  private sample(i: number, n: number): number {
    if (!this.current) return 0
    const t = (i / n) * this.current.getClip().duration
    this.mixer.setTime(0) // 先归零再定位,避免累积误差
    this.mixer.setTime(t)
    this.model.updateMatrixWorld(true)
    return t
  }

  availableClips(): Record<string, number> {
    return Object.fromEntries(
      Object.entries(this.clips).map(([name, clip]) => [name, +clip.duration.toFixed(4)]),
    )
  }

  rigInfo(): StageRigInfo {
    let bones = 0
    let skinned = 0
    let verts = 0
    this.model.traverse((node) => {
      if ((node as THREE.Bone).isBone) bones++
      const mesh = node as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh) skinned++
      if (mesh.isMesh) verts += mesh.geometry.attributes.position.count
    })
    return {
      loader: this.loader,
      rootBone: this.rootBone,
      bones,
      skinned,
      verts,
      orthoH: +this.orthoH.toFixed(4),
      material: this.material,
    }
  }

  setCamYaw(deg: number): void {
    this.camYaw = deg
    this.placeCam()
  }

  /** 摆姿势并渲一帧,返回该帧的采样时刻。 */
  setup(clip: string, i: number, n: number): number {
    if (!this.useClip(clip)) {
      throw new StageError(
        `模型里没有片段 ${JSON.stringify(clip)};有的是 ${JSON.stringify(Object.keys(this.clips))}`,
      )
    }
    const t = this.sample(i, n)
    this.renderer.render(this.scene, this.cam)
    return +t.toFixed(4)
  }

  /**
   * 本帧非透明像素占比。**与后端 `_coverage` 同一口径**(缩到 128 宽再数 alpha>8):
   * 两边算法不同的话,这边自检过了服务端再判一次会无故打回。
   */
  coverage(): number {
    this.renderer.render(this.scene, this.cam)
    const src = this.renderer.domElement
    const w = 128
    const h = Math.max(1, Math.round((src.height / src.width) * w))
    if (!this.probe) this.probe = document.createElement('canvas')
    this.probe.width = w
    this.probe.height = h
    const ctx = this.probe.getContext('2d', { willReadFrequently: true })!
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(src, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    let n = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++
    return n / (w * h)
  }

  /** 取这一帧的 PNG。**从 WebGL 缓冲取,不截页面** —— 见文件头第 1 条。 */
  async grab(): Promise<Blob> {
    this.renderer.render(this.scene, this.cam)
    const blob = await new Promise<Blob | null>((resolve) =>
      this.renderer.domElement.toBlob(resolve, 'image/png'),
    )
    // 形状守卫:空画布时浏览器会给出 0 字节或非 PNG 的产物,而下游只按"有没有文件"
    // 收帧,坏帧会一路当成正常产物交付。覆盖率自检是第二道,这里先炸得更早更清楚。
    if (!blob || blob.size === 0) throw new StageError('截取到空帧(WebGL 缓冲取不出内容)')
    return blob
  }

  dispose(): void {
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.probe = null
  }
}
