export type ProfileState = {
  nickname: string
  isLoading: boolean
  isFresh: boolean
  isSaving: boolean
  error: string | null
  success: string | null
}

export type ProfileAction =
  | { type: 'nicknameChanged'; nickname: string }
  | { type: 'refreshSucceeded'; nickname: string }
  | { type: 'refreshFailed'; error: string }
  | { type: 'validationFailed'; error: string }
  | { type: 'saveStarted' }
  | { type: 'saveSucceeded'; nickname: string }
  | { type: 'saveFailed'; error: string }
  | { type: 'sectionChanged' }

export function createProfileState(nickname: string): ProfileState {
  return {
    nickname,
    isLoading: true,
    isFresh: false,
    isSaving: false,
    error: null,
    success: null,
  }
}

export function profileReducer(state: ProfileState, action: ProfileAction): ProfileState {
  switch (action.type) {
    case 'nicknameChanged':
      return { ...state, nickname: action.nickname }
    case 'refreshSucceeded':
      return {
        ...state,
        nickname: action.nickname,
        isLoading: false,
        isFresh: true,
        error: null,
      }
    case 'refreshFailed':
      return { ...state, isLoading: false, isFresh: false, error: action.error }
    case 'validationFailed':
      return { ...state, error: action.error, success: null }
    case 'saveStarted':
      return { ...state, isSaving: true, error: null, success: null }
    case 'saveSucceeded':
      return {
        ...state,
        nickname: action.nickname,
        isFresh: true,
        isSaving: false,
        success: '昵称已更新。',
      }
    case 'saveFailed':
      return { ...state, isSaving: false, error: action.error }
    case 'sectionChanged':
      return { ...state, error: null, success: null }
  }
}

export type SecurityState = {
  code: string
  newPassword: string
  confirmPassword: string
  isSendingCode: boolean
  isChanging: boolean
  cooldownUntil: number | null
  error: string | null
  success: string | null
}

export type SecurityAction =
  | { type: 'codeChanged'; code: string }
  | { type: 'newPasswordChanged'; password: string }
  | { type: 'confirmPasswordChanged'; password: string }
  | { type: 'sendStarted' }
  | { type: 'sendSucceeded'; cooldownUntil: number }
  | { type: 'sendFailed'; error: string }
  | { type: 'validationFailed'; error: string }
  | { type: 'changeStarted' }
  | { type: 'changeFailed'; error: string }
  | { type: 'sectionChanged' }

export const initialSecurityState: SecurityState = {
  code: '',
  newPassword: '',
  confirmPassword: '',
  isSendingCode: false,
  isChanging: false,
  cooldownUntil: null,
  error: null,
  success: null,
}

export function securityReducer(state: SecurityState, action: SecurityAction): SecurityState {
  switch (action.type) {
    case 'codeChanged':
      return { ...state, code: action.code }
    case 'newPasswordChanged':
      return { ...state, newPassword: action.password }
    case 'confirmPasswordChanged':
      return { ...state, confirmPassword: action.password }
    case 'sendStarted':
      return { ...state, isSendingCode: true, error: null, success: null }
    case 'sendSucceeded':
      return {
        ...state,
        isSendingCode: false,
        cooldownUntil: action.cooldownUntil,
        error: null,
        success: '验证码已发送，请在 5 分钟内使用。',
      }
    case 'sendFailed':
      return { ...state, isSendingCode: false, error: action.error, success: null }
    case 'validationFailed':
      return { ...state, error: action.error, success: null }
    case 'changeStarted':
      return { ...state, isChanging: true, error: null, success: null }
    case 'changeFailed':
      return { ...state, isChanging: false, error: action.error }
    case 'sectionChanged':
      return {
        ...initialSecurityState,
        isChanging: state.isChanging,
        cooldownUntil: state.cooldownUntil,
      }
  }
}
