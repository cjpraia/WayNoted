// Ditado com reconhecimento de fala on-device (SFSpeechRecognizer.requiresOnDeviceRecognition = true).
// Nunca recorre ao reconhecimento em servidor: sem suporte on-device para o idioma, encerra com ON_DEVICE_UNAVAILABLE.
// Eventos (uma linha JSON cada): ready, level, partial, final, error, end. Comando "stop" no stdin (ou EOF) encerra.
import AVFoundation
import Foundation
import Speech

private func speechAuthorizationName() -> String {
  switch SFSpeechRecognizer.authorizationStatus() {
  case .notDetermined: return "notDetermined"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .authorized: return "authorized"
  @unknown default: return "unknown"
  }
}

private func microphoneAuthorizationName() -> String {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .notDetermined: return "notDetermined"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .authorized: return "authorized"
  @unknown default: return "unknown"
  }
}

private final class DictationSession {
  let recognizer: SFSpeechRecognizer
  let engine = AVAudioEngine()
  var request: SFSpeechAudioBufferRecognitionRequest?
  var task: SFSpeechRecognitionTask?
  var generation = 0
  var segment = 0
  var lastText = ""
  var lastFirstTimestamp: TimeInterval = -1
  var stopping = false
  var finished = false
  var lastLevelAt = Date.distantPast

  init(recognizer: SFSpeechRecognizer) { self.recognizer = recognizer }

  func start() {
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    if format.channelCount == 0 || format.sampleRate == 0 { fail("NO_AUDIO_INPUT", "No microphone input is available.") }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      guard let self else { return }
      self.request?.append(buffer)
      self.reportLevel(buffer)
    }
    engine.prepare()
    do { try engine.start() } catch { fail("AUDIO_ENGINE_FAILED", error.localizedDescription) }
    startTask()
    emit(["type": "ready", "locale": recognizer.locale.identifier, "onDevice": true])
  }

  func reportLevel(_ buffer: AVAudioPCMBuffer) {
    let now = Date()
    guard now.timeIntervalSince(lastLevelAt) > 0.12, let data = buffer.floatChannelData?[0] else { return }
    lastLevelAt = now
    let count = Int(buffer.frameLength)
    if count == 0 { return }
    var sum: Float = 0
    for index in 0..<count { sum += data[index] * data[index] }
    let rms = sqrt(sum / Float(count))
    emit(["type": "level", "value": Double(min(1, rms * 12))])
  }

  func startTask() {
    generation += 1
    let current = generation
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = true
    request.taskHint = .dictation
    if #available(macOS 13.0, *) { request.addsPunctuation = true }
    self.request = request
    lastText = ""
    lastFirstTimestamp = -1
    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self, current == self.generation else { return }
      if let result {
        let text = result.bestTranscription.formattedString
        let first = result.bestTranscription.segments.first?.timestamp ?? 0
        // Alguns sistemas reiniciam a transcrição parcial após uma pausa sem marcar isFinal; preserva o trecho anterior.
        if !result.isFinal, !self.lastText.isEmpty, self.lastFirstTimestamp >= 0, first > self.lastFirstTimestamp + 0.5, !text.hasPrefix(self.lastText) {
          emit(["type": "final", "segment": self.segment, "text": self.lastText])
          self.segment += 1
        }
        self.lastText = text
        self.lastFirstTimestamp = first
        emit(["type": result.isFinal ? "final" : "partial", "segment": self.segment, "text": text])
        if result.isFinal {
          self.segment += 1
          self.lastText = ""
          if self.stopping { self.finish() } else { self.startTask() }
          return
        }
      }
      if let error {
        if self.stopping { self.finish(); return }
        let nsError = error as NSError
        // 1110 = nenhuma fala detectada; 216/301 = tarefa cancelada. Recomeça a escuta em vez de encerrar.
        if nsError.domain == "kAFAssistantErrorDomain" && [1110, 216, 301].contains(nsError.code) {
          if !self.lastText.isEmpty { emit(["type": "final", "segment": self.segment, "text": self.lastText]); self.segment += 1 }
          self.startTask()
          return
        }
        emit(["type": "error", "code": "RECOGNITION_FAILED", "message": "\(nsError.domain) \(nsError.code): \(nsError.localizedDescription)"])
        self.stopping = true
        self.finish()
      }
    }
  }

  func stop() {
    if stopping { return }
    stopping = true
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.finish() }
  }

  func finish() {
    if finished { return }
    finished = true
    if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
    if !lastText.isEmpty { emit(["type": "final", "segment": segment, "text": lastText]) }
    task?.cancel()
    emit(["type": "end"])
    exit(0)
  }
}

private var activeSession: DictationSession?

func runDictation(_ arguments: [String]) -> Never {
  let localeId = option("--locale", in: arguments) ?? "pt-BR"
  guard ["pt-BR", "en-US"].contains(localeId) else { fail("UNSUPPORTED_LOCALE", "Unsupported locale \(localeId).") }
  let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId))
  switch arguments.first {
  case "status":
    emit([
      "speech": speechAuthorizationName(),
      "microphone": microphoneAuthorizationName(),
      "recognizer": recognizer != nil,
      "onDevice": recognizer?.supportsOnDeviceRecognition ?? false,
      "available": recognizer?.isAvailable ?? false,
      "locale": localeId,
    ])
    exit(0)
  case "start":
    guard let recognizer else { fail("UNSUPPORTED_LOCALE", "No speech recognizer for \(localeId).") }
    if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
      let semaphore = DispatchSemaphore(value: 0)
      SFSpeechRecognizer.requestAuthorization { _ in semaphore.signal() }
      semaphore.wait()
    }
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: break
    case .restricted: fail("SPEECH_RESTRICTED", "Speech recognition is restricted on this Mac.")
    default: fail("SPEECH_DENIED", "Speech recognition permission was denied.")
    }
    if !recognizer.supportsOnDeviceRecognition { fail("ON_DEVICE_UNAVAILABLE", "On-device speech recognition is unavailable for \(localeId).") }
    if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
      let semaphore = DispatchSemaphore(value: 0)
      AVCaptureDevice.requestAccess(for: .audio) { _ in semaphore.signal() }
      semaphore.wait()
    }
    if AVCaptureDevice.authorizationStatus(for: .audio) != .authorized { fail("MIC_DENIED", "Microphone permission was denied.") }
    let session = DictationSession(recognizer: recognizer)
    activeSession = session
    recognizer.queue = OperationQueue.main
    session.start()
    // Lê comandos do stdin em segundo plano; "stop" ou EOF encerram com o texto final.
    DispatchQueue.global(qos: .userInitiated).async {
      while let line = readLine(strippingNewline: true) {
        if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
        if line.trimmingCharacters(in: .whitespaces) == "cancel" { DispatchQueue.main.async { emit(["type": "end", "cancelled": true]); exit(0) } ; return }
      }
      DispatchQueue.main.async { activeSession?.stop() }
    }
    // Limite de segurança: 30 minutos por sessão.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1800) { activeSession?.stop() }
    dispatchMain()
  default:
    fail("UNKNOWN_COMMAND", "Usage: workspace-native dictation status|start --locale pt-BR|en-US")
  }
}
