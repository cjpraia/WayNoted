// JXA (osascript -l JavaScript): reconhece texto de uma imagem com o Vision do macOS, offline.
// Uso: osascript -l JavaScript ocr-vision.js /caminho/imagem.png
ObjC.import('Vision'); ObjC.import('Foundation')
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0])
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $({}))
  const request = $.VNRecognizeTextRequest.alloc.init
  request.recognitionLevel = 0
  request.usesLanguageCorrection = true
  request.recognitionLanguages = $(['pt-BR', 'en-US'])
  if (!handler.performRequestsError($([request]), Ref())) return ''
  const results = request.results, lines = []
  for (let i = 0; i < results.count; i++) { const candidates = results.objectAtIndex(i).topCandidates(1); if (candidates.count) lines.push(candidates.objectAtIndex(0).string.js) }
  return lines.join('\n')
}
