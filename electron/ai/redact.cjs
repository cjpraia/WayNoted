// Redação simples e opcional antes de enviar a provedores (docs/AI.md §3).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// Números longos (CPF, cartões, contas): 9+ dígitos, com separadores comuns.
const LONG_NUMBER = /\b\d(?:[\d.\-/ ]?\d){8,}\b/g
// Telefones: +55 (11) 91234-5678, (11) 1234-5678, 555-123-4567, +1 415 555 0100.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,3}\)\s?|\b\d{2,3}[\s.-])\d{3,5}[\s.-]?\d{4}\b/g

function redact(text) {
  return String(text ?? '').replace(EMAIL, '[e-mail]').replace(PHONE, '[telefone]').replace(LONG_NUMBER, '[número]')
}
module.exports = { redact }
