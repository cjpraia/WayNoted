// Licenças: conferir as dependências e a licença não comercial do código próprio.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import PRODUCT from '../shared/product.json' with { type: 'json' }
import { WORKSPACE_LICENSE } from '../src/legal.ts'
import { classify, scan } from '../scripts/license-scan.mjs'

test('distribution metadata and interface match the unmodified standard noncommercial license', () => {
  const source = readFileSync(new URL('../LICENSE', import.meta.url))
  assert.equal(createHash('sha256').update(source).digest('hex'), 'c0ea4a896d2c8c394b29f9427589996db826cd501c512279ff0ed3ef48fabbe5', 'use the official license verbatim')
  assert.equal(readFileSync(new URL('../clipper/LICENSE', import.meta.url), 'utf8'), source.toString('utf8'))
  assert.equal(PRODUCT.license, 'PolyForm-Noncommercial-1.0.0')
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  assert.equal(manifest.license, PRODUCT.license)
  assert.equal(lock.packages[''].license, PRODUCT.license)
  assert.ok(WORKSPACE_LICENSE.pt.includes(PRODUCT.license) && WORKSPACE_LICENSE.pt.includes('uso não comercial'))
  assert.ok(WORKSPACE_LICENSE.en.includes(PRODUCT.license) && WORKSPACE_LICENSE.en.includes('noncommercial use'))
})

test('classificação de expressões SPDX', () => {
  assert.equal(classify('MIT'), 'permissive')
  assert.equal(classify('(MIT OR GPL-3.0-or-later)'), 'permissive', 'OR: vale a alternativa permissiva')
  assert.equal(classify('(MIT AND Zlib)'), 'permissive')
  assert.equal(classify('MPL-2.0'), 'weak')
  assert.equal(classify('(MPL-2.0 OR Apache-2.0)'), 'permissive')
  assert.equal(classify('LGPL-2.1'), 'lgpl')
  assert.equal(classify('GPL-3.0 OR PROPRIETARY'), 'forbidden', 'o caso do pacote XL de colunas')
  assert.equal(classify('GPL-3.0-only'), 'forbidden')
  assert.equal(classify('AGPL-3.0'), 'forbidden')
  assert.equal(classify('MIT AND GPL-2.0'), 'forbidden', 'AND: vale a pior parte')
  assert.equal(classify('SEE LICENSE IN LICENSE.md'), 'forbidden')
  assert.equal(classify('UNLICENSED'), 'forbidden')
  assert.equal(classify(''), 'forbidden')
  assert.equal(classify('Some-Unknown-1.0'), 'unknown')
})

test('nenhuma dependência que entra no app tem licença incompatível, e o pacote XL de colunas saiu', () => {
  const { bundle } = scan()
  assert.ok(bundle.length > 100, 'o fecho de dependências foi calculado')
  assert.deepEqual(bundle.filter((info) => info.kind === 'forbidden').map((info) => `${info.name}@${info.version}: ${info.license}`), [])
  assert.equal(bundle.some((info) => info.name === '@blocknote/xl-multi-column'), false)
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal('@blocknote/xl-multi-column' in { ...manifest.dependencies, ...manifest.devDependencies }, false)
  assert.ok(bundle.some((info) => info.name === '@blocknote/core' && info.kind === 'weak'), 'o BlockNote core (MPL-2.0) está no inventário')
})
