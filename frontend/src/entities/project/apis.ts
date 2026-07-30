/**
 * Project 资源对应的服务端接口集合。
 *
 * 方法采用直接的 list/get/create/update/remove 命名，表达具体业务操作，不引入通用存储
 * 抽象。当前只声明异步签名，URL、DTO 外壳、认证和错误处理等待后续实现 PR。
 */
import type { CreateProjectInput, Project, UpdateProjectInput } from './types'

/** Project 对应的一组服务端 API；本 PR 只声明调用形状。 */
export interface ProjectAPIs {
  /** 列出当前用户可访问的 Project。 */
  list(): Promise<Project[]>
  /** 按稳定 ID 读取单个 Project。 */
  get(projectId: Project['id']): Promise<Project>
  /** 创建 Quick Start 或手动流程所依赖的真实 Project。 */
  create(input: CreateProjectInput): Promise<Project>
  /** 更新 Project 的名称、视角、方向、尺寸或画风设置。 */
  update(projectId: Project['id'], input: UpdateProjectInput): Promise<Project>
  /** 删除指定 Project；关联资源处理规则由后端合同决定。 */
  remove(projectId: Project['id']): Promise<void>
}
