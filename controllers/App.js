export default class App {
  state = {
    panel: 'projects',
    projects: [],
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
  };

  actions = {
    init: async () => this.state.projects = JSON.parse(localStorage.getItem('uwu.projects') || '[]'),
    persist: async () => localStorage.setItem('uwu.projects', JSON.stringify(this.state.projects)),
  };
}
