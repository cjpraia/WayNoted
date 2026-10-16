import { Component, type ReactNode } from 'react'
import { translate, type Locale } from '../../localization.ts'

interface Props {
  children: ReactNode
  resetKey: string
  locale?: Locale
  onRetry: () => void
}

/** Keep page chrome/history available if a stored block cannot be rendered. */
export class EditorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }
  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    const t = (pt: string, en: string) => translate(this.props.locale ?? 'pt-BR', pt, en)
    return <div className="pg-load-error" role="alert">
      <strong>{t('Não foi possível exibir o conteúdo desta página.', 'Could not display this page’s content.')}</strong>
      <span>{t('O arquivo salvo foi preservado. O menu da página e o histórico continuam disponíveis para recuperar uma versão anterior.', 'The saved file was preserved. The page menu and version history remain available to recover an earlier version.')}</span>
      <span>{this.state.error.message}</span>
      <button type="button" onClick={this.props.onRetry}>{t('Recarregar conteúdo', 'Reload content')}</button>
    </div>
  }
}
