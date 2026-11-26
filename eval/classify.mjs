import {classify} from '../src/ai.js';
console.log(JSON.stringify(await classify(process.argv[2])));
