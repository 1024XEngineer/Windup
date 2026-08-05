/**
 * 旧导入路径的兼容出口。真正实现只保留在 index.ts，避免鉴权、错误处理和
 * 响应解析出现两套行为。
 */
export { ApiError, del, get, getPage, patch, post, request, upload } from './index'
