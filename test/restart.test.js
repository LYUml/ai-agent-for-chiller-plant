import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlant} from '../src/plant.js';
import {flushReplies} from '../src/outbox.js';

test('确认已落库时进程被终止，重启可恢复回执且只执行一次', async t => {
  const directory=mkdtempSync(join(tmpdir(),'chiller-restart-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const database=join(directory,'plant.sqlite');
  const moduleUrl=new URL('../src/plant.js',import.meta.url).href;
  const worker=spawnSync(process.execPath,['--input-type=module','-e',`
    import {createPlant} from ${JSON.stringify(moduleUrl)};
    const plant=createPlant(process.argv[1]);
    const proposal=plant.strategy();
    plant.bindPoll('restart-poll',proposal.match(/S[0-9a-f]{8}/)[0]);
    plant.vote('restart-poll','确认','operator');
    process.kill(process.pid,'SIGKILL');
  `,database],{encoding:'utf8',timeout:10000});
  assert.equal(worker.signal,'SIGKILL',worker.stderr);
  const recovered=createPlant(database);
  assert.equal(recovered.vote('restart-poll','确认','operator'),null);
  const receipts=[];
  await flushReplies(recovered,async body=>receipts.push(body));
  assert.equal(receipts.length,1);
  assert.match(receipts[0],/模拟后台已接收.*2 号机运行/);
  assert.deepEqual(recovered.pendingReplies(),[]);
  assert.match(recovered.handle({id:'inspect',text:'报告'}),/命令 1 条/);
});
