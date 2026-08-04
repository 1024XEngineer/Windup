/**
 * Workflow Editor Page 的公开入口。
 *
 * App 路由和测试只从目录入口引用页面，避免依赖内部文件布局；页面实现、
 * 卡片组件与样式可以在本目录继续拆分，而不会让上层路由同步改 import。
 */
export { WorkflowEditorPage } from './page'
export type { WorkflowEditorPageProps } from './page'
