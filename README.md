# uwu

uwu is a lightweight dashboard for managing scanlation or audio-transcription projects page-by-page. Everything runs inside the browser (state stays in `localStorage`) while a tiny Express server (`other/server.js`) powers audio transcription through the bundled Whisper CLI utility (**WARNING**: Linux-only for now).

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Start the helper server** (required for the microphone/transcription flow):
   ```bash
   node other/server.js
   ```
   The server serves the static files and exposes `/transcribe` + `/transcribe/finish` endpoints. It expects `script`, `arecord`, `ffmpeg`, and the included `other/whisper-cli` binary to be available on your system.
3. **Open the UI** at https://localhost:3000/ (unless you used PORT=1234 when running the server for example).

State is persisted in `localStorage` under the key `uwu.projects`. Clearing browser storage wipes your projects, so export anything you need before doing so.

## UI Tour & Controls

### Left Column – Project Library

- **Header row**
  - **Archive toggle** – switches between the main “Projects” view and archived projects.
- **Project list** – cards display project title plus badges:
  - When hovering, archive, unarchive, and delete icons appear.
  - Clicking a card loads it into the right-hand pane.
- **Empty state** – a grey star prompts you to create your first project.
- **New Project button** – bottom call-to-action opens a dialog asking for the project title.

### Right Column – Workspace

This area remains dimmed until a project is selected.

1. **Header row**
   - Shows the project title.
   - Status icons animate as background tasks run:
     - Microphone icon glows during live recording.
     - Transcription icon pulses while queued transcription audio is being processed.
     - Chat bubble icon appears when asking AI adjustments from the input box at the bottom.
   - Button cluster (top-right)
     - **Mic button** – toggles recording/transcription. It flips icons once audio capture stops but transcription is pending, or if you cancel mid-stream.
     - **Left Arrow** – jumps to the previous page.
     - **Plus Icon** – adds the next sequential page (details below).
     - **Right Arrow** – jumps to the next page.
3. **Page workspace** – split 50/50:
   - **Transcription textarea** – sticky so it stays visible as you scroll. Persists automatically on every keystroke.
   - **Page preview** – Shows the current manga page for reference.
4. **AI adjustments input box** – only becomes visible once the current page has some text:
   - Left textarea captures your instruction for the LLM. Hitting Enter (without Shift) submits a request. Shift-Enter adds line breaks.
   - Right-hand side model button shows the currently selected model. Clicking it expands a dropdown listing every model available to your account. The refresh buttton refetches the list.
   - The LLM response replaces the entire transcription text, enforcing a “full replacement” workflow (no chat).

## Working With Projects

- **Project persistence** – Everything lives in browser storage; there is no backend database.
- **Archiving** – Archive/unarchive using the hover controls. Archived projects only show when the archive icon is active.
- **Deleting** – Click the cross icon while hovering an archived project to delete it permanently (irreversible).

## Creating Pages From nhentai.net (First-Page Walkthrough)

When you click **New Page** the app enforces a specific nhentai.net image URL format: `https://<host>/galleries/<gallery-id>/<page-number>.<ext>`. The app uses that pattern to auto-increment URLs for subsequent pages, so the very first page must be a canonical link. Here’s the exact workflow:

1. Open the manga on https://nhentai.net/ and click the very first page.
2. Right-click the page image and choose “Copy image link URL” (or your browser’s equivalent).
4. In the app, create or select your project and press the **`+` (New Page)** button on the top-right corner.
5. When the prompt appears, paste the URL you copied and confirm. The app validates it; if it doesn’t match the expected `/galleries/…/1.jpg` format you’ll be asked again.
6. The image now anchors Page 1. Every subsequent press of **`+` (New Page)** reuses the last page’s URL, bumping just the trailing number so you don’t have to keep pasting links.

Tips:
- Stick to the raw CDN URL, not the reader page (`/g/123456/1/`).
- If you ever need to restart (for example, the prior URL used query params), delete the project and re-add Page 1 with a clean link.

## Audio Transcription & Whisper Integration

- The mic button triggers the audio recording/transcription workflow.
- Clicking the checkmark button ends recording and begins transcription.
- Incoming text streams straight into the current page’s transcription area (could take a while!)
- Clicking the cross button before transcription finishes aborts the transcription, allowing you to start over if needed.

## Model Selection & AI Assistance

- The AI adjustment input box sends the entire project transcript as context before your prompt, ensuring responses always replace the current page faithfully and in-context.
- Press **Enter** to send; press **Shift+Enter** for manual line breaks.

## Troubleshooting

- **No audio transcription** – ensure `node other/server.js` is running and that `script`, `arecord`, `ffmpeg`, and `pulseaudio/ALSA` permissions are available.
- **Image doesn’t load** – verify the URL ends in `/galleries/<id>/<page>.<ext>` and is accessible from your browser (no referer blocks when opened in a new tab). Once you add a broken page the only way to fix it is to archive/delete the project and start from scratch.
- **Lost data** – check whether the browser cleared localStorage; if you switch browsers or profiles your projects will not follow you.

Happy transcribing!
