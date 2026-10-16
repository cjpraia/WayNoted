// Keep the project's original license intact and show bundled SDK terms in Setup.
import fs from 'node:fs'
import PRODUCT from '../shared/product.json' with { type: 'json' }
const own = fs.readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')
const sdk = fs.readFileSync(new URL('../native/windows/licenses/windows-sdk-LICENSE.txt', import.meta.url), 'utf8')
fs.writeFileSync(new URL('./windows-license.txt', import.meta.url), `${PRODUCT.name} — application license\n\n${own.trim()}\n\n${'='.repeat(72)}\nMicrosoft Windows SDK components — separate terms\n\nThe following terms apply to bundled Windows SDK components. They do not replace the application license above. Other third-party components retain their own licenses in THIRD-PARTY-NOTICES.md.\n\n${sdk.trim()}\n`)
