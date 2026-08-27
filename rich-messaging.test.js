const test=require('node:test'),assert=require('node:assert/strict');
test('release',()=>assert.match('1.5.0-beta.1',/^1\.5\.0-beta/));
test('attachment kinds are limited',()=>assert.deepEqual(['image','file','audio'].sort(),['audio','file','image']));
test('edit window is 15 minutes',()=>assert.equal(15*60*1000,900000));
