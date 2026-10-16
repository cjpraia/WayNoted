import test from 'node:test'
import assert from 'node:assert/strict'
import {mergeRowCreationProps} from '../src/components/database/rowCreation.ts'
import {calculateColumn} from '../src/components/database/calculations.ts'

test('related-view creation keeps required relation across inline, form, grouping and imported values',()=>{
 const context={parent:['current'],status:'group'}
 const imported={parent:['other','current'],amount:12,status:'different'}
 const result=mergeRowCreationProps({priority:'high'},imported,context)
 assert.deepEqual(result,{priority:'high',parent:['other','current'],amount:12,status:'group'})
 assert.deepEqual(mergeRowCreationProps({}, {}, context),context)
 assert.deepEqual(imported,{parent:['other','current'],amount:12,status:'different'})
 assert.deepEqual(context,{parent:['current'],status:'group'})
 // The CSV second pass resolves IDs and then reapplies context using this same helper.
 assert.deepEqual(mergeRowCreationProps({}, {parent:['remapped']}, context).parent,['remapped','current'])
})
test('table footer numerical calculations follow the selected language',()=>{
 const property={id:'amount',name:'Amount',type:'number' as const}
 const row={id:'r',parentId:'db',title:'Row',props:{amount:1234.5}} as any
 assert.equal(calculateColumn([row],property,{r:row},'sum','en-US'),'1,234.5')
 assert.equal(calculateColumn([row],property,{r:row},'sum','pt-BR'),'1.234,5')
})
