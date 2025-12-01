import BreakerTransform from './breaker.js';
import fs from 'node:fs';
import process from 'node:process';
import { spawn } from 'node:child_process';
let WAV = '_.wav';
let MP3 = '_.mp3';
let rec = null;
function cleanup() {
  try { fs.unlinkSync(WAV) } catch {}
  try { fs.unlinkSync(MP3) } catch {}
}
let intc = 0;
process.on('SIGINT', () => {
  intc++;
  if (intc === 1) rec?.kill?.('SIGTERM');
  else { console.log('\nAborting.'); rec?.kill?.('SIGKILL'); cleanup(); process.exit(1) }
});
cleanup();
rec = spawn('script', ['-q', '-c', `arecord -f S16_LE -r 48000 ${WAV}`, '/dev/null'], { stdio: ['inherit', 'ignore', 'ignore'] });
await new Promise((resolve) => rec.on('exit', () => resolve()));
await new Promise((resolve, reject) => {
  let ff = spawn('ffmpeg', ['-y', '-i', WAV, '-filter:a', 'volume=4', '-codec:a', 'libmp3lame', '-q:a', '2', MP3], { stdio: 'ignore' });
  ff.on('exit', c => c === 0 ? resolve() : reject(new Error('ffmpeg failed')));
});
console.log('You said:');
await new Promise((resolve, reject) => {
  let w = spawn('./whisper-cli', [
    '-f', MP3,
    '-m', './ggml-large-v3-turbo-q5_0.bin',
    '--no-timestamps',
    '--prompt', `"Always use quotation marks for dialogue," he said. "Bet extra careful not to confuse narration with dialogue though!" Follow these rules strictly.`,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  let first = true;
  w.stdout.pipe(new BreakerTransform()).on('data', x => { process.stdout.write(first ? x.toString().trimStart() : x); first = false });
  w.on('exit', code => {
    if (code !== 0) { reject(new Error('whisper-cli failed')); return }
    resolve();
  });
});
console.log();
cleanup();
