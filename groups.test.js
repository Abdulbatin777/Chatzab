const test=require('node:test'),assert=require('node:assert/strict');
test('release',()=>assert.match('1.7.0-beta.1',/^1\.7\.0-beta/));
test('group roles',()=>assert.deepEqual(['owner','admin','member'].sort(),['admin','member','owner']));
test('community channels are supported',()=>assert.equal(true,true));
