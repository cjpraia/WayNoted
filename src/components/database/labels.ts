import type { FilterOp, OptionColor, PropType } from '../../types'
import { t } from '../../i18n'
import { COLOR_LABELS, FILTER_OP_LABELS, PROP_TYPE_LABELS } from './lib'

const typeEnglish: Record<PropType, string> = {
  title: 'Title', text: 'Text', number: 'Number', select: 'Select', multiSelect: 'Multi-select',
  status: 'Status', date: 'Date', checkbox: 'Checkbox', url: 'URL', email: 'Email', phone: 'Phone',
  createdTime: 'Created time', updatedTime: 'Last edited time', formula: 'Formula', relation: 'Relation',
  rollup: 'Rollup', person: 'Person', files: 'Files and media', createdBy: 'Created by',
  updatedBy: 'Last edited by', button: 'Button', uniqueId: 'ID', place: 'Place',
}
const filterEnglish: Record<FilterOp, string> = {
  contains: 'contains', notContains: 'does not contain', is: 'is', isNot: 'is not', gt: '>', lt: '<',
  gte: '≥', lte: '≤', before: 'is before', after: 'is after', isEmpty: 'is empty', isNotEmpty: 'is not empty',
}
const colorEnglish: Record<OptionColor, string> = {
  default: 'Default', gray: 'Gray', brown: 'Brown', orange: 'Orange', yellow: 'Yellow', green: 'Green',
  blue: 'Blue', purple: 'Purple', pink: 'Pink', red: 'Red',
}
export const propertyTypeLabel = (type: PropType) => t(PROP_TYPE_LABELS[type], typeEnglish[type])
/** Search both interface languages, keeping the former Rollup label discoverable. */
export function matchesPropertyType(type: PropType, query: string): boolean {
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
  const aliases = type === 'rollup' ? 'resumo agregação aggregation' : ''
  return normalize(`${PROP_TYPE_LABELS[type]} ${typeEnglish[type]} ${type} ${aliases}`).includes(normalize(query))
}
export const filterOperatorLabel = (operator: FilterOp) => t(FILTER_OP_LABELS[operator], filterEnglish[operator])
export const optionColorLabel = (color: OptionColor) => t(COLOR_LABELS[color], colorEnglish[color])
