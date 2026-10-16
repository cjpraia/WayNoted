// Embeddings locais da Apple (NLContextualEmbedding, macOS 14+), 100% on-device.
// Uso: `workspace-native embed --status` -> {available, dimension, model, reason?}
//      `workspace-native embed` com {"texts":[...],"script":"latin"} no stdin -> {vectors:[[...]], dimension, model}
// Em macOS anterior ao 14, sem os recursos do idioma ou em qualquer falha: erro estruturado (o app cai no léxico).
import Foundation
import NaturalLanguage

private let embeddingModelName = "apple-nl-contextual"

// Português e inglês usam o script latino; outros scripts ficam para depois.
@available(macOS 14.0, *)
private func embeddingScript(_ name: String?) -> NLScript { .latin }

@available(macOS 14.0, *)
private func loadContextualEmbedding(_ scriptName: String?, allowDownload: Bool) -> NLContextualEmbedding? {
  guard let embedding = NLContextualEmbedding(script: embeddingScript(scriptName)) else { return nil }
  if !embedding.hasAvailableAssets {
    guard allowDownload else { return nil }
    // Baixa os recursos do sistema (feito pela Apple; nenhum texto do usuário sai do computador).
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    embedding.requestAssets { result, _ in granted = (result == .available); semaphore.signal() }
    _ = semaphore.wait(timeout: .now() + 120)
    if !granted { return nil }
  }
  do { try embedding.load() } catch { return nil }
  return embedding
}

/// Vetor do texto = média dos vetores dos tokens (normalizada pelo chamador).
@available(macOS 14.0, *)
private func embedText(_ text: String, with embedding: NLContextualEmbedding) -> [Double]? {
  let clipped = String(text.prefix(4000))
  guard !clipped.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        let result = try? embedding.embeddingResult(for: clipped, language: nil) else { return nil }
  var sum = [Double](repeating: 0, count: embedding.dimension)
  var count = 0.0
  result.enumerateTokenVectors(in: clipped.startIndex..<clipped.endIndex) { vector, _ in
    if vector.count == sum.count { for i in 0..<vector.count { sum[i] += vector[i] }; count += 1 }
    return true
  }
  if count == 0 { return nil }
  return sum.map { $0 / count }
}

func runEmbed(_ arguments: [String]) {
  let statusOnly = arguments.contains("--status")
  guard #available(macOS 14.0, *) else {
    if statusOnly { emit(["available": false, "reason": "UNSUPPORTED_OS", "model": embeddingModelName]); exit(0) }
    fail("EMBEDDING_UNAVAILABLE", "NLContextualEmbedding requires macOS 14 or later.")
  }
  let input = statusOnly ? [:] : readJSONInput()
  let scriptName = (input["script"] as? String) ?? option("--script", in: arguments)
  let allowDownload = (input["download"] as? Bool) ?? arguments.contains("--download")
  guard let embedding = loadContextualEmbedding(scriptName, allowDownload: allowDownload) else {
    if statusOnly { emit(["available": false, "reason": "ASSETS_MISSING", "model": embeddingModelName]); exit(0) }
    fail("EMBEDDING_UNAVAILABLE", "Apple embedding assets are not available.")
  }
  if statusOnly { emit(["available": true, "dimension": embedding.dimension, "model": embeddingModelName]); exit(0) }
  guard let texts = input["texts"] as? [String] else { fail("INVALID_INPUT", "Expected {\"texts\": [string]}.") }
  var vectors: [[Double]] = []
  for text in texts.prefix(64) {
    // Texto vazio/ilegível => vetor zerado (o app ignora vetores nulos).
    vectors.append(embedText(text, with: embedding) ?? [Double](repeating: 0, count: embedding.dimension))
  }
  emit(["vectors": vectors, "dimension": embedding.dimension, "model": embeddingModelName])
  exit(0)
}
