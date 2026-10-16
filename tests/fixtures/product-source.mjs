// Inline the real registry into standalone data-URL modules used by UI tests.
import PRODUCT from '../../shared/product.json' with { type: 'json' }
import COMPAT from '../../shared/compatibility.mjs'
export function inlineProductSource(source) {
  return source
    .replace(/^import PRODUCT from [^\n]+\n/gm, `const PRODUCT = ${JSON.stringify(PRODUCT)};\n`)
    .replace(/^import COMPAT from [^\n]+\n/gm, `const COMPAT = ${JSON.stringify(COMPAT)};\n`)
}
