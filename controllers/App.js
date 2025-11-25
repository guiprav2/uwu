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
      let img = '';
      if (project.pages.length) {
        let lastPage = project.pages[project.pages.length - 1];
        let lastUrl = lastPage?.img || '';
        let parts = lastUrl.split('/');
        let num = Number(parts.at(-1).split('.')[0]);
        img = parts.slice(0, -1).join('/') + `/${num + 1}.jpg`;
      } else {
        let [btn, digits] = await showModal('PromptDialog', { title: '6-digit number' });
        if (btn !== 'ok') return;
        img = `https://i1.nhentai.net/galleries/${digits}/1.jpg`;
      }
      if (!img) return;
      let page = { img, transcription: '' };
      project.pages.push(page);
      this.state.tmp.page = project.pages.length - 1;
      await post('app.persist');
    },
  };
}
