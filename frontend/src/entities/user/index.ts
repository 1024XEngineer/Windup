/** 已认证用户在前端领域层的稳定表示。 */
export interface User {
  id: string
  email: string
  nickname: string | null
  emailVerifiedAt: string | null
  statusCode: number
}

/** 一次认证成功后由后端签发的完整会话材料。 */
export interface AuthTokens {
  accessToken: string
  refreshToken: string
  user: User
}

export type SendCodePurpose = 'login' | 'register' | 'reset_password'

/** 用户认证与账户设置的后端接口。 */
export interface UserApis {
  sendCode(input: { email: string; purpose: SendCodePurpose }): Promise<void>
  register(input: {
    email: string
    password: string
    code: string
    nickname?: string
    inviteCode: string
  }): Promise<AuthTokens>
  /** 密码登录不带验证码；验证码只用于注册、免密登录与重设密码。 */
  login(input: { email: string; password: string }): Promise<AuthTokens>
  loginByCode(input: { email: string; code: string }): Promise<AuthTokens>
  refresh(refreshToken: string): Promise<AuthTokens>
  logout(refreshToken: string): Promise<void>
  me(): Promise<User>
  updateNickname(nickname: string): Promise<User>
  changePassword(input: { oldPassword: string; newPassword: string }): Promise<void>
}

export { createUserApis, userApis } from './api'
export type { CreateUserApisOptions } from './api'
