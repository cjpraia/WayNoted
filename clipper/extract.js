// Extração "modo leitor" da página atual. Injetado sob demanda (activeTab + scripting) e SEM dependências:
// define window.__workspaceExtract(options) -> { title, url, site, image, selection, text, markdown?, capturedAt }.
// Nada sai da página aqui: quem envia (e só para 127.0.0.1) é popup.js. Testado em tests/clipper-extract.test.mts.
(function (root) {
  'use strict'
  var LIMITS = { text: 250000, markdown: 450000, selection: 90000, title: 300 }
  var DROP = 'script,style,noscript,template,iframe,object,embed,canvas,svg,form,dialog,button,input,select,textarea,video,audio,[hidden],[aria-hidden="true"]'
  var CHROME = 'nav,aside,footer,[role="navigation"],[role="banner"],[role="complementary"],[role="contentinfo"],[role="search"]'
  var NOISE = /(^|[\s_-])(nav|navbar|menu|sidebar|footer|comment|comments|share|sharing|social|promo|advert|ads?|related|newsletter|cookie|popup|modal|subscribe|breadcrumb|toolbar|paywall)([\s_-]|$)/i
  var TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_eid|mc_cid|igshid|ref_src)$/i

  function clean(value) { return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') }
  function oneLine(value) { return clean(value).replace(/\s+/g, ' ').trim() }
  function cut(value, max) { return value.length > max ? value.slice(0, max) : value }
  function absolute(href, base) {
    try { var u = new URL(href, base); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '' } catch (e) { return '' }
  }
  function meta(doc, names) {
    for (var i = 0; i < names.length; i++) {
      var el = doc.querySelector('meta[property="' + names[i] + '"],meta[name="' + names[i] + '"]')
      var value = el && el.getAttribute('content')
      if (value && value.trim()) return value.trim()
    }
    return ''
  }
  function textLen(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim().length }
  function linkDensity(el) {
    var total = textLen(el); if (!total) return 0
    var links = 0, anchors = el.querySelectorAll('a')
    for (var i = 0; i < anchors.length; i++) links += textLen(anchors[i])
    return links / total
  }
  function hiddenInline(el) { var s = el.getAttribute && el.getAttribute('style'); return !!s && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(s) }

  /** Escolhe o contêiner do texto principal: marcação semântica, senão o bloco com mais texto de parágrafos. */
  function pickMain(doc) {
    var semantic = ['article', '[role="main"]', 'main', '[itemprop="articleBody"]', '.post-content', '.entry-content', '.article-body', '.article-content', '#article', '#content']
    var best = null, bestLen = 0
    for (var i = 0; i < semantic.length; i++) {
      var found = doc.querySelectorAll(semantic[i])
      for (var j = 0; j < found.length; j++) {
        var len = textLen(found[j]) * (1 - Math.min(0.9, linkDensity(found[j])))
        if (len > bestLen) { best = found[j]; bestLen = len }
      }
      if (best && bestLen >= 400) return best
    }
    var scores = new Map(), paragraphs = doc.querySelectorAll('p, pre, blockquote, li')
    for (var k = 0; k < paragraphs.length; k++) {
      var p = paragraphs[k], len2 = textLen(p)
      if (len2 < 40) continue
      var parent = p.parentElement, grand = parent && parent.parentElement
      if (parent) scores.set(parent, (scores.get(parent) || 0) + len2)
      if (grand) scores.set(grand, (scores.get(grand) || 0) + len2 / 2)
    }
    scores.forEach(function (score, el) {
      var adjusted = score * (1 - Math.min(0.9, linkDensity(el)))
      if (adjusted > bestLen) { best = el; bestLen = adjusted }
    })
    return best || doc.body
  }

  function sanitize(source) {
    var copy = source.cloneNode(true)
    var drop = copy.querySelectorAll(DROP)
    for (var i = 0; i < drop.length; i++) drop[i].remove()
    var chrome = copy.querySelectorAll(CHROME)
    for (var c = 0; c < chrome.length; c++) if (chrome[c] !== copy) chrome[c].remove()
    var all = copy.querySelectorAll('*')
    for (var j = 0; j < all.length; j++) {
      var el = all[j]
      if (!copy.contains(el)) continue
      if (hiddenInline(el)) { el.remove(); continue }
      if (!/^(DIV|SECTION|UL|OL|SPAN|P)$/.test(el.tagName)) continue
      var label = (el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '')
      if (NOISE.test(label) && el !== copy && (textLen(el) < 600 || linkDensity(el) > 0.5) && !el.querySelector('h1,h2')) el.remove()
    }
    return copy
  }

  // ---- DOM -> Markdown ----
  function inline(node, base, ctx) {
    var out = ''
    for (var n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { out += clean(n.nodeValue).replace(/\s+/g, ' '); continue }
      if (n.nodeType !== 1) continue
      var tag = n.tagName.toLowerCase(), inner
      if (tag === 'br') { out += '  \n'; continue }
      if (tag === 'img') {
        var src = absolute(n.getAttribute('src') || n.getAttribute('data-src') || '', base), alt = oneLine(n.getAttribute('alt') || '')
        if (src) out += '![' + alt.replace(/[\[\]]/g, '') + '](' + src + ')'
        continue
      }
      if (/^(ul|ol|table|pre|blockquote|h[1-6]|p|div|section|figure|hr)$/.test(tag)) { out += '\n' + block(n, base, ctx) + '\n'; continue }
      inner = inline(n, base, ctx)
      if (!inner.trim()) { out += inner; continue }
      if (tag === 'a') {
        var href = absolute(n.getAttribute('href') || '', base)
        out += href ? '[' + inner.trim().replace(/[\[\]]/g, '') + '](' + href + ')' : inner
      } else if (tag === 'strong' || tag === 'b') out += '**' + inner.trim() + '**'
      else if (tag === 'em' || tag === 'i') out += '*' + inner.trim() + '*'
      else if (tag === 'del' || tag === 's' || tag === 'strike') out += '~~' + inner.trim() + '~~'
      else if (tag === 'code' || tag === 'kbd' || tag === 'samp') out += '`' + inner.replace(/`/g, "'") + '`'
      else out += inner
    }
    return out
  }
  function list(el, base, ctx, depth) {
    var ordered = el.tagName.toLowerCase() === 'ol', index = 1, lines = []
    for (var li = el.firstElementChild; li; li = li.nextElementSibling) {
      if (li.tagName.toLowerCase() !== 'li') continue
      var head = '', rest = []
      for (var n = li.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 1 && /^(ul|ol)$/i.test(n.tagName)) rest.push(list(n, base, ctx, depth + 1))
        else if (n.nodeType === 1 && /^(p|div)$/i.test(n.tagName)) head += ' ' + inline(n, base, ctx)
        else if (n.nodeType === 3) head += clean(n.nodeValue).replace(/\s+/g, ' ')
        else if (n.nodeType === 1) head += inline(wrap(n), base, ctx)
      }
      var pad = new Array(depth + 1).join('  ')
      lines.push(pad + (ordered ? index++ + '. ' : '- ') + head.replace(/\s+/g, ' ').trim())
      for (var r = 0; r < rest.length; r++) lines.push(rest[r])
    }
    return lines.join('\n')
  }
  function wrap(n) { var holder = n.ownerDocument.createElement('span'); holder.appendChild(n.cloneNode(true)); return holder }
  function table(el, base, ctx) {
    var rows = el.querySelectorAll('tr'), lines = []
    for (var i = 0; i < rows.length && i < 200; i++) {
      var cells = rows[i].querySelectorAll('th,td'), parts = []
      for (var j = 0; j < cells.length && j < 20; j++) parts.push(inline(cells[j], base, ctx).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim())
      if (!parts.length) continue
      lines.push('| ' + parts.join(' | ') + ' |')
      if (lines.length === 1) lines.push('|' + parts.map(function () { return '---' }).join('|') + '|')
    }
    return lines.join('\n')
  }
  function block(el, base, ctx) {
    var tag = el.tagName.toLowerCase(), m
    if ((m = /^h([1-6])$/.exec(tag))) { var h = oneLine(inline(el, base, ctx)); return h ? '\n' + new Array(+m[1] + 1).join('#') + ' ' + h + '\n' : '' }
    if (tag === 'ul' || tag === 'ol') return '\n' + list(el, base, ctx, 0) + '\n'
    if (tag === 'pre') {
      var code = clean(el.textContent || '').replace(/\n+$/, ''), lang = ''
      var c = el.querySelector('code'), cls = (c && c.getAttribute('class')) || el.getAttribute('class') || ''
      if ((m = /(?:language|lang)-([\w+-]+)/.exec(cls))) lang = m[1]
      return code ? '\n```' + lang + '\n' + code + '\n```\n' : ''
    }
    if (tag === 'blockquote') return '\n' + children(el, base, ctx).trim().split('\n').map(function (l) { return '> ' + l }).join('\n') + '\n'
    if (tag === 'table') return '\n' + table(el, base, ctx) + '\n'
    if (tag === 'hr') return '\n---\n'
    if (tag === 'figure') return '\n' + children(el, base, ctx).trim() + '\n'
    return children(el, base, ctx)
  }
  /** Filhos de um contêiner: blocos viram parágrafos separados por linha em branco. */
  function children(el, base, ctx) {
    var out = [], buffer = ''
    function flush() { var t = buffer.replace(/[ \t]+\n/g, '\n').trim(); if (t) out.push(t); buffer = '' }
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { buffer += clean(n.nodeValue).replace(/\s+/g, ' '); continue }
      if (n.nodeType !== 1) continue
      var tag = n.tagName.toLowerCase()
      if (/^(h[1-6]|ul|ol|pre|blockquote|table|hr|figure)$/.test(tag)) { flush(); var b = block(n, base, ctx).trim(); if (b) out.push(b) }
      else if (/^(p|div|section|article|main|header|li|dd|dt|figcaption|details|summary|address|center)$/.test(tag)) {
        flush()
        var hasBlock = n.querySelector('h1,h2,h3,h4,h5,h6,ul,ol,pre,blockquote,table,p,div,figure')
        var t = (hasBlock ? children(n, base, ctx) : inline(n, base, ctx)).trim()
        if (t) out.push(t)
      } else buffer += inline(wrap(n), base, ctx)
    }
    flush()
    return out.join('\n\n')
  }

  function toText(markdown) {
    return markdown
      .replace(/^```.*$/gm, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '').replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '').replace(/^\|?[\s|:-]+\|?$/gm, '')
      .replace(/(\*\*|~~|`|\*)/g, '').replace(/\n{3,}/g, '\n\n').trim()
  }

  function extractPage(options) {
    options = options || {}
    var doc = options.document || root.document, win = options.window || root, loc = (win && win.location) || doc.location
    var href = loc.href, parsed
    try { parsed = new URL(href); Array.from(parsed.searchParams.keys()).forEach(function (k) { if (TRACKING.test(k)) parsed.searchParams.delete(k) }); parsed.hash = ''; href = parsed.href } catch (e) { /* mantém href */ }
    var title = oneLine(meta(doc, ['og:title', 'twitter:title']) || doc.title || (doc.querySelector('h1') || {}).textContent || '')
    var site = oneLine(meta(doc, ['og:site_name', 'application-name']) || (parsed ? parsed.hostname.replace(/^www\./, '') : ''))
    var imageRaw = meta(doc, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'])
    var image = imageRaw ? absolute(imageRaw, href) : ''
    var selection = ''
    try { var sel = win.getSelection && win.getSelection(); selection = sel ? clean(sel.toString()).trim() : '' } catch (e) { selection = '' }
    var base = (doc.baseURI || href)
    var markdown = children(sanitize(pickMain(doc)), base, {}).replace(/\n{3,}/g, '\n\n').trim()
    var result = {
      title: cut(title, LIMITS.title), url: href, site: site, image: image, selection: cut(selection, LIMITS.selection),
      text: cut(toText(markdown), LIMITS.text), capturedAt: new Date().toISOString()
    }
    if (options.markdown) result.markdown = cut(markdown, LIMITS.markdown)
    if (options.selectionOnly && result.selection) { result.text = ''; delete result.markdown }
    return result
  }
  root.__workspaceExtract = extractPage
})(typeof globalThis !== 'undefined' ? globalThis : this)
