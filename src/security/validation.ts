// Live validation for password forms (same rules as electron/vault.cjs). Computed from the
// current field values on every render, so a message disappears as soon as the input is valid.
export const MIN_PASSWORD = 8
export const MAX_HINT = 120
export type PasswordProblem = 'short' | 'mismatch' | 'hintLong' | 'hintHasPassword'

export function passwordProblem(password: string, confirm: string, hint = ''): PasswordProblem | null {
  if ([...password].length < MIN_PASSWORD) return 'short'
  if (password !== confirm) return 'mismatch'
  const cleanHint = hint.replace(/\s+/g, ' ').trim()
  if ([...cleanHint].length > MAX_HINT) return 'hintLong'
  if (cleanHint && cleanHint.toLocaleLowerCase().includes(password.toLocaleLowerCase())) return 'hintHasPassword'
  return null
}

export function problemMessage(problem: PasswordProblem, t: (pt: string, en: string, vars?: Record<string, string | number>) => string): string {
  if (problem === 'short') return t('Use uma senha com pelo menos {n} caracteres.', 'Use a password with at least {n} characters.', { n: MIN_PASSWORD })
  if (problem === 'mismatch') return t('As senhas não coincidem.', 'Passwords do not match.')
  if (problem === 'hintLong') return t('A dica pode ter no máximo {n} caracteres.', 'The hint can have at most {n} characters.', { n: MAX_HINT })
  return t('A dica não pode conter a senha.', 'The hint cannot contain the password.')
}
