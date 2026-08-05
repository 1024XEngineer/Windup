/** 已认证用户的前端领域表示。 */
export interface User {
  id: number
  email: string
  nickname: string | null
  emailVerifiedAt: string | null
  status: 'normal' | 'banned'
}

/** 一次认证成功后由后端签发的访问与刷新令牌。 */
export interface AuthTokens {
  accessToken: string
  refreshToken: string
  user: User
}

/** 用户认证与账户设置的后端接口。 */
export interface UserApis {
  sendCode(input: {
    email: string
    purpose: 'login' | 'register' | 'reset_password'
  }): Promise<void>
  register(input: {
    email: string
    password: string
    code: string
    nickname?: string
  }): Promise<AuthTokens>
  login(input: { email: string; password: string; code: string }): Promise<AuthTokens>
  loginByCode(input: { email: string; code: string }): Promise<AuthTokens>
  refresh(refreshToken: string): Promise<AuthTokens>
  logout(refreshToken: string): Promise<void>
  me(): Promise<User>
  changePassword(input: { oldPassword: string; newPassword: string }): Promise<void>
}
