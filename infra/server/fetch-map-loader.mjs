import fs from 'node:fs';
import {mappedFetch} from './transport.mjs';
const file=process.env.TG_PRIVATE_TRANSPORT_FILE;
if(!file)throw Error('TG_PRIVATE_TRANSPORT_FILE is required');
globalThis.fetch=mappedFetch(JSON.parse(fs.readFileSync(file,'utf8')));
