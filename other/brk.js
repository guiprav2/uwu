import Breaker from './breaker.js';
import { Readable } from 'node:stream';
if (typeof process !== 'undefined' && process.argv[1]?.split?.(/[/\\]/)?.pop?.() === import.meta.url.split('/').pop()) process.stdin.pipe(new Breaker()).pipe(process.stdout);
export default async x => {
  let ret = [];
  let pipe = Readable.from([x]).pipe(new Breaker());
  pipe.on('data', y => ret.push(y.toString().trim()));
  await new Promise((pres, prej) => { pipe.on('end', pres); pipe.on('error', prej) });
  return ret;
};
