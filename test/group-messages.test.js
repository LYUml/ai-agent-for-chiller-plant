import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroupMessages} from '../src/group-messages.js';
import {createPlant} from '../src/plant.js';

test('single-account echo arriving before send completes is ignored by ID', async()=>{
  const plant=createPlant();
  let echo, sameTextFromPhone;
  const group=createGroupMessages(async()=>{
    echo=group.isOutgoing('bot-id');
    sameTextFromPhone=group.isOutgoing('phone-id');
    return {id:{_serialized:'bot-id'}};
  },()=>plant);
  await group.send('报告');
  assert.equal(await echo,true);
  assert.equal(await sameTextFromPhone,false);
  assert.equal(await group.isOutgoing('bot-id'),true);
});
