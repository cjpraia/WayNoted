// Helper nativo do Workspace: EventKit (Calendário e Lembretes) e Speech (ditado on-device).
// Protocolo: argumentos na linha de comando, entrada JSON opcional no stdin e saída em linhas JSON no stdout.
import Foundation

let outputLock = NSLock()

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
  outputLock.lock()
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
  outputLock.unlock()
}

func fail(_ code: String, _ message: String, exitCode: Int32 = 2) -> Never {
  emit(["error": ["code": code, "message": message]])
  exit(exitCode)
}

func readJSONInput() -> [String: Any] {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  if data.isEmpty { return [:] }
  guard let object = try? JSONSerialization.jsonObject(with: data, options: []), let dictionary = object as? [String: Any] else {
    fail("INVALID_INPUT", "Expected a JSON object on stdin.")
  }
  return dictionary
}

func option(_ name: String, in arguments: [String]) -> String? {
  guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
  return arguments[index + 1]
}

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "calendar": runCalendar(Array(arguments.dropFirst()))
case "dictation": runDictation(Array(arguments.dropFirst()))
case "embed": runEmbed(Array(arguments.dropFirst()))
case "reminders": runReminders(Array(arguments.dropFirst()))
case "version": emit(["version": 1, "name": "workspace-native"]); exit(0)
default: fail("UNKNOWN_COMMAND", "Usage: workspace-native calendar|reminders|dictation|embed|version")
}
