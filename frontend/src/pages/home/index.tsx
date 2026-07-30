import { HomeChoiceCard } from './choice-card'

/** 根入口只负责提供两种制作入口，不持有工作流业务状态。 */
export function HomePage() {
  return (
    <div className="relative left-1/2 -mb-8 -mt-24 w-screen -translate-x-1/2 overflow-hidden bg-[#e5e8e3] text-[#191b18]">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"
      />

      <section className="mx-auto grid min-h-screen max-w-5xl gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)] lg:items-center lg:py-14">
        <div className="flex h-full min-h-[32rem] flex-col justify-between py-1">
          <div>
            <p className="mt-14 font-mono text-[10px] font-semibold tracking-[0.16em] text-[#747973]">
              2D CHARACTER PRODUCTION WORKFLOW
            </p>
            <h1 className="mt-5 max-w-2xl font-serif text-[clamp(3.35rem,7vw,5.7rem)] font-medium leading-[0.98] tracking-[-0.065em]">
              让你的角色，
              <br />
              真正登场。
            </h1>
            <p className="mt-7 max-w-xl text-base leading-8 text-[#666b64]">
              从一句设定，到可检查、可修正、能进入游戏项目的 2D 动作资产。Windup
              把角色创作收拢在同一条制作线上。
            </p>
          </div>

          <ol
            aria-label="角色制作路径"
            className="mt-12 grid grid-cols-3 border-y border-[#cfd1ca] py-4"
          >
            {[
              ['01', '确认角色', '设定与母版'],
              ['02', '生成动作', '首帧与动画'],
              ['03', '检查交付', '审核与核验'],
            ].map(([index, label, detail]) => (
              <li
                key={index}
                className="border-r border-[#cfd1ca] px-4 first:pl-0 last:border-r-0 last:pr-0"
              >
                <span className="font-serif text-xs text-[#a2a69f]">{index}</span>
                <strong className="mt-2 block text-xs font-semibold">{label}</strong>
                <small className="mt-1 block text-[10px] text-[#747973]">{detail}</small>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute -inset-5 rounded-[2rem] border border-white/55"
          />
          <div className="relative rounded-[1.75rem] border border-white/80 bg-white/45 p-3 shadow-[0_28px_80px_rgba(25,27,24,0.12)] backdrop-blur-sm">
            <header className="flex flex-col gap-3 px-3 pb-4 pt-2 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
              <div>
                <p className="font-mono text-[9px] font-semibold tracking-[0.18em] text-[#8b9089]">
                  CHOOSE A STARTING POINT
                </p>
                <h2 className="mt-2 font-serif text-2xl font-medium tracking-[-0.03em]">
                  选择一个起点
                </h2>
              </div>
              <p className="max-w-56 text-[10px] leading-4 text-[#747973] sm:max-w-36 sm:text-right">
                快速开始负责连续创作，项目工作台适合逐步掌控。
              </p>
            </header>

            <div className="grid gap-3">
              <HomeChoiceCard
                to="/quick-start"
                eyebrow="ONE COMMAND"
                index="01"
                title="快速开始"
                description="用自然语言描述角色和动作，从同一套制作流程开始。"
                actionLabel="写下角色设定"
                tone="dark"
              />
              <HomeChoiceCard
                to="/projects"
                eyebrow="PROJECT WORKSPACE"
                index="02"
                title="从项目开始"
                description="进入已有项目，继续管理角色、造型与动作制作。"
                actionLabel="查看项目"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
