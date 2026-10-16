// Lembretes do macOS via EventKit (C3b). Só lê e grava no banco local do app Lembretes, numa lista escolhida (padrão "Workspace").
// O pedido de permissão só acontece no comando explícito `reminders request`, disparado por quem liga a opção em Configurações.
import EventKit
import Foundation

private func remindersAuthorizationName() -> String {
  switch EKEventStore.authorizationStatus(for: .reminder).rawValue {
  case 0: return "notDetermined"
  case 1: return "restricted"
  case 2: return "denied"
  case 3: return "fullAccess"
  case 4: return "writeOnly"
  default: return "unknown"
  }
}

private let remindersIsoFractional: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter
}()

private func requireRemindersAccess() {
  let status = remindersAuthorizationName()
  if status == "fullAccess" { return }
  let code = status == "notDetermined" ? "REMINDERS_ACCESS_NOT_DETERMINED" : "REMINDERS_ACCESS_DENIED"
  fail(code, "Reminders access is \(status).")
}

private func remindersListJSON(_ calendar: EKCalendar) -> [String: Any] {
  [
    "id": calendar.calendarIdentifier,
    "title": calendar.title,
    "source": calendar.source?.title ?? "",
    "allowsModify": calendar.allowsContentModifications,
  ]
}

/// Data (AAAA-MM-DD) e hora (HH:MM, se houver) do prazo do lembrete.
private func dueJSON(_ reminder: EKReminder) -> [String: Any]? {
  guard let components = reminder.dueDateComponents, let year = components.year, let month = components.month, let day = components.day else { return nil }
  var out: [String: Any] = ["date": String(format: "%04d-%02d-%02d", year, month, day)]
  if let hour = components.hour, let minute = components.minute { out["time"] = String(format: "%02d:%02d", hour, minute) }
  return out
}

private func reminderJSON(_ reminder: EKReminder) -> [String: Any] {
  var out: [String: Any] = [
    "id": reminder.calendarItemIdentifier,
    "listId": reminder.calendar?.calendarIdentifier ?? "",
    "title": reminder.title ?? "",
    "completed": reminder.isCompleted,
    "notes": reminder.notes ?? "",
    "url": reminder.url?.absoluteString ?? "",
    "modified": remindersIsoFractional.string(from: reminder.lastModifiedDate ?? reminder.creationDate ?? Date(timeIntervalSince1970: 0)),
  ]
  if let due = dueJSON(reminder) { out["due"] = due }
  if let done = reminder.completionDate { out["completedAt"] = remindersIsoFractional.string(from: done) }
  return out
}

private func findReminder(_ store: EKEventStore, _ id: String?) -> EKReminder? {
  guard let id, !id.isEmpty else { return nil }
  return store.calendarItem(withIdentifier: id) as? EKReminder
}

private func applyReminder(_ input: [String: Any], to reminder: EKReminder) {
  if let title = input["title"] as? String { reminder.title = String(title.prefix(500)) }
  if let notes = input["notes"] as? String { reminder.notes = String(notes.prefix(5000)) }
  if let link = input["url"] as? String, isWorkspaceLink(link), let url = URL(string: link) { reminder.url = url }
  if input["due"] is NSNull { reminder.dueDateComponents = nil }
  else if let due = input["due"] as? [String: Any], let date = due["date"] as? String {
    let parts = date.split(separator: "-").compactMap { Int($0) }
    if parts.count == 3 {
      var components = DateComponents()
      components.calendar = Calendar(identifier: .gregorian)
      components.year = parts[0]; components.month = parts[1]; components.day = parts[2]
      if let time = due["time"] as? String {
        let hm = time.split(separator: ":").compactMap { Int($0) }
        if hm.count == 2 { components.hour = hm[0]; components.minute = hm[1] }
      }
      reminder.dueDateComponents = components
    }
  }
  if let completed = input["completed"] as? Bool {
    reminder.isCompleted = completed
    if completed && reminder.completionDate == nil { reminder.completionDate = Date() }
  }
}

func runReminders(_ arguments: [String]) -> Never {
  switch arguments.first {
  case "status":
    emit(["authorization": remindersAuthorizationName()])
    exit(0)
  case "request":
    if remindersAuthorizationName() == "notDetermined" {
      let store = EKEventStore()
      let semaphore = DispatchSemaphore(value: 0)
      if #available(macOS 14.0, *) {
        store.requestFullAccessToReminders { _, _ in semaphore.signal() }
      } else {
        store.requestAccess(to: .reminder) { _, _ in semaphore.signal() }
      }
      semaphore.wait()
    }
    emit(["authorization": remindersAuthorizationName()])
    exit(0)
  case "lists":
    requireRemindersAccess()
    let store = EKEventStore()
    let lists = store.calendars(for: .reminder).sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    emit(["lists": lists.map(remindersListJSON), "defaultListId": store.defaultCalendarForNewReminders()?.calendarIdentifier ?? ""])
    exit(0)
  case "ensure-list":
    // Acha a lista pelo nome (ou pelo id guardado) e a cria se não existir. Nunca apaga listas.
    requireRemindersAccess()
    let input = readJSONInput()
    guard let title = input["title"] as? String, !title.trimmingCharacters(in: .whitespaces).isEmpty else { fail("INVALID_INPUT", "title is required.") }
    let store = EKEventStore()
    let lists = store.calendars(for: .reminder)
    if let id = input["id"] as? String, let found = lists.first(where: { $0.calendarIdentifier == id }) { emit(["list": remindersListJSON(found), "created": false]); exit(0) }
    if let found = lists.first(where: { $0.title == title && $0.allowsContentModifications }) { emit(["list": remindersListJSON(found), "created": false]); exit(0) }
    let list = EKCalendar(for: .reminder, eventStore: store)
    list.title = String(title.prefix(200))
    let source = store.defaultCalendarForNewReminders()?.source ?? store.sources.first(where: { $0.sourceType == .local }) ?? store.sources.first
    guard let source else { fail("REMINDERS_NO_SOURCE", "No account available for a new Reminders list.") }
    list.source = source
    do { try store.saveCalendar(list, commit: true) } catch { fail("REMINDERS_SAVE_FAILED", error.localizedDescription) }
    emit(["list": remindersListJSON(list), "created": true])
    exit(0)
  case "list":
    requireRemindersAccess()
    let input = readJSONInput()
    let store = EKEventStore()
    guard let listId = input["listId"] as? String, let list = store.calendar(withIdentifier: listId) else { fail("REMINDERS_LIST_NOT_FOUND", "The Reminders list no longer exists.") }
    let predicate = store.predicateForReminders(in: [list])
    var found: [EKReminder] = []
    let semaphore = DispatchSemaphore(value: 0)
    store.fetchReminders(matching: predicate) { result in found = result ?? []; semaphore.signal() }
    semaphore.wait()
    emit(["reminders": found.prefix(5000).map(reminderJSON)])
    exit(0)
  case "upsert":
    requireRemindersAccess()
    let input = readJSONInput()
    let store = EKEventStore()
    let reminder: EKReminder
    if let existing = findReminder(store, input["id"] as? String) { reminder = existing }
    else {
      guard let listId = input["listId"] as? String, let list = store.calendar(withIdentifier: listId) else { fail("REMINDERS_LIST_NOT_FOUND", "The Reminders list no longer exists.") }
      if !list.allowsContentModifications { fail("REMINDERS_READ_ONLY", "The chosen list is read-only.") }
      reminder = EKReminder(eventStore: store)
      reminder.calendar = list
      reminder.title = ""
    }
    applyReminder(input, to: reminder)
    do { try store.save(reminder, commit: true) } catch { fail("REMINDERS_SAVE_FAILED", error.localizedDescription) }
    emit(["reminder": reminderJSON(reminder)])
    exit(0)
  case "complete":
    requireRemindersAccess()
    let input = readJSONInput()
    let store = EKEventStore()
    guard let reminder = findReminder(store, input["id"] as? String) else { fail("REMINDER_NOT_FOUND", "The linked reminder no longer exists.") }
    let completed = (input["completed"] as? Bool) ?? true
    reminder.isCompleted = completed
    if !completed { reminder.completionDate = nil }
    do { try store.save(reminder, commit: true) } catch { fail("REMINDERS_SAVE_FAILED", error.localizedDescription) }
    emit(["reminder": reminderJSON(reminder)])
    exit(0)
  case "delete":
    requireRemindersAccess()
    let input = readJSONInput()
    let store = EKEventStore()
    guard let reminder = findReminder(store, input["id"] as? String) else { emit(["deleted": false]); exit(0) }
    do { try store.remove(reminder, commit: true) } catch { fail("REMINDERS_SAVE_FAILED", error.localizedDescription) }
    emit(["deleted": true])
    exit(0)
  default:
    fail("UNKNOWN_COMMAND", "Usage: workspace-native reminders status|request|lists|ensure-list|list|upsert|complete|delete")
  }
}
