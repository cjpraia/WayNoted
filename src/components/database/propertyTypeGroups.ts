import type { PropType } from '../../types'

/** Lei de Hick: 8 tipos mais usados à vista; os demais ficam em "Mais ›" ou na busca. */
export const PROP_TYPES_COMMON: PropType[] = ['text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'relation']
export const PROP_TYPES_MORE: PropType[] = ['url', 'email', 'phone', 'person', 'files', 'formula', 'rollup', 'createdTime', 'updatedTime', 'createdBy', 'updatedBy', 'uniqueId', 'button', 'place']
