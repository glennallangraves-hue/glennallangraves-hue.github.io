// Application State & Manager
class PosterApp {
  constructor() {
    this.dataset = {};
    this.flatList = []; // [{ title, location, imagePath }]
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
    await this.loadData();
    this.bindEvents();
    this.handleRoute();
  }

  // Load sample dataset or json file
  async loadData() {
    try {
      const res = await fetch('data.json');
      if (!res.ok) throw new Error('Could not fetch data.json');
      this.dataset = await res.json();
    } catch (err) {
      console.warn('Falling back to default inline JSON sample dataset:', err);
      this.dataset = {};
    }

    // Flatten data for efficient search indexing
    this.flatList = [];
    for (const [location, movies] of Object.entries(this.dataset)) {
      movies.forEach(title => {
        this.flatList.push({
          title,
          location,
          imagePath: `./posters/${title}.png`
        });
      });
    }
  }

  bindEvents() {
    // Hash route changes
    window.addEventListener('hashchange', () => this.handleRoute());

    // Input events
    this.dom.searchInput.addEventListener('input', () => this.onInputChanged());
    this.dom.searchInput.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.dom.clearBtn.addEventListener('click', () => this.clearSearch());

    // Focus restore when clicking header search pill
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

    // Global Key Shortcuts ('/' to focus search, Esc to dismiss modal/dropdown)
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== this.dom.searchInput) {
        e.preventDefault();
        this.dom.searchInput.focus();
      } else if (e.key === 'Escape') {
        this.closeModal();
        this.hideSuggestions();
      }
    });

    // Click outside to hide dropdown
    document.addEventListener('click', (e) => {
      if (!this.dom.searchBoxContainer.contains(e.target)) {
        this.hideSuggestions();
      }
    });

    // Modal Close
    this.dom.modalCloseBtn.addEventListener('click', () => this.closeModal());
    this.dom.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === this.dom.modalBackdrop) this.closeModal();
    });
  }

  // Handle URL Routing via window.location.hash (#results?q=query)
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
    
    if (value.trim().length > 0) {
      this.dom.clearBtn.classList.add('visible');
    } else {
      this.dom.clearBtn.classList.remove('visible');
    }

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

    // Filter and score matches
    this.currentMatches = this.flatList
      .filter(item => 
        item.title.toLowerCase().includes(cleanQuery) || 
        item.location.toLowerCase().includes(cleanQuery)
      )
      .sort((a, b) => {
        const aTitleStarts = a.title.toLowerCase().startsWith(cleanQuery);
        const bTitleStarts = b.title.toLowerCase().startsWith(cleanQuery);
        if (aTitleStarts && !bTitleStarts) return -1;
        if (!aTitleStarts && bTitleStarts) return 1;
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
      // Preserve case of typed user text + match remaining tail
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
    
    // Display up to top 6 items
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
      // Tab or Right Arrow autofills top suggestion / ghost text
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
        // Update ghost text to active highlighted recommendation
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

  // Views & State Toggle
  showHomeView() {
    this.dom.appContainer.classList.remove('results-mode');
    this.dom.resultsSection.classList.add('hidden');
    this.dom.heroSection.appendChild(this.dom.searchBoxContainer);
    this.hideSuggestions();
  }

  showResultsView(query) {
    this.dom.appContainer.classList.add('results-mode');
    this.dom.resultsSection.classList.remove('hidden');
    
    // Perform filtering for results page
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

  // Render Grid Results
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

      // Check image availability or fallback
      const img = new Image();
      img.src = item.imagePath;
      
      img.onload = () => {
        imgWrap.appendChild(img);
      };

      img.onerror = () => {
        // Fallback Blank SVG graphic with icon
        imgWrap.innerHTML = `
          <svg class="fallback-svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        `;
      };

      const info = document.createElement('div');
      info.className = 'poster-info';
      info.innerHTML = `
        <div class="poster-card-title">${item.title}</div>
        <div class="poster-card-location">${item.location}</div>
      `;

      card.appendChild(imgWrap);
      card.appendChild(info);

      card.addEventListener('click', () => this.openModal(item, imgWrap.cloneNode(true)));

      this.dom.resultsGrid.appendChild(card);
    });
  }

  // Modal View Display
  openModal(item, clonedImgNode) {
    this.dom.modalTitle.textContent = item.title;
    this.dom.modalLocation.textContent = item.location;
    this.dom.modalPath.textContent = `${item.title}.png`;
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