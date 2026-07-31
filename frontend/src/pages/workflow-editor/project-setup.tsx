/** 项目配置表单 */
import { useState } from 'react'

export interface ProjectContext {
  projectName: string
  view: 'side' | 'topdown' | 'isometric'
  directions: '1' | '4' | '8'
  canvasSize: '128' | '256' | '512'
  style: string
}

interface ProjectSetupProps {
  onSubmit: (context: ProjectContext) => void
}

export function ProjectSetup({ onSubmit }: ProjectSetupProps) {
  const [form, setForm] = useState<ProjectContext>({
    projectName: '',
    view: 'side',
    directions: '1',
    canvasSize: '256',
    style: '',
  })

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    onSubmit(form)
  }

  return (
    <section className="project-setup">
      <form className="project-setup__form" onSubmit={handleSubmit}>
        <header className="project-setup__form-head project-setup__wide">
          <h2>新建角色项目</h2>
        </header>

        <label className="project-setup__wide">
          <span>项目名称</span>
          <input
            required
            maxLength={48}
            value={form.projectName}
            onChange={(e) => setForm({ ...form, projectName: e.target.value })}
            placeholder="例如：雾港来信"
          />
        </label>

        <label>
          <span>游戏视角</span>
          <select value={form.view} onChange={(e) => setForm({ ...form, view: e.target.value as ProjectContext['view'] })}>
            <option value="side">横版侧视</option>
            <option value="topdown">俯视</option>
            <option value="isometric">2.5D</option>
          </select>
        </label>

        <label>
          <span>方向数量</span>
          <select value={form.directions} onChange={(e) => setForm({ ...form, directions: e.target.value as ProjectContext['directions'] })}>
            <option value="1">单向</option>
            <option value="4">四向</option>
            <option value="8">八向</option>
          </select>
        </label>

        <label>
          <span>角色画布尺寸</span>
          <select value={form.canvasSize} onChange={(e) => setForm({ ...form, canvasSize: e.target.value as ProjectContext['canvasSize'] })}>
            <option value="128">128 × 128</option>
            <option value="256">256 × 256</option>
            <option value="512">512 × 512</option>
          </select>
        </label>

        <label className="project-setup__wide">
          <span>美术风格</span>
          <textarea
            rows={3}
            maxLength={240}
            value={form.style}
            onChange={(e) => setForm({ ...form, style: e.target.value })}
            placeholder="例如：低饱和像素风、细长比例、深灰旅行服"
          />
        </label>

        <footer className="project-setup__wide">
          <button className="button button--primary" type="submit">
            进入创作画布 ↗
          </button>
        </footer>
      </form>
    </section>
  )
}
