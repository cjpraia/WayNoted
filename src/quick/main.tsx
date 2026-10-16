import PRODUCT from '../../shared/product.json' with { type: 'json' }
import { createRoot } from 'react-dom/client'
import '../styles/tokens.css'
import './quick.css'
import '../styles/a11y.css'
import { QuickNote } from './QuickNote'

createRoot(document.getElementById('root')!).render(window.quickApi ? <QuickNote /> : <p className="qn-unavailable">{PRODUCT.name}</p>)

document.title = PRODUCT.name
