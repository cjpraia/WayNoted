// Cabeçalho de painel lateral: título à esquerda, ações de ícone e "Fechar" sempre no canto direito (Fitts).
import type { ReactNode } from 'react'
import { IconButton } from './Button'
import { Icon } from './icons/Icon'
import { t } from '../../i18n'

export function PanelHeader({ title, actions, onBack, onClose }: { title: ReactNode; actions?: ReactNode; onBack?: () => void; onClose: () => void }) {
  return (
    <div className="np-panel-head">
      {onBack && <IconButton label={t('Voltar', 'Back')} onClick={onBack}><Icon name="back" size={16} /></IconButton>}
      <strong className="np-panel-head-title">{title}</strong>
      {actions}
      <IconButton label={t('Fechar painel', 'Close panel')} onClick={onClose}><Icon name="close" size={14} /></IconButton>
    </div>
  )
}
