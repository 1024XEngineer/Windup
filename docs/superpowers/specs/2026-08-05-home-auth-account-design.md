# 首页登录与个人设置设计

## 目标

在现有 Windup 首页内完成真实邮箱认证和个人设置入口，严格对接 `xiaocheny214/DireSoul` 的 `feat/user-module` 后端，不伪造昵称编辑、头像、邮箱修改等后端不存在的能力。

## 已确认的产品边界

- 首页允许游客浏览。
- 快速开始、工作流、项目、历史和正式 Playtest 路由需要登录。
- 游客进入受保护路由时回到首页并打开登录界面；登录成功后恢复原目标。
- 登录状态在浏览器关闭后继续保留，最长使用后端 7 天 Refresh Token 生命周期。
- 个人资料只读展示邮箱、昵称、邮箱验证状态和账户状态。
- 个人设置只允许修改密码与退出登录。
- 不实现 OAuth、头像、昵称修改、邮箱修改或账号删除。

## 后端契约

接口来源为 `feat/user-module`：

| 方法 | 路径 | 请求 |
| --- | --- | --- |
| POST | `/auth/send-code` | `{ email, purpose: 'login' \| 'register' \| 'reset_password' }` |
| POST | `/auth/register` | `{ email, password, code, nickname? }` |
| POST | `/auth/login` | `{ email, password, code }` |
| POST | `/auth/login-by-code` | `{ email, code }` |
| POST | `/auth/refresh` | `{ refresh_token }` |
| POST | `/auth/logout` | `{ refresh_token }` |
| GET | `/auth/me` | Bearer Access Token |
| POST | `/auth/change-password` | `{ old_password, new_password }` |

登录、注册和刷新返回 `{ access_token, refresh_token, user }`。Access Token 生命周期为 15 分钟，Refresh Token 生命周期为 7 天。

## 前端结构

保持现有 `app → pages → features → entities → shared`：

- `entities/user`：用户类型、认证 DTO 转换和八个真实 HTTP 方法。
- `features/auth-session`：唯一认证状态、Refresh Token 持久化、Access Token 内存保存、自动刷新和路由保护。
- `pages/home/account-panel.tsx`：首页登录、注册和个人设置界面。
- `app`：装配 User API、认证 Provider、受保护路由和顶栏账户入口。

不增加 `application` 或 `capabilities`。

## Token 生命周期

Refresh Token 保存到 `localStorage` 的 `windup.auth.refresh-token`。Access Token 只保存在 React 内存状态，通过现有 `registerApiAccessTokenProvider` 注入全部业务请求。

页面启动时：

1. 没有 Refresh Token，进入游客状态。
2. 有 Refresh Token，调用 `/auth/refresh` 轮换两个 Token。
3. 使用新 Access Token 调用 `/auth/me`，取得完整用户资料。
4. 任何刷新失败都清除本地 Refresh Token并进入游客状态。

登录成功后根据 JWT `exp` 在到期前 60 秒自动刷新。浏览器从后台恢复时重新检查有效期。退出登录先调用后端；即使网络失败也清除本地会话，避免界面继续显示已登录。

## 首页交互

首页维持现有灰绿、墨黑、纸张质感的编辑式视觉。右上角增加账户按钮：游客显示“登录 / 注册”，登录后显示昵称，昵称为空时显示邮箱前缀。

账户界面覆盖在首页之上：

- 登录包含“验证码登录”和“密码登录”两个模式；后端要求密码登录也提交验证码。
- 注册包含邮箱、验证码、密码和可选昵称。
- 发码按钮带 60 秒倒计时，避免重复请求。
- 个人设置显示账户资料、修改密码表单和退出登录按钮。
- 所有请求错误使用后端统一错误消息，不把失败解释成成功。

## 路由保护

首页 `/` 和开发环境 `/playtest/demo` 保持公开。其余产品路由使用同一个 `ProtectedRoute`。游客访问时跳转到：

`/?account=login&returnTo=<原 pathname + search>`

登录成功只允许恢复以 `/` 开头的站内地址；非法或缺失目标回到首页。

## 验收

- User API 的八个方法严格匹配后端路径、字段和响应。
- Refresh Token 可跨浏览器重启恢复会话，Access Token 不写入持久存储。
- 注册、两种登录、刷新、资料读取、改密和退出都有错误状态。
- 游客可以浏览首页，但不能进入受保护页面。
- 登录成功恢复原目标。
- 个人设置不存在后端未提供的编辑功能。
- 全量测试、格式、Lint、类型检查和生产构建通过。
