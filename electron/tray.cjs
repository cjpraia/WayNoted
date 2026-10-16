const PRODUCT = require('../shared/product.json')
// Ícone na barra de menus (Tray) com ícone template monocromático desenhado em código.
const electron = require('electron')
const { badgeTitle } = require('./tray-tasks.cjs')

/** Rasteriza o ícone da marca (ladrilho com sol nascente sobre o horizonte; docs/DEVELOPMENT.md) em BGRA,
 *  monocromático (template do macOS), com antisserrilhamento por supersampling. Coordenadas em pontos de 16×16. */
function trayBitmap(size, platform = process.platform) {
  const s = size / 16, buffer = Buffer.alloc(size * size * 4)
  // Distância até o contorno de um retângulo arredondado (positiva fora, negativa dentro).
  const roundRect = (px, py, cx, cy, hw, hh, r) => {
    const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
  }
  const covered = (px, py) =>
    Math.abs(roundRect(px, py, 8, 8, 6.4, 6.4, 3.6)) <= 0.65 || // ladrilho
    (py <= 9.6 && Math.hypot(px - 8, py - 9.6) <= 3) || // sol nascente
    segDist(px, py, 4.4, 9.6, 11.6, 9.6) <= 0.62 || // horizonte
    segDist(px, py, 6.2, 12, 9.8, 12) <= 0.55 // linha de nota
  const N = 4
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let hits = 0
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) if (covered((x + (sx + 0.5) / N) / s, (y + (sy + 0.5) / N) / s)) hits++
    const alpha = Math.round((hits / (N * N)) * 255), i = (y * size + x) * 4
    buffer[i] = platform === 'win32' ? 180 : 0; buffer[i + 1] = platform === 'win32' ? 120 : 0; buffer[i + 2] = platform === 'win32' ? 60 : 0; buffer[i + 3] = alpha
  }
  return buffer
}

function trayImage(el = electron) {
  const { nativeImage } = el
  const image = nativeImage.createFromBitmap(trayBitmap(16), { width: 16, height: 16, scaleFactor: 1 })
  image.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: trayBitmap(32) })
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}

/**
 * deps: { t(pt, en), recents() → Promise<[{ id, title, workspaceId }]>, quickNote(), search(), openApp(), openPage(item), preferences(), quit(),
 *         todayTasks?() → { items:[{ id, title, overdue }], total, overdue } | null, taskPrefs?() → { trayTasks, trayCount }, completeTask?(id), openToday?() }
 */
function createTray(deps) {
  const el = deps.electron ?? electron // injetável nos testes
  let tray = null
  async function menuTemplate() {
    const t = deps.t
    const recents = (await Promise.resolve(deps.recents()).catch(() => [])).slice(0, 5)
    const showTasks = deps.todayTasks && (deps.taskPrefs?.().trayTasks !== false)
    const snapshot = showTasks ? deps.todayTasks() : null
    // Hoje: item clicável conclui a tarefa (✓); o rótulo "!" marca as atrasadas.
    const taskItems = !showTasks ? [] : [
      { label: t('Hoje', 'Today') + (snapshot?.total ? ` (${snapshot.total})` : ''), enabled: false },
      ...(snapshot?.items.length ? snapshot.items.map(item => ({ label: `${item.overdue ? '! ' : '✓ '}${item.title || t('Sem título', 'Untitled')}`, sublabel: item.overdue ? t('Atrasada · clique para concluir', 'Overdue · click to complete') : t('Clique para concluir', 'Click to complete'), click: () => deps.completeTask?.(item.id) })) : [{ label: t('Nada para hoje', 'Nothing for today'), enabled: false }]),
      ...(snapshot && snapshot.total > snapshot.items.length ? [{ label: t(`+ ${snapshot.total - snapshot.items.length} mais…`, `+ ${snapshot.total - snapshot.items.length} more…`), click: () => deps.openToday?.() }] : []),
      { label: t('Abrir Meu dia', 'Open My day'), click: () => deps.openToday?.() },
      { type: 'separator' },
    ]
    return [
      { label: t('Nova nota rápida', 'New quick note'), accelerator: deps.shortcut?.() || undefined, registerAccelerator: false, click: () => deps.quickNote() },
      { label: t('Buscar…', 'Search…'), click: () => deps.search() },
      { label: t(`Abrir o ${PRODUCT.name}`, `Open ${PRODUCT.name}`), click: () => deps.openApp() },
      { type: 'separator' },
      ...taskItems,
      { label: t('Recentes', 'Recent'), enabled: false },
      ...(recents.length ? recents.map(item => ({ label: (item.title || t('Sem título', 'Untitled')).slice(0, 60), click: () => deps.openPage(item) })) : [{ label: t('Nenhuma página recente', 'No recent pages'), enabled: false }]),
      { type: 'separator' },
      { label: t('Preferências…', 'Preferences…'), click: () => deps.preferences() },
      { type: 'separator' },
      { label: t(`Sair do ${PRODUCT.name}`, `Quit ${PRODUCT.name}`), click: () => deps.quit() },
    ]
  }
  async function buildMenu() { return el.Menu.buildFromTemplate(await menuTemplate()) }
  async function popUp() { if (!tray) return; const menu = await buildMenu(); tray?.popUpContextMenu(menu) }
  function setVisible(visible) {
    if (visible && !tray) {
      tray = new el.Tray(trayImage(el))
      tray.setToolTip(`${PRODUCT.name}`)
      tray.on('click', () => void popUp())
      tray.on('right-click', () => void popUp())
      refreshTitle()
    } else if (!visible && tray) { tray.destroy(); tray = null }
  }
  /** Contador no título do ícone (ao lado dele na barra de menus). Chamado a cada retrato novo e a cada mudança de preferência. */
  function refreshTitle() {
    if (!tray) return
    const prefs = deps.taskPrefs?.() ?? {}
    const snapshot = prefs.trayTasks === false ? null : deps.todayTasks?.()
    tray.setTitle(badgeTitle(snapshot, !!prefs.trayCount), { fontType: 'monospacedDigit' })
    tray.setToolTip(snapshot?.total && prefs.trayTasks !== false ? deps.t(`${PRODUCT.name} · ${snapshot.total} para hoje`, `${PRODUCT.name} · ${snapshot.total} for today`) : `${PRODUCT.name}`)
  }
  return { refreshTitle, setVisible, menuTemplate, buildMenu, isVisible: () => !!tray, tray: () => tray }
}

module.exports = { createTray, trayBitmap }
