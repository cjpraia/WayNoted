document.documentElement.dataset.platform = window.api?.platform ?? (/Mac/.test(navigator.platform) ? 'darwin' : 'win32')
import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.ts'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import { App } from './App'
import './components/ui/controls.css'
// Identidade visual por último: sobrepõe estilos de componentes só via tokens (docs/DEVELOPMENT.md).
import './styles/identity.css'
// Foco, skip link e utilitários de acessibilidade por último (docs/USAGE.md).
import './styles/a11y.css'

createRoot(document.getElementById('root')!).render(<App />)

// Harness de desempenho opcional (src/perf): localStorage['workspace:perf'] = '1' e recarregar.
try { if (localStorage.getItem(COMPAT.record053) === '1') void import('./perf/harness') } catch { /* armazenamento indisponível */ }

document.title = PRODUCT.name
