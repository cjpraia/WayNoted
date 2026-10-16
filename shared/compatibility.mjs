import records from './compatibility.json' with { type: 'json' }
export default Object.fromEntries(Object.entries(records).map(([key, value]) => [key, atob(value)]))
