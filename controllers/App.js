import '../other/env.js';
import complete, { listModels } from '../other/complete.js';

export default class App {
  state = {
    options: { filter: [] },
    models: [],
    panel: 'projects',
    projects: [],
    tmp: {},
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

  actions = {
    init: async () => {
      this.state.projects = JSON.parse(localStorage.getItem('uwu.projects') || '[]');
      await post('app.listModels');
    },
    persist: async () => localStorage.setItem('uwu.projects', JSON.stringify(this.state.projects)),
    selectProject: project => {
      this.state.project = project;
      this.state.tmp.page = 0;
      this.state.tmp.busy = false;
    },
    newProject: async () => {
      let [btn, title] = await showModal('PromptDialog', { title: 'Project Title' });
      if (btn !== 'ok') return;
      let project = { title, tags: [], pages: [] };
      this.state.projects.push(project);
      this.state.project = project;
      this.state.tmp.page = 0;
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
      this.state.tmp.logs = [...(this.state.tmp.logs || []), { role: 'user', content: msg }];
      await post('app.complete');
    },
    complete: async () => {
      if (this.state.tmp.busy || !this.state.project) return;
      this.state.tmp.busy = true;
      try {
        let conversation = [...(this.state.tmp.logs || [])];
        let transcriptions = (this.state.project.pages || []).map((page, index) => {
          let text = page?.transcription?.trim ? page.transcription.trim() : '';
          return `${index + 1}. ${text || '(empty transcription)'}`;
        });
        conversation.unshift({
          role: 'system',
          content: [
            `Project page transcriptions:\n\n${transcriptions.join('\n\n')}`,
            `Below is the current page transcription. Make adjustments according to user prompt and respond with the bare revised transcription, nothing else.`,
          ],
        });
        let res = await complete(conversation, { simple: true, model: this.state.model });
        let choice = Array.isArray(res) ? res[0] : res;
        if (!choice) return;
        let content = Array.isArray(choice.content) ? choice.content.join('\n') : choice.content;
        console.log(content);
        this.state.tmp.logs = [...(this.state.tmp.logs || []), { role: choice.role || 'assistant', content }];
      } catch (err) {
        console.error(err);
      } finally {
        this.state.tmp.busy = false;
      }
    },
  };
}
