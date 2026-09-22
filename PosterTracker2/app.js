// Application State & Manager
class PosterApp {
  constructor() {
    this.dataset = {};
    this.flatList = [];
    this.stagedImages = new Map(); // Map<title, File>
    this.db = null;
    this.activeIndex = -1;
    this.currentMatches = [];

    // DOM Elements
    this.dom = {
      appContainer: document.getElementById('appContainer'),
      heroSection: document.getElementById('heroSection'),
      resultsSection: document.getElementById('resultsSection'),
      searchBoxContainer: document.getElementById('searchBoxContainer'),
      searchInputWrapper: document.getElementById('searchInputWrapper'),
      searchInput: document.getElementById('searchInput'),
      ghostInput: document.getElementById('ghostInput'),
      clearBtn: document.getElementById('clearBtn'),
      suggestionsDropdown: document.getElementById('suggestionsDropdown'),
      resultsGrid: document.getElementById('resultsGrid'),
      resultsMeta: document.getElementById('resultsMeta'),
      headerSearchBtn: document.getElementById('headerSearchBtn'),
      headerQueryDisplay: document.getElementById('headerQueryDisplay'),
      brandHome: document.getElementById('brandHome'),
      exportZipBtn: document.getElementById('exportZipBtn'),
      stagedCount: document.getElementById('stagedCount'),
      // Modal
      modalBackdrop: document.getElementById('modalBackdrop'),
      modalCard: document.getElementById('modalCard'),
      modalCloseBtn: document.getElementById('modalCloseBtn'),
      modalPosterWrap: document.getElementById('modalPosterWrap'),
      modalTitle: document.getElementById('modalTitle'),
      modalLocation: document.getElementById('modalLocation'),
      modalPath: document.getElementById('modalPath'),
      modalKey: document.getElementById('modalKey')
    };

    this.init();
  }

  async init() {
    await this.initDB();
    await this.loadStagedFromDB();
    await this.loadData();
    
    // Background purge of locally staged items if they now exist on static server
    this.cleanupStagedIfUploaded();

    this.bindEvents();
    this.handleRoute();
  }

  // --- IndexedDB Persistence ---
  initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('PosterStagingDB', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('staged_posters')) {
          db.createObjectStore('staged_posters', { keyPath: 'title' });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async loadStagedFromDB() {
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db.transaction('staged_posters', 'readonly');
      const store = tx.objectStore('staged_posters');
      const req = store.getAll();
      req.onsuccess = () => {
        req.result.forEach(entry => {
          this.stagedImages.set(entry.title, entry.file);
        });
        this.updateExportButton();
        resolve();
      };
    });
  }

  async saveStagedToDB(title, file) {
    if (!this.db) return;
    const tx = this.db.transaction('staged_posters', 'readwrite');
    const store = tx.objectStore('staged_posters');
    store.put({ title, file, updatedAt: Date.now() });
  }

  async deleteFromDB(title) {
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db.transaction('staged_posters', 'readwrite');
      const store = tx.objectStore('staged_posters');
      const req = store.delete(title);
      req.onsuccess = () => {
        this.stagedImages.delete(title);
        this.updateExportButton();
        resolve();
      };
    });
  }

  // --- Background Sync / Purge Staged Items ---
  async cleanupStagedIfUploaded() {
    if (this.stagedImages.size === 0) return;

    for (const [title, file] of this.stagedImages.entries()) {
      const ext = file.name.split('.').pop() || 'png';
      const item = this.flatList.find(i => i.title === title);
      
      const candidatePaths = item ? item.candidatePaths : [
        `../posters/${title}.${ext}`,
        `../posters/${title}.png`,
        `../posters/${title}.jpg`,
        `../posters/${title}.jpeg`,
        `../posters/${title}.webp`
      ];

      // Check if image now exists on static server
      const staticImage = await this.tryLoadStaticImage(candidatePaths);
      if (staticImage) {
        // Image now exists on server, remove from local storage
        await this.deleteFromDB(title);
      }
    }
  }

  // --- Data Loading & Extensions ---
  async loadData() {
    try {
      const res = await fetch('data.json');
      if (!res.ok) throw new Error('Could not fetch data.json');
      this.dataset = await res.json();
    } catch (err) {
      console.warn('Falling back to default inline JSON sample dataset:', err);
      this.dataset = {};
    }

    this.flatList = [];
    for (const [location, movies] of Object.entries(this.dataset)) {
      movies.forEach(title => {
        this.flatList.push({
          title,
          location,
          candidatePaths: [
            `../posters/${title}.png`,
            `../posters/${title}.jpg`,
            `../posters/${title}.jpeg`,
            `../posters/${title}.webp`
          ]
        });
      });
    }
  }

  tryLoadStaticImage(candidatePaths, index = 0) {
    return new Promise((resolve) => {
      if (index >= candidatePaths.length) {
        resolve(null);
        return;
      }

      const img = new Image();
      img.src = candidatePaths[index];
      img.onload = () => resolve({ img, path: candidatePaths[index] });
      img.onerror = () => {
        this.tryLoadStaticImage(candidatePaths, index + 1).then(resolve);
      };
    });
  }

  // --- Event Handling & Routing ---
  bindEvents() {
    window.addEventListener('hashchange', () => this.handleRoute());

    this.dom.searchInput.addEventListener('input', () => this.onInputChanged());
    this.dom.searchInput.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.dom.clearBtn.addEventListener('click', () => this.clearSearch());

    this.dom.headerSearchBtn.addEventListener('click', () => {
      this.moveSearchToCenter();
      window.location.hash = '';
      this.dom.searchInput.focus();
    });

    this.dom.brandHome.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = '';
      this.clearSearch();
    });

    if (this.dom.exportZipBtn) {
      this.dom.exportZipBtn.addEventListener('click', () => this.exportZip());
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== this.dom.searchInput) {
        e.preventDefault();
        this.dom.searchInput.focus();
      } else if (e.key === 'Escape') {
        this.closeModal();
        this.hideSuggestions();
      }
    });

    document.addEventListener('click', (e) => {
      if (!this.dom.searchBoxContainer.contains(e.target)) {
        this.hideSuggestions();
      }
    });

    this.dom.modalCloseBtn.addEventListener('click', () => this.closeModal());
    this.dom.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === this.dom.modalBackdrop) this.closeModal();
    });
  }

  handleRoute() {
    const hash = window.location.hash;
    if (hash.startsWith('#results')) {
      const urlParams = new URLSearchParams(hash.split('?')[1] || '');
      const query = urlParams.get('q') || '';
      
      this.dom.searchInput.value = query;
      this.dom.headerQueryDisplay.textContent = query || 'Search posters...';
      this.showResultsView(query);
    } else {
      this.showHomeView();
    }
  }

  onInputChanged() {
    const value = this.dom.searchInput.value;
    this.dom.clearBtn.classList.toggle('visible', value.trim().length > 0);
    this.updateMatches(value);
  }

  updateMatches(query) {
    const cleanQuery = query.toLowerCase().trim();

    if (!cleanQuery) {
      this.currentMatches = [];
      this.dom.ghostInput.value = '';
      this.hideSuggestions();
      return;
    }

    this.currentMatches = this.flatList
      .filter(item => 
        item.title.toLowerCase().includes(cleanQuery) || 
        item.location.toLowerCase().includes(cleanQuery)
      )
      .sort((a, b) => {
        const aStarts = a.title.toLowerCase().startsWith(cleanQuery);
        const bStarts = b.title.toLowerCase().startsWith(cleanQuery);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.title.localeCompare(b.title);
      });

    this.activeIndex = -1;
    this.updateGhostText(query);
    this.renderSuggestions();
  }

  updateGhostText(userQuery) {
    if (this.currentMatches.length === 0 || !userQuery) {
      this.dom.ghostInput.value = '';
      return;
    }

    const topMatch = this.currentMatches[0].title;
    if (topMatch.toLowerCase().startsWith(userQuery.toLowerCase())) {
      this.dom.ghostInput.value = userQuery + topMatch.slice(userQuery.length);
    } else {
      this.dom.ghostInput.value = '';
    }
  }

  renderSuggestions() {
    if (this.currentMatches.length === 0) {
      this.hideSuggestions();
      return;
    }

    this.dom.suggestionsDropdown.innerHTML = '';
    const visibleItems = this.currentMatches.slice(0, 6);

    visibleItems.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = `suggestion-item ${index === this.activeIndex ? 'active' : ''}`;
      el.innerHTML = `
        <span class="item-title">${this.highlightMatch(item.title, this.dom.searchInput.value)}</span>
        <span class="item-location">${item.location}</span>
      `;

      el.addEventListener('click', () => {
        this.dom.searchInput.value = item.title;
        this.executeSearch(item.title);
      });

      this.dom.suggestionsDropdown.appendChild(el);
    });

    this.dom.suggestionsDropdown.classList.add('visible');
  }

  highlightMatch(text, query) {
    if (!query) return text;
    const reg = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(reg, '<strong style="color:var(--primary-glow);">$1</strong>');
  }

  onKeyDown(e) {
    const items = this.dom.suggestionsDropdown.querySelectorAll('.suggestion-item');

    if (e.key === 'Tab' || e.key === 'ArrowRight') {
      if (this.dom.ghostInput.value) {
        e.preventDefault();
        this.dom.searchInput.value = this.dom.ghostInput.value;
        this.onInputChanged();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.currentMatches.length > 0) {
        this.activeIndex = (this.activeIndex + 1) % Math.min(this.currentMatches.length, 6);
        this.updateActiveSuggestion(items);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.currentMatches.length > 0) {
        this.activeIndex = (this.activeIndex - 1 + Math.min(this.currentMatches.length, 6)) % Math.min(this.currentMatches.length, 6);
        this.updateActiveSuggestion(items);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.activeIndex >= 0 && this.currentMatches[this.activeIndex]) {
        this.dom.searchInput.value = this.currentMatches[this.activeIndex].title;
      }
      this.executeSearch(this.dom.searchInput.value);
    }
  }

  updateActiveSuggestion(items) {
    items.forEach((item, i) => {
      if (i === this.activeIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
        this.dom.searchInput.value = this.currentMatches[i].title;
        this.dom.ghostInput.value = '';
      } else {
        item.classList.remove('active');
      }
    });
  }

  hideSuggestions() {
    this.dom.suggestionsDropdown.classList.remove('visible');
  }

  clearSearch() {
    this.dom.searchInput.value = '';
    this.dom.ghostInput.value = '';
    this.dom.clearBtn.classList.remove('visible');
    this.hideSuggestions();
    this.dom.searchInput.focus();
  }

  executeSearch(query) {
    this.hideSuggestions();
    if (!query.trim()) return;
    window.location.hash = `#results?q=${encodeURIComponent(query.trim())}`;
  }

  // --- Views & State Toggle ---
  showHomeView() {
    this.dom.appContainer.classList.remove('results-mode');
    this.dom.resultsSection.classList.add('hidden');
    this.dom.heroSection.appendChild(this.dom.searchBoxContainer);
    this.hideSuggestions();
  }

  showResultsView(query) {
    this.dom.appContainer.classList.add('results-mode');
    this.dom.resultsSection.classList.remove('hidden');
    
    const cleanQ = query.toLowerCase();
    const results = this.flatList.filter(item => 
      item.title.toLowerCase().includes(cleanQ) || 
      item.location.toLowerCase().includes(cleanQ)
    );

    this.renderResultsGrid(results);
  }

  moveSearchToCenter() {
    this.dom.heroSection.appendChild(this.dom.searchBoxContainer);
  }

  // --- Grid & Drag and Drop Rendering ---
  renderResultsGrid(results) {
    this.dom.resultsGrid.innerHTML = '';
    this.dom.resultsMeta.textContent = `Found ${results.length} result${results.length === 1 ? '' : 's'}`;

    if (results.length === 0) {
      this.dom.resultsGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:1rem; opacity:0.5;"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <p style="font-size:1.1rem; color:var(--text-secondary);">No poster entries found matching your query.</p>
        </div>
      `;
      return;
    }

    results.forEach(item => {
      const card = document.createElement('div');
      card.className = 'poster-card';
      
      const imgWrap = document.createElement('div');
      imgWrap.className = 'poster-img-wrap';

      if (this.stagedImages.has(item.title)) {
        const file = this.stagedImages.get(item.title);
        const objectUrl = URL.createObjectURL(file);
        const img = document.createElement('img');
        img.src = objectUrl;
        imgWrap.appendChild(img);
        card.classList.add('is-staged');
        card.dataset.resolvedPath = `${item.title}.${file.name.split('.').pop() || 'png'}`;
      } else {
        this.tryLoadStaticImage(item.candidatePaths).then(result => {
          if (result) {
            imgWrap.appendChild(result.img);
            card.dataset.resolvedPath = result.path.replace('../posters/', '');
          } else {
            imgWrap.innerHTML = `
              <div class="drop-zone-prompt">
                <svg class="fallback-svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <path d="M12 8v8m-4-4h8"/>
                </svg>
                <span>Drag & drop image to stage (.png, .jpg, .jpeg, .webp)</span>
              </div>
            `;
            card.dataset.resolvedPath = `${item.title}.png`;
          }
        });
      }

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('image/')) {
          const file = files[0];
          this.stagedImages.set(item.title, file);
          await this.saveStagedToDB(item.title, file);
          this.updateExportButton();
          
          const currentQuery = new URLSearchParams(window.location.hash.split('?')[1] || '').get('q') || '';
          this.showResultsView(currentQuery);
        }
      });

      const info = document.createElement('div');
      info.className = 'poster-info';
      info.innerHTML = `
        <div class="poster-card-title">${item.title}</div>
        <div class="poster-card-location">${item.location}</div>
      `;

      card.appendChild(imgWrap);
      card.appendChild(info);

      card.addEventListener('click', () => {
        if (!card.classList.contains('drag-over')) {
          const resolvedPath = card.dataset.resolvedPath || `${item.title}.png`;
          this.openModal(item, imgWrap.cloneNode(true), resolvedPath);
        }
      });

      this.dom.resultsGrid.appendChild(card);
    });
  }

  updateExportButton() {
    if (!this.dom.exportZipBtn || !this.dom.stagedCount) return;
    const count = this.stagedImages.size;
    this.dom.stagedCount.textContent = count;
    this.dom.exportZipBtn.classList.toggle('hidden', count === 0);
  }

  // --- JSZip Export ---
  async exportZip() {
    if (this.stagedImages.size === 0 || typeof JSZip === 'undefined') return;

    const zip = new JSZip();
    const folder = zip.folder("posters");

    for (const [title, file] of this.stagedImages.entries()) {
      const ext = file.name.split('.').pop() || 'png';
      folder.file(`${title}.${ext}`, file);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = "posters-update.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // --- Modal Display ---
  openModal(item, clonedImgNode, resolvedPath) {
    this.dom.modalTitle.textContent = item.title;
    this.dom.modalLocation.textContent = item.location;
    this.dom.modalPath.textContent = resolvedPath || `${item.title}.png`;
    this.dom.modalKey.textContent = `KEY-${Math.floor(1000 + Math.random() * 9000)}`;

    this.dom.modalPosterWrap.innerHTML = '';
    this.dom.modalPosterWrap.appendChild(clonedImgNode);

    this.dom.modalBackdrop.classList.remove('hidden');
  }

  closeModal() {
    this.dom.modalBackdrop.classList.add('hidden');
  }
}

// Instantiate application on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  window.app = new PosterApp();
});
