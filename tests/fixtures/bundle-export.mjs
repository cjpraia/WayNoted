// Fixtures próprias que imitam o formato de exportação do Export Bundle (Markdown & CSV e HTML).
// Nenhum conteúdo vem de material do Export Bundle: textos, ids e estrutura foram escritos para os testes.
import { zipSync, strToU8 } from 'fflate'

export const id = n => n.toString(16).padStart(32, 'a').slice(-32)
export const enc = path => path.split('/').map(encodeURIComponent).join('/')
// PNG 1×1 transparente.
export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0))

const A = id(0xa1), B = id(0xb2), C = id(0xc3), D = id(0xd4), E = id(0xe5), R1 = id(0x11), R2 = id(0x12), R3 = id(0x13), R4 = id(0x14)
export const IDS = { A, B, C, D, E, R1, R2, R3, R4 }

export function markdownExport() {
  const proj = `Projetos 🚀 ${A}`
  const tasks = `${proj}/Tarefas ${C}`
  const files = {
    [`${proj}.md`]: [
      '# Projetos 🚀',
      '',
      `Intro com **negrito**, *itálico*, ~~riscado~~, \`código\` e [link para Anotações](${enc(`Anotações ${B}.md`)}) e $\`E=mc^2\`$.`,
      '',
      `[Tarefas](${enc(`${proj}/Tarefas ${C}.csv`)})`,
      '',
      '## Lista',
      '',
      '- item 1',
      '    - aninhado',
      '- [ ] tarefa aberta',
      '- [x] tarefa feita',
      '1. um',
      '2. dois',
      '',
      '<aside>',
      '💡 Dica **importante**',
      '</aside>',
      '',
      '<details>',
      '<summary>Alternar</summary>',
      '',
      'Conteúdo escondido',
      '',
      '</details>',
      '',
      '> Citação famosa',
      '',
      '```python',
      "print('oi')",
      '```',
      '',
      '$$',
      '\\int x\\,dx',
      '$$',
      '',
      '| Coluna A | Coluna B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '---',
      '',
      `![diagrama.png](${enc(`${proj}/diagrama.png`)})`,
      '',
      `Menciona a linha [Linha Alfa](${enc(`${tasks}/Linha Alfa ${R1}.md`)}) e um [site](https://example.com).`,
      '',
      `Link quebrado [sumiu](${enc(`Inexistente ${id(0x99)}.md`)}).`,
    ].join('\n'),
    [`${proj}/diagrama.png`]: PNG,
    [`${proj}/Subpágina ${D}.md`]: `# Subpágina\n\nVolta para [Projetos](${enc(`../Projetos 🚀 ${A}.md`)}).\n`,
    [`${proj}/Tarefas ${C}.csv`]: tasksCsv(true),
    [`${proj}/Tarefas ${C}_all.csv`]: tasksCsv(false),
    [`${tasks}/Linha Alfa ${R1}.md`]: '# Linha Alfa\n\nStatus: Em andamento\nTags: urgente, cliente\nPrazo: October 7, 2026 → October 9, 2026\n\nCorpo da linha alfa.\n',
    [`${tasks}/Linha Beta ${R2}.md`]: '# Linha Beta\n\nStatus: Concluído\n\nCorpo beta.\n',
    [`Clientes ${E}.csv`]: '﻿Nome,Cidade,Tarefas\nAcme,São Paulo,' + `"Linha Alfa (${enc(`../Projetos 🚀 ${A}/Tarefas ${C}/Linha Alfa ${R1}.md`)})"` + '\nGlobex,Rio,\n',
    [`Clientes ${E}/Acme ${R3}.md`]: '# Acme\n\nCidade: São Paulo\n\nCliente desde 2020.\n',
    [`Clientes ${E}/Globex ${R4}.md`]: '# Globex\n\nCidade: Rio\n',
    // Nome em NFD (como no macOS) com link em NFC.
    [`Anotações ${B}.md`.normalize('NFD')]: '# Anotações\n\nTexto com café.\n'.normalize('NFD'),
  }
  return files
}

function tasksCsv(partial) {
  const header = 'Nome,Status,Tags,Prazo,Feito,Pontos,Site,Email,Telefone,Clientes'
  const clients = `"Acme (${enc(`../Clientes ${E}/Acme ${R3}.md`)})"`
  const rows = [
    `Linha Alfa,Em andamento,"urgente, cliente","October 7, 2026 → October 9, 2026",No,"1,250.5",https://example.com/a,alfa@example.com,+55 11 99999-0000,${clients}`,
    `Linha Beta,Concluído,cliente,"October 1, 2026 3:00 PM",Yes,3,https://example.com/b,beta@example.com,+55 21 98888-1111,`,
    `Linha Gama,Não iniciado,"interno, cliente",2026/10/20,No,7,,gama@example.com,,"Acme (${enc(`../Clientes ${E}/Acme ${R3}.md`)}), Globex (${enc(`../Clientes ${E}/Globex ${R4}.md`)})"`,
  ]
  return '﻿' + [header, ...(partial ? rows.slice(0, 2) : rows)].join('\n') + '\n'
}

export function htmlExport() {
  const F = id(0xf1), G = id(0xf2), H = id(0xf3), I = id(0xf4)
  const wiki = `Wiki ${F}`
  const books = `${wiki}/Livros ${G}`
  const shell = (title, header, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><article class="page sans"><header>${header}</header><div class="page-body">${body}</div></article></body></html>`
  const files = {
    'index.html': '<html><body><a href="Wiki%20' + F + '.html">Wiki</a></body></html>',
    [`${wiki}.html`]: shell('Wiki',
      `<img class="page-cover-image" src="${enc(`${wiki}/capa.png`)}" style="object-position:center 30%"/><div class="page-header-icon undefined"><span class="icon">📚</span></div><h1 class="page-title">Wiki</h1>`,
      [
        '<p>Texto <strong>forte</strong> e <em>ênfase</em> com <mark class="highlight-yellow_background">marca</mark>.</p>',
        '<h2>Seção</h2>',
        '<ul class="toggle"><li><details open=""><summary>Detalhes</summary><p>Interno do toggle</p></details></li></ul>',
        '<figure class="callout"><div style="font-size:1.5em"><span class="icon">⚠️</span></div><div style="width:100%">Cuidado aqui</div></figure>',
        '<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Feito</span></li><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Pendente</span></li></ul>',
        '<figure class="equation"><div class="equation-container"><span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">a^2+b^2=c^2</annotation></semantics></math></span></span></span></div></figure>',
        '<pre class="code"><code class="language-JavaScript">const x = 1</code></pre>',
        '<table class="simple-table"><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>c1</td><td>c2</td></tr></tbody></table>',
        `<figure class="link-to-page"><a href="${enc(`${wiki}/Livros ${G}.html`)}"><span class="icon">📖</span>Livros</a></figure>`,
        '<div class="column-list"><div class="column"><p>Esquerda</p></div><div class="column"><p>Direita</p></div></div>',
        `<figure class="image"><a href="${enc(`${wiki}/capa.png`)}"><img src="${enc(`${wiki}/capa.png`)}"/></a><figcaption>Legenda</figcaption></figure>`,
        '<blockquote>Uma citação</blockquote><hr/>',
        `<p>Veja <a href="${enc(`${books}/Duna ${H}.html`)}">Duna</a>.</p>`,
      ].join('')),
    [`${wiki}/capa.png`]: PNG,
    [`${books}.html`]: shell('Livros', '<h1 class="page-title">Livros</h1>',
      '<table class="collection-content"><thead><tr>'
      + '<th><span class="icon property-icon"><svg class="typesTitle"></svg></span>Nome</th>'
      + '<th><span class="icon property-icon"><svg class="typesSelect"></svg></span>Gênero</th>'
      + '<th><span class="icon property-icon"><svg class="typesNumber"></svg></span>Nota</th>'
      + '<th><span class="icon property-icon"><svg class="typesFormula"></svg></span>Dobro</th>'
      + '<th><span class="icon property-icon"><svg class="typesPerson"></svg></span>Autor</th>'
      + '<th><span class="icon property-icon"><svg class="typesRelation"></svg></span>Relacionados</th>'
      + '</tr></thead><tbody>'
      + `<tr><td class="cell-title"><a href="${enc(`Livros ${G}/Duna ${H}.html`)}">Duna</a></td><td><span class="selected-value select-value-color-purple">Ficção</span></td><td>9</td><td>18</td><td>Frank</td><td><a href="${enc(`Livros ${G}/Fundação ${I}.html`)}">Fundação</a></td></tr>`
      + `<tr><td class="cell-title"><a href="${enc(`Livros ${G}/Fundação ${I}.html`)}">Fundação</a></td><td><span class="selected-value select-value-color-blue">Clássico</span></td><td>8</td><td>16</td><td>Isaac</td><td></td></tr>`
      + '</tbody></table>'),
    [`${books}/Duna ${H}.html`]: shell('Duna', '<div class="page-header-icon undefined"><span class="icon">🏜️</span></div><h1 class="page-title">Duna</h1><table class="properties"><tbody><tr class="property-row property-row-select"><th>Gênero</th><td><span class="selected-value select-value-color-purple">Ficção</span></td></tr></tbody></table>', '<p>Resenha de Duna.</p>'),
    [`${books}/Fundação ${I}.html`]: shell('Fundação', '<h1 class="page-title">Fundação</h1>', '<p>Resenha.</p>'),
  }
  return { files, ids: { F, G, H, I } }
}

/** ZIP externo contendo "Part-1.zip" e "Part-2.zip", como em exportações grandes. */
export function nestedZip(files) {
  const names = Object.keys(files)
  const half = Math.ceil(names.length / 2)
  const part = list => zipSync(Object.fromEntries(list.map(name => [name, typeof files[name] === 'string' ? strToU8(files[name]) : files[name]])))
  return zipSync({ 'Export-1234-Part-1.zip': part(names.slice(0, half)), 'Export-1234-Part-2.zip': part(names.slice(half)) }, { level: 0 })
}

export function toSources(files) {
  return Object.entries(files).map(([path, data]) => ({ path, data: typeof data === 'string' ? strToU8(data) : data }))
}

/** Exportação sintética grande: `tops` páginas com `children` filhas cada + um banco com `rows` linhas. */
export function largeExport(tops = 50, children = 89, rows = 500) {
  const files = {}
  let n = 1
  for (let t = 0; t < tops; t++) {
    const top = `Página ${t} ${id(n++)}`
    const links = []
    for (let c = 0; c < children; c++) {
      const child = `Filha ${t}-${c} ${id(n++)}`
      links.push(`[Filha ${t}-${c}](${enc(`${top}/${child}.md`)})`)
      files[`${top}/${child}.md`] = `# Filha ${t}-${c}\n\nParágrafo **${c}** com [link](${enc(`../${top}.md`)}).\n\n- item\n- [x] feito\n`
    }
    files[`${top}.md`] = `# Página ${t}\n\n${links.join('\n\n')}\n`
  }
  const db = `Banco ${id(n++)}`
  const csv = ['Nome,Status,Pontos,Data']
  for (let r = 0; r < rows; r++) {
    const row = `Linha ${r} ${id(n++)}`
    csv.push(`Linha ${r},${['A', 'B', 'C'][r % 3]},${r},2026/10/${String(1 + (r % 28)).padStart(2, '0')}`)
    files[`${db}/${row}.md`] = `# Linha ${r}\n\nStatus: ${['A', 'B', 'C'][r % 3]}\nPontos: ${r}\n\nCorpo ${r}.\n`
  }
  files[`${db}.csv`] = csv.join('\n')
  return files
}
