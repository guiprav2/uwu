import Breaker from './breaker.js';
if (typeof process !== 'undefined' && process.argv?.[1]?.split?.(/[/\\]/)?.pop?.() === import.meta.url.split('/').pop()) process.stdin.pipe(new Breaker()).pipe(process.stdout);
export default async x => {
  let ret = [];
  let pipe = new Breaker();
  pipe.on('data', y => ret.push(y.toString().trim()));
  pipe.write(x);
  pipe.end();
  return ret.join('\n').trim();
};
