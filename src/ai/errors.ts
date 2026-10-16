// Códigos AI_* do processo principal (electron/ai/net.cjs) → mensagens claras PT/EN.
type Translate = (pt: string, en: string, vars?: Record<string, string | number>) => string
export interface ParsedAIError { code: string; retryAfter?: number; detail?: string; status?: number }

export function parseAIError(cause: unknown): ParsedAIError {
  const raw = cause instanceof Error ? cause.message : String(cause ?? '')
  const match = /(AI_[A-Z_]+|VAULT_LOCKED)((?:\|[^|]*)*)/.exec(raw)
  if (!match) return { code: /abort/i.test(raw) ? 'AI_CANCELLED' : 'AI_UNKNOWN', detail: raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 300) }
  const out: ParsedAIError = { code: match[1] }
  for (const part of match[2].split('|').filter(Boolean)) {
    const [key, ...rest] = part.split('='), value = rest.join('=')
    if (key === 'retryAfter') out.retryAfter = Number(value)
    else if (key === 'status') out.status = Number(value)
    else if (key === 'detail') out.detail = value
  }
  return out
}

const providerName = (id?: string) => id === 'openrouter' ? 'OpenRouter' : id === 'google' ? 'Google Gemini' : id === 'ollama' ? 'Ollama' : id || ''

export function aiErrorMessage(cause: unknown, t: Translate): string {
  const error = parseAIError(cause)
  const name = providerName(error.detail)
  switch (error.code) {
    case 'AI_CANCELLED': return t('Pedido cancelado.', 'Request cancelled.')
    case 'AI_AUTH': return t('Chave inválida ou revogada. Confira a chave em Configurações → IA.', 'Invalid or revoked key. Check the key in Settings → AI.')
    case 'AI_FORBIDDEN': return t('O provedor recusou o acesso (403). Verifique as permissões da chave ou a região.', 'The provider denied access (403). Check the key permissions or region.')
    case 'AI_PAYMENT': return t('Créditos insuficientes no provedor.', 'Insufficient credits at the provider.')
    case 'AI_NO_EMBEDDING': return t('Nenhum mecanismo de embeddings local disponível. A busca usa só palavras.', 'No local embedding engine is available. Search uses words only.')
    case 'AI_NOT_FOUND': return t('Modelo não encontrado. Escolha outro modelo da lista (no Ollama, baixe-o com "ollama pull").', 'Model not found. Pick another model from the list (for Ollama, download it with "ollama pull").')
    case 'AI_RATE_LIMIT': return error.retryAfter ? t('Limite de uso ou cota atingido. Tente de novo em {s} s.', 'Rate limit or quota reached. Try again in {s} s.', { s: error.retryAfter }) : t('Limite de uso ou cota atingido. Tente de novo em instantes.', 'Rate limit or quota reached. Try again shortly.')
    case 'AI_SERVER': return t('O provedor está com problemas (erro do servidor). Tente de novo mais tarde.', 'The provider is having trouble (server error). Try again later.')
    case 'AI_TIMEOUT': return t('O provedor demorou demais para responder.', 'The provider took too long to respond.')
    case 'AI_OFFLINE': return t('Sem conexão com o provedor. Para o Ollama: instale-o (ollama.com) e deixe-o aberto neste computador.', 'Could not reach the provider. For Ollama: install it (ollama.com) and keep it running on this computer.')
    case 'AI_TOO_LARGE': return t('A resposta passou do limite de tamanho e foi interrompida.', 'The response exceeded the size limit and was stopped.')
    case 'AI_INPUT_TOO_LARGE': return t('Reduza as instruções para 16 mil caracteres e o contexto para 128 mil.', 'Limit instructions to 16,000 characters and context to 128,000.')
    case 'AI_BAD_RESPONSE': case 'AI_REFUSED': return t('O modelo não retornou um resultado válido.', 'The model did not return a valid result.')
    case 'AI_BAD_REQUEST': return t('O provedor recusou o pedido.', 'The provider rejected the request.') + (error.detail ? ` (${error.detail})` : '')
    case 'AI_BLOCKED_HOST': case 'AI_INSECURE': case 'AI_REDIRECT': return t('Endereço não permitido para este provedor. Nada foi enviado.', 'Address not allowed for this provider. Nothing was sent.')
    case 'AI_CLOUD_BLOCKED': return t('Provedores em nuvem estão bloqueados em Configurações → IA. Nada foi enviado.', 'Cloud providers are blocked in Settings → AI. Nothing was sent.')
    case 'AI_CONSENT_REQUIRED': return t('Autorize o envio para {name} antes de usar este provedor.', 'Authorize sending to {name} before using this provider.', { name })
    case 'AI_NO_KEY': return t('Salve a chave de {name} em Configurações → IA.', 'Save the {name} key in Settings → AI.', { name })
    case 'AI_NO_MODEL': return error.detail === 'ollama' || !error.detail ? t('Nenhum modelo instalado no Ollama. Baixe um com "ollama pull" e atualize a lista.', 'No model installed in Ollama. Download one with "ollama pull" and refresh the list.') : t('Escolha um modelo de {name} em Configurações → IA.', 'Choose a {name} model in Settings → AI.', { name })
    case 'AI_NO_SOURCES': return t('Nada a enviar: os trechos eram de páginas protegidas, privadas para IA, da lixeira ou removidas.', 'Nothing to send: the excerpts were from protected, AI-private, trashed or removed pages.')
    case 'AI_CONFIRMATION_REQUIRED': return t('Confirme o envio na prévia.', 'Confirm the send in the preview.')
    case 'AI_EXPIRED': return t('O pedido expirou. Tente de novo.', 'The request expired. Try again.')
    case 'AI_KEY_INVALID_FORMAT': return t('Formato de chave inválido.', 'Invalid key format.')
    case 'AI_KEYCHAIN_UNAVAILABLE': return t('Keychain indisponível ou negado: a chave não foi lida/salva. Marque “Não guardar a chave” para usá-la só nesta sessão.', 'Keychain unavailable or denied: the key was not read/saved. Tick “Don’t store the key” to use it for this session only.')
    case 'AI_UNAVAILABLE': return t('A IA requer o aplicativo desktop.', 'AI requires the desktop app.')
    case 'AI_UNSUPPORTED': return t('Recurso não disponível neste provedor.', 'Feature not available for this provider.')
    case 'VAULT_LOCKED': return t('O espaço está bloqueado.', 'The workspace is locked.')
    default: return error.detail || t('Falha na IA.', 'AI failed.')
  }
}
