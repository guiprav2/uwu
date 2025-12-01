export default class App {
  state = {
    options: { filter: [] },
    panel: 'projects',
    projects: [],
    tmp: {},
    viewingArchived: false,
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
    get displayedLogs() { return this.project?.logs || [] },
    get page() {
      if (!this.project?.pages?.length) return null;
      let index = this.tmp.page ?? 0;
      if (index < 0) index = 0;
      if (index >= this.project.pages.length) index = this.project.pages.length - 1;
      return this.project.pages[index] || null;
    },
  };

  actions = {
    init: async () => this.state.projects = JSON.parse(localStorage.getItem('uwu.projects') || '[]'),
    persist: async () => localStorage.setItem('uwu.projects', JSON.stringify(this.state.projects)),
    selectProject: project => {
      this.state.project = project;
      this.state.tmp.page = 0;
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
  };
}
