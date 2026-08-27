import type {
  AdminRedemptionApis,
  CodeValidation,
  GeneratedCodes,
  GenerateCodesInput,
  RedemptionCodeStatus,
} from './types'

import { createApiClient, getApiAccessToken } from '@/shared/api'
import type { ApiClient, ApiClientOptions } from '@/shared/api'

interface AdminAccessDto {
  allowed: boolean
}

interface GeneratedCodesDto {
  count: number
  amount: number
  expires_at: string | null
  codes: string[]
}

interface CodeValidationDto {
  status: RedemptionCodeStatus
  amount: number | null
  expires_at: string | null
  redeemed_at: string | null
}

export interface CreateAdminRedemptionApisOptions extends ApiClientOptions {
  client?: ApiClient
}

function toGeneratedCodes(dto: GeneratedCodesDto): GeneratedCodes {
  return {
    count: dto.count,
    amount: dto.amount,
    expiresAt: dto.expires_at,
    codes: dto.codes,
  }
}

function toCodeValidation(dto: CodeValidationDto): CodeValidation {
  return {
    status: dto.status,
    amount: dto.amount,
    expiresAt: dto.expires_at,
    redeemedAt: dto.redeemed_at,
  }
}

export function createAdminRedemptionApis(
  options: CreateAdminRedemptionApisOptions = {},
): AdminRedemptionApis {
  const { client, ...clientOptions } = options
  const protectedClient =
    client ??
    createApiClient({
      ...clientOptions,
      getAccessToken: clientOptions.getAccessToken ?? getApiAccessToken,
    })

  return {
    async checkAccess() {
      await protectedClient.request<AdminAccessDto>('/admin/quota/redemption-codes/access')
    },
    async generateCodes(input: GenerateCodesInput) {
      return toGeneratedCodes(
        await protectedClient.request<GeneratedCodesDto>('/admin/quota/redemption-codes', {
          method: 'POST',
          json: {
            count: input.count,
            amount: input.amount,
            expires_at: input.expiresAt,
          },
          replayAfterAuth: false,
        }),
      )
    },
    async validateCode(code: string) {
      return toCodeValidation(
        await protectedClient.request<CodeValidationDto>('/admin/quota/redemption-codes/validate', {
          method: 'POST',
          json: { code },
          replayAfterAuth: false,
        }),
      )
    },
  }
}

let defaultApis: AdminRedemptionApis | undefined

function getDefaultApis(): AdminRedemptionApis {
  defaultApis ??= createAdminRedemptionApis()
  return defaultApis
}

export const adminRedemptionApis: AdminRedemptionApis = {
  checkAccess: () => getDefaultApis().checkAccess(),
  generateCodes: (input) => getDefaultApis().generateCodes(input),
  validateCode: (code) => getDefaultApis().validateCode(code),
}
