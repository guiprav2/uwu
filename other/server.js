import express from 'express';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
let __filename = fileURLToPath(import.meta.url);
let __dirname = path.dirname(__filename);
let projectRoot = path.resolve(__dirname, '..');
let app = express();
let currentProc = null;
app.use(express.static('.'));
app.post('/transcribe', (req, res) => {
  if (currentProc) {
    let sent = currentProc.kill('SIGINT');
    if (!sent) return res.status(500).end(`Failed to signal transcription process.`);
    return res.status(200).end();
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  let scriptPath = path.join(__dirname, 'trans.js');
  try { currentProc = spawn(process.execPath, [scriptPath, '-q'], { cwd: __dirname }) }
  catch (err) { currentProc = null; return res.status(500).end(`Failed to start transcription: ${err.message}`) }
  let proc = currentProc;
  let detach = () => { if (currentProc === proc) currentProc = null; };
  let forward = chunk => { try { res.write(chunk); } catch {} };
  proc.stdout.on('data', forward);
  proc.stderr.on('data', forward);
  proc.on('error', err => forward(`\nProcess error: ${err.message}\n`));
  req.on('close', () => { if (!res.writableEnded && currentProc === proc) res.end() });
  proc.on('close', code => {
    detach();
    if (!res.writableEnded) {
      if (code !== 0) res.write(`\n[ERROR] Process exited with code ${code}.\n`);
      res.end();
    }
  });
});
app.post('/transcribe/finish', (req, res) => {
  if (!currentProc) return res.status(404).end(`No transcription process running.`);
  let sent = currentProc.kill('SIGINT');
  if (!sent) return res.status(500).end(`Failed to signal transcription process.`);
  res.status(200).end();
});
let port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
