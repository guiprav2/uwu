import BreakerTransformer from './breaker.js';
import { Readable } from 'node:stream';
process.stdin.pipe(new BreakerTransformer()).pipe(process.stdout);
