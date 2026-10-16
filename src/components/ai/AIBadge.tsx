import { Cloud, Laptop } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PROVIDER_LABEL, isCloud, type ProviderId } from '../../ai/types.ts'
import './ai.css'

/** Indicador permanente de onde a IA roda: "Local" (Ollama neste Mac) ou o provedor em nuvem. */
export function AIBadge({ provider }: { provider: ProviderId }) {
  const { t } = useI18n()
  const cloud = isCloud(provider)
  const label = cloud ? PROVIDER_LABEL[provider] : t('Local', 'Local')
  return <span className={`ai-badge${cloud ? ' is-cloud' : ''}`} role="status" title={cloud ? t('Os pedidos vão para {name} (nuvem)', 'Requests go to {name} (cloud)', { name: PROVIDER_LABEL[provider] }) : t('Roda no Ollama deste Mac; nada sai do computador', 'Runs on Ollama on this Mac; nothing leaves the computer')} aria-label={cloud ? t('IA em nuvem: {name}', 'Cloud AI: {name}', { name: label }) : t('IA local', 'Local AI')}>
    {cloud ? <Cloud size={12} strokeWidth={1.8} aria-hidden /> : <Laptop size={12} strokeWidth={1.8} aria-hidden />}{label}
  </span>
}
