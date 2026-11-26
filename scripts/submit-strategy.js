import {existsSync,readFileSync} from 'node:fs';
import {createPlant} from '../src/plant.js';
import {groupDatabasePath} from '../src/storage.js';

// Local producer for the existing simulator. Use an initialized test group's DB.
try {
  const path=groupDatabasePath(process.env.TEST_GROUP_ID ?? '');
  if(!existsSync(path)) throw Error('Start the test group before submitting a strategy');
  const input=JSON.parse(readFileSync(0,'utf8'));
  console.log(createPlant(path).submitStrategy(input));
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
