export type RedemptionCodeStatus = 'valid' | 'redeemed' | 'expired' | 'not_found' | 'invalid_format'

export interface GenerateCodesInput {
  count: number
  amount: number
  expiresAt: string | null
}

export interface GeneratedCodes {
  count: number
  amount: number
  expiresAt: string | null
  codes: string[]
}

export interface CodeValidation {
  status: RedemptionCodeStatus
  amount: number | null
  expiresAt: string | null
  redeemedAt: string | null
}

export interface AdminRedemptionApis {
  checkAccess(): Promise<void>
  generateCodes(input: GenerateCodesInput): Promise<GeneratedCodes>
  validateCode(code: string): Promise<CodeValidation>
}
