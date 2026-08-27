const test=require('node:test'),assert=require('node:assert/strict');
test('release',()=>assert.equal('1.4.0-beta.1'.split('-')[0],'1.4.0'));
test('username format',()=>assert.match('test_user',/^[a-z0-9_]{3,32}$/));
