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
  note?: string
}

export const guideChapters: readonly GuideChapter[] = [
  {
    id: 'getting-started',
    index: '01',
    navLabel: '第一次使用',
    title: '先建立一条稳定的创作起点',
    summary: '账号、项目和基础画面约束只需设置一次，后续角色和动作都会沿用。',
    topics: [
      {
        title: '注册与登录',
        description: '从页面右上角进入账号面板，可以使用邮箱验证码或密码登录。',
        bullets: [
          '注册验证码为 6 位，有效期 5 分钟；重新发送前需等待 60 秒。',
          '密码长度为 8–128 位，昵称可在账号页继续修改。',
          '没有邀请码可直接注册；从邀请链接进入时会自动带入邀请码。',
        ],
      },
      {
        title: '创建项目',
        description: '项目决定角色资产的生产边界，建议在第一次生成前确认基础设置。',
        bullets: [
          '选择横版、俯视或 2.5D 游戏视角。',
          '选择单向、四向或八向，并设置 32–2048 像素的精灵尺寸。',
          '选择像素、卡通、手绘、写实或不指定画风。',
        ],
      },
      {
        title: '推荐路线',
        description: '首次使用时，按一条完整链路走完最容易理解 Windup。',
        example: '新建项目 → 描述角色 → 选择母版 → 确认方向首帧 → 生成动作 → 预览 → 导出',
      },
    ],
  },
  {
    id: 'quick-start',
    index: '02',
    navLabel: 'Quick Start',
    title: '用一次对话完成标准制作流程',
    summary: 'Quick Start 适合快速创作，并与 Workflow Editor 共用同一份可恢复工作流。',
    topics: [
      {
        title: '发送消息之前',
        description: '先选择项目、角色母版、画风和方向数量。第一轮开始后这些条件会锁定。',
        bullets: [
          '已有项目会继承项目画风和方向设置。',
          '上传角色母版后，输入框用于描述动作；留空时默认制作待机动作。',
          '没有项目时可以保留“自动创建”。',
        ],
      },
      {
        title: '描述并确认角色',
        description: '写清身份、外形、服装、道具和画面风格，Agent 会整理为可编辑提案。',
        example: '年轻的港口信使，短银发，深蓝短外套和红围巾，全身像，适合 2D RPG。',
      },
      {
        title: '选择同一个母版',
        description: '先从三张候选中确定角色，再基于这张母版生成多方向首帧。',
        bullets: [
          '检查发型、服装、配色和道具是否一致。',
          '确认全身完整、脚部未裁切、背景和文字不会干扰主体。',
          '某个方向失败时只重试该方向，成功结果会保留。',
        ],
      },
      {
        title: '生成完整动作',
        description: '确认动作首帧后继续生成完整帧，可播放、像素化、导出或继续增加动作。',
        example: '轻快向前行走，红围巾随步伐轻微摆动，双臂自然摆动。',
      },
    ],
    note: '中断自动制作只停止当前页面推进和订阅，不等于取消后端任务。重新打开记录后会从已保存的任务恢复。',
  },
  {
    id: 'workflow-editor',
    index: '03',
    navLabel: 'Workflow Editor',
    title: '逐节点审核并局部重试',
    summary: '需要人工控制时，在工作流画布中处理角色设定、母版、动作首帧、生成方式和审核。',
    topics: [
      {
        title: '共享角色基础',
        description: '角色设定和角色母版由所有动作共用，每条动作分支独立生成。',
        example: '角色设定 → 角色母版 → 动作首帧 → 生成方式 → 完整动画 → 动画审核',
      },
      {
        title: '节点操作',
        description: '按依赖顺序完成节点，审核通过后资产才进入完成状态。',
        bullets: [
          '角色母版可重新生成，也可填写微调描述后再次生成。',
          '动作首帧需要为所有必需方向选择候选。',
          '视频裁剪是通用路线；三渲二只对已有绑骨 3D 模型的造型开放。',
        ],
      },
      {
        title: '失败与重做',
        description: '先阅读节点错误；多方向任务可只重试失败方向，旧任务的迟到结果不会覆盖新结果。',
      },
    ],
  },
  {
    id: 'assets',
    index: '04',
    navLabel: '角色资产',
    title: '把角色、造型和动作留在项目里',
    summary: '资产库展示真实保存的角色母版、方向、动作与逐帧序列。',
    topics: [
      {
        title: '查看与管理',
        description: '进入项目后选择角色，可以切换造型、动作和方向，并展开完整帧序列。',
        bullets: [
          '项目可重命名；项目下仍有角色时不能删除。',
          '多方向动作可在卡片和完整帧区域切换当前方向。',
        ],
      },
      {
        title: '增加动作',
        description:
          '已有母版的角色可以通过 Quick Start 或 Workflow Editor 继续制作动作，不会创建另一套角色。',
      },
      {
        title: '完美像素化',
        description: '可播放动作可以进一步整理像素网格与色板；切换动作不会把旧任务结果套到新动作。',
      },
    ],
  },
  {
    id: 'playtest',
    index: '05',
    navLabel: '预览台',
    title: '用真实动作帧试玩角色',
    summary: '预览台只读取已保存且可播放的动作，不会修改角色资产或工作流。',
    topics: [
      {
        title: '进入预览',
        description: '可从角色详情、Quick Start 完成页、工作台或最近预览记录进入。',
        bullets: [
          '角色必须已有造型，且至少一个动作包含真实帧。',
          '资源加载失败时使用“重试当前帧”，页面不会用占位图伪装成功。',
        ],
      },
      {
        title: '默认键位',
        description: 'WASD 移动，Space 为主动作，左 Shift 为次动作。斜向速度会自动归一化。',
      },
      {
        title: '自定义绑定',
        description:
          '点击键帽后按下目标键；冲突时交换键位，Escape 取消，Delete 或 Backspace 清除动作键。',
        bullets: [
          '键位按账号隔离，但只保存在当前浏览器。',
          '换设备、无痕窗口或清理浏览器数据后需要重新设置。',
        ],
      },
    ],
  },
  {
    id: 'export',
    index: '06',
    navLabel: '导出资产',
    title: '把完成结果带进游戏项目',
    summary: '浏览器会检查素材、生成图片并打包 ZIP，不会修改服务器中的原始资产。',
    topics: [
      {
        title: '导出内容',
        description: '按当前完成阶段打包母版、首帧、透明 PNG、Sprite Sheet 和描述文件。',
        bullets: [
          'meta.json 描述动画，schema.json 描述资产契约。',
          '达到试玩阶段时会包含 playtest.json。',
          '资源包内附 README.md，便于在游戏项目中识别目录。',
        ],
      },
      {
        title: '导出前检查',
        description: '帧序号、声明帧数、透明通道、图片尺寸或资源读取不一致时会阻止导出。',
        bullets: ['按页面给出的具体错误修复资产后，点击“重新导出”。'],
      },
    ],
    note: '当前通用包支持 PNG、Sprite Sheet、JSON 和 ZIP；Cocos Creator 原生 .anim、.meta、UUID 与一键导入插件尚未进入主流程。',
  },
  {
    id: 'account',
    index: '07',
    navLabel: '账号与积分',
    title: '管理资料、登录安全和邀请奖励',
    summary: '账号页集中管理昵称、密码、积分流水与个人邀请信息。',
    topics: [
      {
        title: '个人资料与安全',
        description: '昵称长度为 1–50 个字符；修改密码后当前会话退出，需要重新登录。',
      },
      {
        title: '积分账户',
        description: '查看余额和流水，并按变动方向、业务类型与时间范围筛选。',
      },
      {
        title: '邀请奖励',
        description: '复制邀请码或专属链接。成功邀请后双方获得积分，每日奖励次数以账号页规则为准。',
      },
    ],
  },
  {
    id: 'troubleshooting',
    index: '08',
    navLabel: '恢复与排查',
    title: '任务没有消失，只是需要回到正确入口',
    summary: '刷新、并发编辑和方向失败都有明确恢复路径，不需要重复提交整个任务。',
    topics: [
      {
        title: '刷新后如何恢复？',
        description:
          '重新打开同一条 Quick Start 或 Workflow Editor 记录，系统会读取已有任务 ID 和最新状态。',
      },
      {
        title: '出现版本冲突？',
        description:
          '说明同一工作流已在其他标签页或设备更新。选择“加载最新版本”，不要用旧页面覆盖新结果。',
      },
      {
        title: '单个方向失败？',
        description: '使用方向旁的重试按钮，只重新提交失败源方向，其他成功方向保持不变。',
      },
      {
        title: '当前能力边界',
        description:
          'History 尚未注册产品入口；三渲二不负责创建 3D 模型；Playtest 键位不做跨设备云同步。',
      },
    ],
  },
]
