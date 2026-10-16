/** Electron owns the clipboard; browser clipboard permissions do not apply there. */
export async function copyText(text: string): Promise<void> {
  const nativeCopy = globalThis.window?.api?.copyText
  if (nativeCopy) { await nativeCopy(text); return }
  if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Área de transferência indisponível. / Clipboard unavailable.')
  await navigator.clipboard.writeText(text)
}
