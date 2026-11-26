import test from 'node:test';
import assert from 'node:assert/strict';
import {addressedText} from '../src/mention.js';
test('only a native mention of this account admits group text',()=>{
  const self=['100@c.us','200@lid'];
  assert.equal(addressedText('@机器人 开机',[],self),null);
  assert.equal(addressedText('@300 开机',['300@lid'],self),null);
  assert.equal(addressedText('@200 查询 2 号机',['200@lid'],self),'查询 2 号机');
  assert.equal(addressedText('查询 2 号机 @100',['100@c.us'],self),'查询 2 号机');
  assert.equal(addressedText('@200',['200@lid'],self),'');
});
