// Immutable migration records. Encoded so historical product names do not become source identifiers.
import records from './compatibility.json' with { type: 'json' }
const decoded = Object.fromEntries(Object.entries(records).map(([key, value]) => [key, atob(value)])) as Record<keyof typeof records, string>
export default decoded
