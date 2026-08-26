export interface GuideAction {
  label: string
  to: string
}

export interface GuideTopic {
  title: string
  description: string
  bullets?: readonly string[]
  example?: string
}

export interface GuideChapter {
  id: string
  index: string
  navLabel: string
  title: string
  summary: string
  topics: readonly GuideTopic[]
  action?: GuideAction
  tip?: string
}

export const guideChapters: readonly GuideChapter[] = [
  {
    id: 'getting-started',
    index: '01',
    navLabel: '开始使用',
    title: '先建项目，再开始制作角色',
    summary: '项目会保存游戏视角、方向、精灵尺寸和画风，让同一项目里的角色保持统一。',
    action: { label: '新建项目', to: '/projects/new' },
    topics: [
      {
        title: '注册或登录',
        description: '点击页面右上角的“注册”或“登录”，可以使用邮箱验证码或密码进入。',
        bullets: [
          '从邀请链接进入时，邀请码会自动填写。',
          '昵称、密码和积分记录可以稍后在账号页管理。',
        ],
      },
      {
        title: '填写项目设置',
        description: '输入项目名称，然后选择适合游戏的视角、方向、尺寸与画风。',
        bullets: [
          '方向可选单向、四向或八向。',
          '常用精灵尺寸为 128×128、256×256 和 512×512。',
          '像素、卡通、手绘和写实会影响后续生成效果。',
        ],
      },
      {
        title: '第一次推荐这样做',
        description: '先完整走通一次角色制作，再回来增加动作或细调结果。',
        example: '新建项目 → 创建角色 → 选择母版 → 确认方向首帧 → 生成动作 → 试玩 → 导出',
      },
    ],
  },
  {
    id: 'quick-start',
    index: '02',
    navLabel: 'Quick Start',
    title: '描述你想要的角色，按引导完成生成',
    summary: '适合第一次使用或希望快速完成标准流程的用户。',
    action: { label: '开始创建角色', to: '/quick-start' },
    topics: [
      {
        title: '设置创作条件',
        description: '发送第一条消息前，选择项目、画风和方向；也可以上传已有角色图片作为母版。',
        bullets: [
          '选择已有项目时，会自动使用项目的画风和方向。',
          '没有项目时保留“自动创建”即可。',
          '上传母版后，直接描述想新增的动作。',
        ],
      },
      {
        title: '写清角色特征',
        description: '尽量包含身份、发型、服装、配色、道具和整体气质。',
        example: '年轻的港口信使，短银发，深蓝短外套和红围巾，全身像，适合 2D RPG。',
      },
      {
        title: '先选择角色母版',
        description: '从候选中选出最满意的一张，再由它生成四向或八向首帧。',
        bullets: [
          '确认发型、服装、颜色和道具符合描述。',
          '检查全身是否完整，脚部是否被裁切。',
          '多方向应保持为同一个角色，只改变朝向。',
        ],
      },
      {
        title: '继续生成动作',
        description: '描述动作并确认首帧，Windup 会继续生成完整动画。',
        example: '轻快向前行走，红围巾随步伐轻微摆动，双臂自然摆动。',
      },
    ],
    tip: '如果中途离开，重新打开同一条创作记录即可继续；不要重复提交已经开始的步骤。',
  },
  {
    id: 'workflow-editor',
    index: '03',
    navLabel: '工作流编辑器',
    title: '需要更多控制时，逐个节点处理',
    summary: '适合想单独重做母版、首帧、完整动画或审核结果的用户。',
    action: { label: '新建工作流项目', to: '/projects/new?entry=workflow-editor' },
    topics: [
      {
        title: '按顺序完成节点',
        description: '节点会按照前后依赖排列，完成上一步后再继续下一步。',
        example: '角色设定 → 角色母版 → 动作首帧 → 生成方式 → 完整动画 → 动画审核',
      },
      {
        title: '一个角色增加多个动作',
        description: '角色设定和母版会被复用，每个动作拥有自己的首帧、动画和审核结果。',
      },
      {
        title: '只重做不满意的部分',
        description: '节点失败或结果不满意时，在对应节点重新生成；多方向可以只重试失败方向。',
      },
    ],
  },
  {
    id: 'assets',
    index: '04',
    navLabel: '项目资产',
    title: '管理角色、造型、动作和每一帧',
    summary: '制作完成的内容会保存在项目资产中，之后可以继续增加动作、试玩或导出。',
    action: { label: '查看项目资产', to: '/projects' },
    topics: [
      {
        title: '查看角色详情',
        description: '打开项目并选择角色，可以查看母版、造型、动作和完整帧序列。',
      },
      {
        title: '增加动作',
        description: '已有角色母版时，点击“增加动作”，选择 Quick Start 或工作流编辑器继续。',
      },
      {
        title: '整理像素效果',
        description: '像素素材可以使用“完美像素化”，进一步统一像素网格和颜色。',
      },
    ],
  },
  {
    id: 'playtest',
    index: '05',
    navLabel: '预览台',
    title: '亲手控制角色，检查动作效果',
    summary: '选择已经包含动作帧的造型，在浏览器中测试移动、待机和动作切换。',
    action: { label: '进入预览台', to: '/playtest' },
    topics: [
      {
        title: '打开可以试玩的角色',
        description: '可从角色详情、Quick Start 完成页或预览台最近记录进入。',
        bullets: ['角色至少需要一个带真实帧的动作。', '图片加载失败时点击“重试当前帧”。'],
      },
      {
        title: '默认键位',
        description: 'WASD 控制移动，Space 触发主动作，左 Shift 触发次动作。',
      },
      {
        title: '修改键位',
        description: '点击键帽后按下新键；发生冲突时会交换原有键位。',
        bullets: [
          'Escape 取消本次修改。',
          'Delete 或 Backspace 清除动作键。',
          '键位保存在当前浏览器，换设备后需要重新设置。',
        ],
      },
    ],
  },
  {
    id: 'export',
    index: '06',
    navLabel: '导出',
    title: '把角色素材下载到游戏项目',
    summary: '在角色详情或制作完成页点击“导出资产包”，浏览器会整理并下载 ZIP。',
    action: { label: '选择要导出的角色', to: '/projects' },
    topics: [
      {
        title: '资源包包含什么',
        description:
          '根据角色完成情况，资源包会包含母版、首帧、透明 PNG、Sprite Sheet、逐动作方向 GIF 预览和动画说明文件。',
      },
      {
        title: '导出失败怎么办',
        description: '按照页面提示检查缺失帧、图片尺寸、透明通道或资源读取问题，修复后重新导出。',
      },
      {
        title: '导出不会改变资产',
        description: '下载操作只整理现有素材，不会修改角色、动作或项目设置。',
      },
    ],
  },
  {
    id: 'help',
    index: '07',
    navLabel: '常见问题',
    title: '遇到问题时，先从当前步骤恢复',
    summary: '大多数中断、方向失败和页面冲突都不需要从头生成。',
    topics: [
      {
        title: '刷新后任务还在吗？',
        description: '重新打开同一条创作或工作流记录，页面会读取已经保存的进度。',
      },
      {
        title: '某一个方向失败了？',
        description: '点击该方向旁的重试按钮，已经成功的方向会继续保留。',
      },
      {
        title: '提示版本冲突？',
        description: '点击“加载最新版本”，避免用旧页面覆盖另一标签页刚刚保存的结果。',
      },
      {
        title: '无法进入预览台？',
        description: '确认角色已有造型，并且当前造型至少包含一个带真实帧的动作。',
      },
    ],
  },
]
