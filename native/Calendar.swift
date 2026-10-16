// Calendário do macOS via EventKit. Nenhuma conta é criada pelo app: lê e grava somente no banco local do Calendário.
// O pedido de permissão só acontece no comando explícito `calendar request`.
import EventKit
import CoreGraphics
import Foundation

private func authorizationName() -> String {
  // Usa rawValue para cobrir macOS 12/13 (authorized = 3) e 14+ (fullAccess = 3, writeOnly = 4) sem avisos de obsolescência.
  switch EKEventStore.authorizationStatus(for: .event).rawValue {
  case 0: return "notDetermined"
  case 1: return "restricted"
  case 2: return "denied"
  case 3: return "fullAccess"
  case 4: return "writeOnly"
  default: return "unknown"
  }
}

private let isoFractional: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter
}()
private let isoPlain: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime]
  return formatter
}()

private func parseDate(_ value: Any?, field: String) -> Date {
  guard let text = value as? String, let date = isoFractional.date(from: text) ?? isoPlain.date(from: text) else {
    fail("INVALID_INPUT", "Invalid date for \(field).")
  }
  return date
}

private func formatDate(_ date: Date) -> String { isoFractional.string(from: date) }

private func hexColor(_ color: CGColor?) -> String {
  guard let color, let space = CGColorSpace(name: CGColorSpace.sRGB),
        let converted = color.converted(to: space, intent: .defaultIntent, options: nil),
        let components = converted.components, components.count >= 3 else { return "#8a8f98" }
  let channel = { (value: CGFloat) in Int((max(0, min(1, value)) * 255).rounded()) }
  return String(format: "#%02x%02x%02x", channel(components[0]), channel(components[1]), channel(components[2]))
}

private func requireAccess(allowWriteOnly: Bool = false) {
  let status = authorizationName()
  if status == "fullAccess" || (allowWriteOnly && status == "writeOnly") { return }
  let code = status == "writeOnly" ? "CALENDAR_WRITE_ONLY" : status == "notDetermined" ? "CALENDAR_ACCESS_NOT_DETERMINED" : "CALENDAR_ACCESS_DENIED"
  fail(code, "Calendar access is \(status).")
}

private func calendarJSON(_ calendar: EKCalendar) -> [String: Any] {
  [
    "id": calendar.calendarIdentifier,
    "title": calendar.title,
    "color": hexColor(calendar.cgColor),
    "source": calendar.source?.title ?? "",
    "allowsModify": calendar.allowsContentModifications,
  ]
}

private func eventJSON(_ event: EKEvent) -> [String: Any] {
  [
    "id": event.eventIdentifier ?? event.calendarItemIdentifier,
    "itemId": event.calendarItemIdentifier,
    "calendarId": event.calendar?.calendarIdentifier ?? "",
    "calendarTitle": event.calendar?.title ?? "",
    "color": hexColor(event.calendar?.cgColor),
    "title": event.title ?? "",
    "start": formatDate(event.startDate),
    "end": formatDate(event.endDate ?? event.startDate),
    "allDay": event.isAllDay,
    "location": event.location ?? "",
    "readOnly": !(event.calendar?.allowsContentModifications ?? false),
  ]
}

private func findEvent(_ store: EKEventStore, _ input: [String: Any]) -> EKEvent? {
  if let id = input["id"] as? String, !id.isEmpty, let event = store.event(withIdentifier: id) { return event }
  if let itemId = input["itemId"] as? String, !itemId.isEmpty, let event = store.calendarItem(withIdentifier: itemId) as? EKEvent { return event }
  return nil
}

private func apply(_ input: [String: Any], to event: EKEvent) {
  if let title = input["title"] as? String { event.title = String(title.prefix(500)) }
  if input["start"] != nil { event.startDate = parseDate(input["start"], field: "start") }
  if input["end"] != nil { event.endDate = parseDate(input["end"], field: "end") }
  if let allDay = input["allDay"] as? Bool { event.isAllDay = allDay }
  if let zone = input["timeZone"] as? String { event.timeZone = TimeZone(identifier: zone) }
  else if input["timeZone"] is NSNull { event.timeZone = nil }
  if let notes = input["notes"] as? String { event.notes = String(notes.prefix(5000)) }
  if let link = input["url"] as? String, isWorkspaceLink(link), let url = URL(string: link) { event.url = url }
  if event.endDate < event.startDate { event.endDate = event.startDate }
}

func runCalendar(_ arguments: [String]) -> Never {
  switch arguments.first {
  case "status":
    emit(["authorization": authorizationName()])
    exit(0)
  case "request":
    if authorizationName() == "notDetermined" {
      let store = EKEventStore()
      let semaphore = DispatchSemaphore(value: 0)
      if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { _, _ in semaphore.signal() }
      } else {
        store.requestAccess(to: .event) { _, _ in semaphore.signal() }
      }
      semaphore.wait()
    }
    emit(["authorization": authorizationName()])
    exit(0)
  case "list":
    requireAccess()
    let store = EKEventStore()
    let calendars = store.calendars(for: .event).sorted { ($0.source?.title ?? "", $0.title) < ($1.source?.title ?? "", $1.title) }
    emit(["calendars": calendars.map(calendarJSON), "defaultCalendarId": store.defaultCalendarForNewEvents?.calendarIdentifier ?? ""])
    exit(0)
  case "events":
    requireAccess()
    let input = readJSONInput()
    let start = parseDate(input["start"], field: "start"), end = parseDate(input["end"], field: "end")
    if end <= start || end.timeIntervalSince(start) > 400 * 86_400 { fail("INVALID_INPUT", "Invalid range.") }
    let store = EKEventStore()
    let wanted = Set((input["calendarIds"] as? [String]) ?? [])
    let calendars = store.calendars(for: .event).filter { wanted.isEmpty || wanted.contains($0.calendarIdentifier) }
    if calendars.isEmpty { emit(["events": []]); exit(0) }
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    let events = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }.prefix(2000)
    emit(["events": events.map(eventJSON)])
    exit(0)
  case "create":
    requireAccess(allowWriteOnly: true)
    let input = readJSONInput()
    let store = EKEventStore()
    let calendar = (input["calendarId"] as? String).flatMap { store.calendar(withIdentifier: $0) } ?? store.defaultCalendarForNewEvents
    guard let calendar else { fail("CALENDAR_NOT_FOUND", "No calendar available for new events.") }
    if !calendar.allowsContentModifications { fail("CALENDAR_READ_ONLY", "The chosen calendar is read-only.") }
    if input["start"] == nil || input["end"] == nil { fail("INVALID_INPUT", "start and end are required.") }
    let event = EKEvent(eventStore: store)
    event.calendar = calendar
    event.title = ""
    apply(input, to: event)
    do { try store.save(event, span: .thisEvent, commit: true) } catch { fail("CALENDAR_SAVE_FAILED", error.localizedDescription) }
    emit(["event": eventJSON(event)])
    exit(0)
  case "update":
    requireAccess()
    let input = readJSONInput()
    let store = EKEventStore()
    guard let event = findEvent(store, input) else { fail("EVENT_NOT_FOUND", "The linked event no longer exists.") }
    if !(event.calendar?.allowsContentModifications ?? false) { fail("CALENDAR_READ_ONLY", "The event's calendar is read-only.") }
    apply(input, to: event)
    do { try store.save(event, span: .thisEvent, commit: true) } catch { fail("CALENDAR_SAVE_FAILED", error.localizedDescription) }
    emit(["event": eventJSON(event)])
    exit(0)
  case "delete":
    requireAccess()
    let input = readJSONInput()
    let store = EKEventStore()
    guard let event = findEvent(store, input) else { emit(["deleted": false]); exit(0) }
    do { try store.remove(event, span: .thisEvent, commit: true) } catch { fail("CALENDAR_SAVE_FAILED", error.localizedDescription) }
    emit(["deleted": true])
    exit(0)
  default:
    fail("UNKNOWN_COMMAND", "Usage: workspace-native calendar status|request|list|events|create|update|delete")
  }
}
