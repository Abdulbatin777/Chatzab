const test=require('node:test'),assert=require('node:assert/strict');
test('release',()=>assert.match('1.6.0-beta.1',/^1\.6\.0-beta/));
test('upload limit',()=>assert.equal(10*1024*1024,10485760));
test('media kinds',()=>assert.deepEqual(['image','file','audio'].sort(),['audio','file','image']));
