import '../other/env.js';
import brk from '../other/brk.js';
import complete, { listModels } from '../other/complete.js';

export default class App {
  transcribeController = null;
  completionController = null;
  state = {
    options: { filter: [] },
    models: [],
    panel: 'projects',
    projects: [],
    tmp: { logs: [], recording: false, transcribing: false },
    viewingArchived: false,
    get model() {
      if (this.options.model) return this.options.model;
      if (this.models?.length) return this.models[0].id;
      return 'xai:grok-4-1-fast-non-reasoning';
    },
    get tags() {
      let projects = this.panel === 'archive' ? this.projects : this.displayedProjects;
      return [...new Set(projects.map(x => x.tags || []).flat())];
    },
    tagSuggestions: [],
    get displayedProjects() {
      let projects = [];
      if (this.panel === 'projects') projects = this.projects?.filter?.(x => !x.archived) || [];
      if (this.panel === 'archive') projects = this.projects?.filter?.(x => x.archived) || [];
      return projects.filter(x => (!this.options.filter.length || (x.tags?.length && this.options.filter.every(y => x.tags.includes(y)))));
    },
    get page() {
      if (!this.project?.pages?.length) return null;
      let index = this.tmp.page ?? 0;
      if (index < 0) index = 0;
      if (index >= this.project.pages.length) index = this.project.pages.length - 1;
      return this.project.pages[index] || null;
    },
  };

  async callTranscribeFinish(times = 1) {
    for (let i = 0; i < times; i++) {
      try {
        await fetch('/transcribe/finish', { method: 'POST' });
      } catch (err) {
        console.error(err);
      }
    }
  }
  abortTranscribeStream() {
    if (!this.transcribeController) return;
    this.transcribeController.abort();
    this.transcribeController = null;
  }
  async stopTranscriptionFully() {
    if (!this.state.tmp.recording && !this.state.tmp.transcribing && !this.transcribeController) return;
    await this.callTranscribeFinish(2);
    this.abortTranscribeStream();
    this.state.tmp.recording = false;
    this.state.tmp.transcribing = false;
    d.update();
  }
  abortCompletionRequest() {
    if (!this.completionController) return;
    this.completionController.abort();
    this.completionController = null;
    this.state.tmp.busy = false;
  }
  getCurrentPage() {
    return this.state.project?.pages?.[this.state.tmp.page] || null;
  }
  appendToCurrentTranscription(chunk) {
    if (!chunk) return;
    let page = this.getCurrentPage();
    if (!page) return;
    page.transcription = `${page.transcription || ''}${chunk}`;
    d.update();
  }
  async startTranscriptionStream() {
    await this.stopTranscriptionFully();
    let page = this.getCurrentPage();
    if (!this.state.project || !page) return;
    this.state.tmp.recording = true;
    this.state.tmp.transcribing = false;
    d.update();
    let controller = new AbortController();
    this.transcribeController = controller;
    try {
      let res = await fetch('/transcribe', { method: 'POST', signal: controller.signal });
      if (!res.ok) throw new Error(`Transcription request failed: ${res.status}`);
      if (!res.body) throw new Error('No response body from /transcribe');
      let reader = res.body.getReader();
      let decoder = new TextDecoder();
      while (true) {
        let { done, value } = await reader.read();
        let chunk = decoder.decode(value || new Uint8Array(), { stream: !done });
        chunk && this.appendToCurrentTranscription(chunk);
        if (done) break;
      }
      let tail = decoder.decode();
      tail && this.appendToCurrentTranscription(tail);
      await post('app.persist');
    } catch (err) {
      if (!controller.signal.aborted) console.error(err);
    } finally {
      if (this.transcribeController === controller) this.transcribeController = null;
      this.state.tmp.recording = false;
      this.state.tmp.transcribing = false;
      d.update();
    }
  }
  async requestTranscriptionFinish({ kill } = {}) {
    await this.callTranscribeFinish();
    if (kill) {
      this.abortTranscribeStream();
      this.state.tmp.recording = false;
      this.state.tmp.transcribing = false;
    } else {
      this.state.tmp.recording = false;
      this.state.tmp.transcribing = true;
    }
    d.update();
  }
  actions = {
    init: async () => {
      this.state.projects = JSON.parse(localStorage.getItem('uwu.projects') || '[]');
      this.state.tmp.logs ??= [];
      this.state.tmp.recording ??= false;
      this.state.tmp.transcribing ??= false;
      await post('app.listModels');
    },
    persist: async () => localStorage.setItem('uwu.projects', JSON.stringify(this.state.projects)),
    selectProject: async project => {
      await this.stopTranscriptionFully();
      this.abortCompletionRequest();
      this.state.project = project;
      this.state.tmp.page = 0;
      this.state.tmp.busy = false;
      this.state.tmp.logs = [];
    },
    newProject: async () => {
      let [btn, title] = await showModal('PromptDialog', { title: 'Project Title' });
      if (btn !== 'ok') return;
      await this.stopTranscriptionFully();
      this.abortCompletionRequest();
      let project = { title, tags: [], pages: [] };
      this.state.projects.push(project);
      this.state.project = project;
      this.state.tmp.page = 0;
      this.state.tmp.logs = [];
      await post('app.persist');
    },
    newPage: async () => {
      let { project } = this.state;
      if (!project) return;
      let urlPattern = /^https:\/\/[^/]+\/galleries\/\d+\/\d+\.\w+$/i;
      let promptForUrl = async () => {
        let [btn, url] = await showModal('PromptDialog', { title: 'Image URL' });
        if (btn !== 'ok') return '';
        let trimmed = (url || '').trim();
        if (!urlPattern.test(trimmed)) {
          alert('Please enter a URL like https://blabla.com/galleries/123456/1.jpg');
          return '';
        }
        return trimmed;
      };
      let nextFrom = url => {
        let match = url.match(/^(https:\/\/[^/]+\/galleries\/\d+\/)(\d+)(\.\w+)$/i);
        if (!match) return '';
        let prefix = match[1];
        let current = match[2];
        let ext = match[3];
        let next = String(Number(current) + 1).padStart(current.length, '0');
        return `${prefix}${next}${ext}`;
      };
      let img = '';
      if (project.pages.length) {
        let lastPage = project.pages[project.pages.length - 1];
        let lastUrl = lastPage?.img || '';
        img = nextFrom(lastUrl);
        if (!img) {
          alert('Last page image URL is invalid. Please start with a valid galleries URL.');
          return;
        }
      } else {
        img = await promptForUrl();
        if (!img) return;
      }
      let page = { img, transcription: '' };
      project.pages.push(page);
      await this.stopTranscriptionFully();
      this.state.tmp.page = project.pages.length - 1;
      await post('app.persist');
    },
    toggleArchives: () => {
      if (this.state.panel === 'archive') return this.state.panel = 'projects';
      this.state.panel = 'archive';
    },
    toggleArchived: async (ev, x) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      x.archived = !x.archived;
      if (!this.state.displayedProjects.length) this.state.panel = 'projects';
      await post('app.persist');
    },
    rm: async (ev, x) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      let i = this.state.projects.indexOf(x);
      i >= 0 && this.state.projects.splice(i, 1);
      if (!this.state.displayedProjects.length) this.state.panel = 'projects';
      await post('app.persist');
    },
    listModels: async () => {
      this.state.tmp.loadingModels = true;
      try { this.state.models = await listModels() }
      finally { this.state.tmp.loadingModels = false }
    },
    toggleShowModels: () => this.state.tmp.showModels = !this.state.tmp.showModels,
    changeModel: x => {
      this.state.options.model = x;
      this.state.tmp.showModels = false;
    },
    msgKeyDown: ev => ev.key === 'Enter' && !ev.shiftKey && ev.preventDefault(),
    msgKeyUp: async ev => {
      if (ev.key !== 'Enter' || ev.shiftKey) return;
      if (!this.state.project) {
        ev.target.value = '';
        return;
      }
      let msg = ev.target.value.trim();
      if (!msg) {
        ev.target.value = '';
        return;
      }
      ev.target.value = '';
      await post('app.complete', msg);
    },
    complete: async msg => {
      if (this.state.tmp.busy || !this.state.project) return;
      this.abortCompletionRequest();
      this.state.tmp.busy = true;
      let controller = new AbortController();
      this.completionController = controller;
      try {
        let logs = [...this.state.tmp.logs || []];
        let transcriptions = (this.state.project.pages || []).map((page, index) => {
          let text = page?.transcription?.trim ? page.transcription.trim() : '';
          return `${index + 1}. ${text || '(empty transcription)'}`;
        });
        logs.unshift({
          role: 'system',
          content: [
            `Project page transcriptions:\n\n${transcriptions.join('\n\n')}`,
            `Below is the current page transcription. Make adjustments strictly according to user prompt, leaving all else unchanged, and respond with the full, bare revised transcription; nothing else.`,
          ],
        });
        logs.push({ role: 'user', content: [`Current page transcription:`, this.state.project.pages[this.state.tmp.page].transcription] });
        logs.push({ role: 'user', content: msg });
        let res = await complete(logs, { simple: true, model: this.state.model, signal: controller.signal });
        this.state.tmp.logs ??= [];
        this.state.tmp.logs.push(res);
        this.state.project.pages[this.state.tmp.page].transcription = await brk(res.content.trim());
        await post('app.persist');
      } catch (err) {
        if (!controller.signal.aborted) console.error(err);
      } finally {
        if (this.completionController === controller) this.completionController = null;
        this.state.tmp.busy = false;
      }
    },
    transcribe: async () => {
      if (!this.state.project) return;
      let page = this.getCurrentPage();
      if (!page) return;
      if (this.state.tmp.transcribing) {
        await this.requestTranscriptionFinish({ kill: true });
        return;
      }
      if (this.state.tmp.recording) {
        await this.requestTranscriptionFinish({ kill: false });
        return;
      }
      await this.startTranscriptionStream();
    },
    prevPage: async () => {
      await post('app.changePage', this.state.tmp.page - 1);
    },
    nextPage: async () => {
      await post('app.changePage', this.state.tmp.page + 1);
    },
    changePage: async index => {
      if (!this.state.project) return;
      await this.stopTranscriptionFully();
      let count = this.state.project.pages.length;
      if (!count) return;
      if (index < 0) index = 0;
      if (index >= count) index = count - 1;
      this.state.tmp.page = index;
      d.update();
    },
  };
}
