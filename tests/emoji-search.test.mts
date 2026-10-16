import test from 'node:test'
import assert from 'node:assert/strict'
import {ALL_EMOJIS,searchEmojis} from '../src/components/page/emojiData.ts'
test('emoji names and search work in Portuguese and English without service lookup',()=>{
 for(const query of ['cachorro','dog'])assert.ok(searchEmojis(query).some(item=>item.emoji==='🐶'))
 for(const query of ['coração','heart'])assert.ok(searchEmojis(query).some(item=>item.emoji==='❤️'))
 assert.ok(searchEmojis('developer').some(item=>item.emoji==='🧑‍💻'))
 assert.ok(searchEmojis('brazil').some(item=>item.emoji==='🇧🇷'))
 assert.ok(searchEmojis('🚀').some(item=>item.emoji==='🚀'))
 assert.ok(ALL_EMOJIS.every(item=>typeof item.english==='string'&&item.english.length>0))
})
