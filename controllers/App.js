class App {
  state = {
    defaultOptions: {
      model: 'xai:grok-4-1-fast-non-reasoning',
      autotag: true,
      suggest: true,
      filter: [],
    },
    options: { model: 'xai:grok-4-1-fast-non-reasoning', filter: [] },
    panel: 'works',
    models: [],

    get tags() {
      let works =
        this.panel === 'archive' ? this.works : this.displayedThreads;
      return [...new Set(works.map(x => x.tags || []).flat())];
    },

    tagSuggestions: [],

    get displayedThreads() {
      let works = [];
      if (this.panel === 'works') {
        works = this.works?.filter?.(x => !x.archived) || [];
      }
      if (this.panel === 'archive') {
        works = this.works?.filter?.(x => x.archived) || [];
      }
      return works.filter(
        x =>
          (!this.options.filter.length ||
            (x.tags?.length &&
              this.options.filter.every(y => x.tags.includes(y)))) &&
          (this.options.showErotica || !x.tags?.includes?.('erotica')),
      );
    },

    get displayedLogs() {
      return this.work?.logs || [];
    },
    get erotica() {
      return this.options.erotica || this.work.tags.includes('erotica');
    },
    get director() {
      return this.options.director || this.work.director;
    },
    get gameMode() {
      return this.options.gameMode || this.work.gameMode;
    },
    get voiceMode() {
      return this.options.voiceMode || this.work.voiceMode;
    },
    get modelLabel() {
      if (!this.options?.model) {
        return '';
      }
      let selected =
        this.models?.find?.(model => model.value === this.options.model) ||
        null;
      if (selected?.label) {
        return selected.label;
      }
      let parts = this.options.model.split(':');
      if (parts.length >= 2) {
        let provider = parts.shift();
        let modelName = parts.join(':');
        let readableProvider =
          provider === 'openai'
            ? 'OpenAI'
            : provider === 'xai'
              ? 'xAI'
              : provider;
        return `${readableProvider} · ${modelName}`;
      }
      return this.options.model;
    },
  };

  actions = {
    init: async () => {
      this.state.options = JSON.parse(
        localStorage.getItem('uwu.options') || 'null',
      ) || { ...this.state.defaultOptions };
      if (!this.state.options.model) {
        this.state.options.model = this.state.defaultOptions.model;
      } else if (!this.state.options.model.includes(':')) {
        this.state.options.model = `openai:${this.state.options.model}`;
      }
      this.state.threads = JSON.parse(
        localStorage.getItem('uwu.threads') || '[]',
      );
      await post('app.createNewThread');
      await post('app.loadModels');
    },

    loadModels: async () => {
      try {
        this.state.loadingModels = true;
        this.state.models = await listModels();
      } finally {
        this.state.loadingModels = false;
      }
    },

    changeModel: x => {
      this.state.options.model = x;
      this.state.showModels = false;
    },

    toggleShowModels: () => (this.state.showModels = !this.state.showModels),

    persist: async () => {
      localStorage.setItem(
        'uwu.options',
        JSON.stringify(this.state.options),
      );
      localStorage.setItem(
        'uwu.threads',
        JSON.stringify(this.state.threads),
      );
    },

    backup: async () => {
      let threads = localStorage.getItem('uwu.threads');
      if (!threads) {
        alert('No threads data found in localStorage.');
        return;
      }
      let compressed = pako.gzip(threads);
      let blob = new Blob([compressed], { type: 'application/gzip' });
      let a = document.createElement('a');
      let ts = new Date().toISOString().replaceAll(/[:.]/g, '-');
      a.href = URL.createObjectURL(blob);
      a.download = `uwu-works-${ts}.json.gz`;
      a.className = 'hidden';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  };
}

async function metadanboget(url) {
  try {
    // Extract post ID from URL
    const match = url.match(/danbooru\.donmai\.us\/posts\/(\d+)/);
    if (!match) {
      throw new Error('Invalid Danbooru post URL');
    }
    const postId = match[1];

    // Fetch post metadata from Danbooru API
    const response = await fetch(
      `https://danbooru.donmai.us/posts/${postId}.json`,
    );
    if (!response.ok) {
      throw new Error(`Error fetching data: ${response.status}`);
    }

    const data = await response.json();

    // Extract tags and image URL
    const tags = data.tag_string.split(' ');
    const img = data.file_url;

    return {
      tags,
      img,
    };
  } catch (error) {
    console.error('Failed to fetch Danbooru image data:', error);
    return null;
  }
}

export default Main;
