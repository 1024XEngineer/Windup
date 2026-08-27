import { describe, expect, it } from 'vitest'

import { createProfileState, initialSecurityState, profileReducer, securityReducer } from './state'

describe('account profile state', () => {
  it('tracks refresh and save transitions within the profile domain', () => {
    const refreshed = profileReducer(createProfileState('Cached Reader'), {
      type: 'refreshSucceeded',
      nickname: 'Fresh Reader',
    })
    const saving = profileReducer(refreshed, { type: 'saveStarted' })
    const saved = profileReducer(saving, { type: 'saveSucceeded', nickname: 'New Reader' })

    expect(refreshed).toMatchObject({
      nickname: 'Fresh Reader',
      isLoading: false,
      isFresh: true,
      error: null,
    })
    expect(saving).toMatchObject({ isSaving: true, error: null, success: null })
    expect(saved).toMatchObject({
      nickname: 'New Reader',
      isFresh: true,
      isSaving: false,
      success: '昵称已更新。',
    })
  })

  it('preserves edited profile data while clearing transient section feedback', () => {
    const failed = profileReducer(
      { ...createProfileState('Taken Name'), isLoading: false, success: '旧提示' },
      { type: 'saveFailed', error: '昵称已存在' },
    )

    expect(profileReducer(failed, { type: 'sectionChanged' })).toEqual({
      ...failed,
      error: null,
      success: null,
    })
  })
})

describe('account security state', () => {
  it('preserves verification and password fields when a password reset fails', () => {
    const withCode = securityReducer(initialSecurityState, {
      type: 'codeChanged',
      code: '123456',
    })
    const withPassword = securityReducer(withCode, {
      type: 'newPasswordChanged',
      password: 'new-password-123',
    })
    const withPasswords = securityReducer(withPassword, {
      type: 'confirmPasswordChanged',
      password: 'new-password-123',
    })
    const changing = securityReducer(withPasswords, { type: 'changeStarted' })
    const failed = securityReducer(changing, { type: 'changeFailed', error: '验证码错误' })

    expect(failed).toEqual({
      code: '123456',
      newPassword: 'new-password-123',
      confirmPassword: 'new-password-123',
      isSendingCode: false,
      isChanging: false,
      cooldownUntil: null,
      error: '验证码错误',
      success: null,
    })
  })

  it('tracks a sent verification code and its resend cooldown', () => {
    const sending = securityReducer(initialSecurityState, { type: 'sendStarted' })
    const sent = securityReducer(sending, { type: 'sendSucceeded', cooldownUntil: 123_000 })

    expect(sent).toMatchObject({
      isSendingCode: false,
      cooldownUntil: 123_000,
      error: null,
      success: '验证码已发送，请在 5 分钟内使用。',
    })
  })

  it('clears sensitive fields and feedback when the active section changes', () => {
    const populated = {
      code: '123456',
      newPassword: 'new-password-123',
      confirmPassword: 'new-password-123',
      isSendingCode: false,
      isChanging: true,
      cooldownUntil: 123_000,
      error: '旧错误',
      success: '旧提示',
    }

    expect(securityReducer(populated, { type: 'sectionChanged' })).toEqual({
      ...initialSecurityState,
      isChanging: true,
      cooldownUntil: 123_000,
    })
  })
})
