/** 新建项目页：收集项目级约束，通过 ProjectApis 创建真实后端记录。 */
import { useState } from 'react'
import { useNavigate } from 'react-router'

import type { CharacterPerspective, DirectionalMovement, ProjectApis } from '@/entities'

export function ProjectCreatePage({ apis }: { apis: ProjectApis }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [perspective, setPerspective] = useState<CharacterPerspective>('side')
  const [movement, setMovement] = useState<DirectionalMovement>('single')
  const [size, setSize] = useState(256)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const project = await apis.create({
        name: name.trim(),
        perspective,
        directionalMovement: movement,
        spriteSize: { width: size, height: size },
      })
      navigate(`/projects/${encodeURIComponent(project.id)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '项目创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-semibold">新建项目</h1>
      <form className="mt-8 grid gap-5" onSubmit={(event) => void submit(event)}>
        <label className="grid gap-2 text-sm">
          <span>项目名称</span>
          <input
            required
            maxLength={48}
            className="border border-slate-300 px-3 py-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span>游戏视角</span>
          <select
            className="border border-slate-300 px-3 py-2"
            value={perspective}
            onChange={(event) => setPerspective(event.target.value as CharacterPerspective)}
          >
            <option value="side">横版侧视</option>
            <option value="top-down">俯视</option>
            <option value="isometric">2.5D</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          <span>移动方向</span>
          <select
            className="border border-slate-300 px-3 py-2"
            value={movement}
            onChange={(event) => setMovement(event.target.value as DirectionalMovement)}
          >
            <option value="single">单向</option>
            <option value="four-way">四向</option>
            <option value="eight-way">八向</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          <span>精灵尺寸</span>
          <select
            className="border border-slate-300 px-3 py-2"
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          >
            <option value="128">128 × 128</option>
            <option value="256">256 × 256</option>
            <option value="512">512 × 512</option>
          </select>
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          className="justify-self-start bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={submitting}
          type="submit"
        >
          {submitting ? '正在创建…' : '创建项目'}
        </button>
      </form>
    </section>
  )
}
