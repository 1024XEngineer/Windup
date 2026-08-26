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
  it('preserves password fields when a password change fails', () => {
    const withOldPassword = securityReducer(initialSecurityState, {
      type: 'oldPasswordChanged',
      password: 'old-password',
    })
    const withPasswords = securityReducer(withOldPassword, {
      type: 'newPasswordChanged',
      password: 'new-password-123',
    })
    const changing = securityReducer(withPasswords, { type: 'changeStarted' })
    const failed = securityReducer(changing, { type: 'changeFailed', error: '当前密码错误' })

    expect(failed).toEqual({
      oldPassword: 'old-password',
      newPassword: 'new-password-123',
      isChanging: false,
      error: '当前密码错误',
    })
  })

  it('clears sensitive fields and feedback when the active section changes', () => {
    const populated = {
      oldPassword: 'old-password',
      newPassword: 'new-password-123',
      isChanging: true,
      error: '旧错误',
    }

    expect(securityReducer(populated, { type: 'sectionChanged' })).toEqual({
      ...initialSecurityState,
      isChanging: true,
    })
  })
})
