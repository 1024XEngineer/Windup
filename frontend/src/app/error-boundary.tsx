import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * 全局错误边界。任何一页渲染时抛出的异常都在这里兜住，
 * 不让整个应用白屏。放在 AppShell 内部包住路由，出错时顶部导航仍可用，
 * 用户能自己走开，不必刷新。
 *
 * 只能用 class 写：React 至今没有等价的函数组件写法。
 */
interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 骨架阶段只打控制台；接监控是生产阶段的事，不在本次范围
    console.error('[Windup] 未捕获的渲染错误', error, info.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h2 className="text-lg font-medium text-red-900">这个页面出错了</h2>
        <p className="mt-2 text-sm text-red-700">{error.message}</p>
        <button
          type="button"
          onClick={this.reset}
          className="mt-4 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-900 hover:bg-red-100"
        >
          重试
        </button>
      </section>
    )
  }
}
