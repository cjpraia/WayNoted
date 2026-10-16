// Quando uma alteração de propriedade conta como "tarefa concluída" (puro).
import type { DatabaseSchema, Property, PropValue } from '../types'
import { doneProperty, isDoneValue } from '../recurrence.ts'

/**
 * Propriedades de conclusão: qualquer Status (grupo "Concluído") e a caixa de seleção que o banco usa
 * como conclusão — a escolhida numa data recorrente ou, sem Status no banco, a primeira caixa.
 * Outras caixas ("Arquivado", "Fixado"…) não contam.
 */
export function isCompletionProperty(schema: DatabaseSchema, property: Property): boolean {
  if (property.type === 'status') return true
  if (property.type !== 'checkbox') return false
  if (schema.properties.some(p => p.type === 'date' && doneProperty(schema, p)?.id === property.id && p.recurrenceDoneProperty === property.id)) return true
  return !schema.properties.some(p => p.type === 'status') && schema.properties.find(p => p.type === 'checkbox')?.id === property.id
}

/** Transição "não concluída → concluída" nesta propriedade. */
export function completesTask(schema: DatabaseSchema | undefined, propertyId: string, previous: PropValue | undefined, next: PropValue): boolean {
  const property = schema?.properties.find(p => p.id === propertyId)
  if (!schema || !property || !isCompletionProperty(schema, property)) return false
  return !isDoneValue(property, previous) && isDoneValue(property, next)
}
