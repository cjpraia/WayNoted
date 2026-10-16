type Translate = (pt: string, en: string) => string
export function localIntegrationError(cause: unknown, service: 'ai' | 'transcription', t: Translate): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  if (/abort|cancel/i.test(raw)) return t('Operação local cancelada.', 'Local operation cancelled.')
  if (service === 'ai') {
    if (/LOCAL_AI_MODEL_UNAVAILABLE/.test(raw)) return t('Escolha um modelo GGUF instalado neste dispositivo. Modelos remotos não são usados.', 'Choose a GGUF model installed on this device. Remote models are not used.')
    if (/LOCAL_AI_UNAVAILABLE|fetch failed|ECONNREFUSED/i.test(raw)) return t('Não foi possível acessar o Ollama local. Inicie-o no dispositivo e atualize a lista de modelos.', 'Could not connect to local Ollama. Start it on this device and refresh the model list.')
    if (/LOCAL_AI_INVALID_INPUT/.test(raw)) return t('Reduza as instruções para 16 mil caracteres e o contexto para 128 mil.', 'Limit instructions to 16,000 characters and context to 128,000.')
    if (/LOCAL_AI_GENERATION_FAILED|LOCAL_AI_INVALID_RESPONSE/.test(raw)) return t('O modelo local não retornou um resultado válido. Verifique o Ollama e tente novamente.', 'The local model did not return a valid result. Check Ollama and retry.')
  } else {
    if (/LOCAL_TRANSCRIPTION_RUNTIME/.test(raw)) return t('Instale whisper-cli e ffmpeg localmente antes de transcrever. Nenhum programa será instalado automaticamente.', 'Install whisper-cli and ffmpeg locally before transcribing. Nothing will be installed automatically.')
    if (/LOCAL_TRANSCRIPTION_INVALID_MODEL|ENOENT/.test(raw)) return t('O modelo selecionado não está disponível. Escolha um arquivo de modelo Whisper .bin válido.', 'The selected model is unavailable. Choose a valid Whisper .bin model file.')
    if (/LOCAL_TRANSCRIPTION_INVALID_INPUT/.test(raw)) return t('O áudio não pôde ser processado. Use uma gravação não vazia de até 100 MB em formato compatível.', 'The audio could not be processed. Use a nonempty recording up to 100 MB in a supported format.')
  }
  return raw
}
