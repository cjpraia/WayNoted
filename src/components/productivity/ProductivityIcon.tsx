// Ícone do Painel de Produtividade — agora vem do registro central (barras crescentes, legível a 14–18 px).
// Mantido como componente próprio porque vários módulos (e testes) o importam por este caminho.
import { Icon } from '../ui/icons/Icon'

export function ProductivityIcon({ size = 18, strokeWidth = 1.75, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return <Icon name="productivity" size={size} strokeWidth={strokeWidth} className={className} />
}
