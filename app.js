const DATA_URL = 'https://opensheet.elk.sh/19q7ac_1HikdJK_mAoItd65khDHi0pNCR8PrdIcR6Fhc/all_tracks';

const FILTERS = [
  { id: 'all', label: 'See all', days: null },
  { id: 'last7', label: 'Last 7 days', days: 7 },
  { id: 'last14', label: 'Last 14 days', days: 14 },
  { id: 'last30', label: 'Last 30 days', days: 30 },
];

const state = {
  tracks: [],
  curators: [],
  counts: new Map(),
  activeCurator: null,
  activeFilter: FILTERS[0].id,
  currentPage: 1,
  pageSize: 20,
};

const elements = {
  tabList: document.querySelector('#tabList'),
  cardsContainer: document.querySelector('#cardsContainer'),
  filterButtons: document.querySelector('#filterButtons'),
  statusMessage: document.querySelector('#statusMessage'),
  refreshButton: document.querySelector('#refreshButton'),
  pagination: document.querySelector('#paginationControls'),
};

document.addEventListener('DOMContentLoaded', () => {
  if (elements.cardsContainer) {
    elements.cardsContainer.setAttribute('role', 'tabpanel');
    elements.cardsContainer.setAttribute('tabindex', '0');
  }
  bindUI();
  loadData();
});

function bindUI() {
  if (elements.refreshButton) {
    elements.refreshButton.addEventListener('click', () => {
      loadData({ force: true });
    });
  }

  renderFilters();

  if (elements.tabList) {
    elements.tabList.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        return;
      }

      event.preventDefault();
      const buttons = Array.from(elements.tabList.querySelectorAll('.tab-button'));
      if (!buttons.length) return;

      const currentIndex = Math.max(0, buttons.findIndex((btn) => btn.dataset.curator === state.activeCurator));
      let targetIndex = currentIndex;

      if (event.key === 'ArrowDown') {
        targetIndex = (currentIndex + 1) % buttons.length;
      } else if (event.key === 'ArrowUp') {
        targetIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      } else if (event.key === 'Home') {
        targetIndex = 0;
      } else if (event.key === 'End') {
        targetIndex = buttons.length - 1;
      }

      const targetButton = buttons[targetIndex];
      if (targetButton) {
        targetButton.focus();
        const targetCurator = targetButton.dataset.curator;
        if (targetCurator && targetCurator !== state.activeCurator) {
          setActiveCurator(targetCurator);
        }
      }
    });
  }
}

async function loadData({ force = false } = {}) {
  toggleLoading(true);
  setStatus('Fetching tracks...');

  try {
    const response = await fetch(`${DATA_URL}${force ? `?t=${Date.now()}` : ''}`);
    if (!response.ok) {
      throw new Error(`Failed to load tracks: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error('Unexpected response format; expected an array of tracks.');
    }

    const { tracks, counts } = normaliseData(payload);

    if (!tracks.length) {
      throw new Error('No tracks returned from the source.');
    }

    state.tracks = tracks;
    state.counts = counts;
    state.currentPage = 1;
    state.curators = Array.from(counts.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    if (!state.curators.includes(state.activeCurator)) {
      state.activeCurator = state.curators[0] ?? null;
    }

    renderTabs();
    renderCards();
    setStatus(
      `Showing ${formatNumber(tracks.length)} tracks across ${state.curators.length} curator${
        state.curators.length !== 1 ? 's' : ''
      }.`
    );
  } catch (error) {
    console.error(error);
    state.tracks = [];
    state.currentPage = 1;
    state.curators = [];
    state.counts = new Map();
    state.activeCurator = null;
    if (elements.tabList) {
      elements.tabList.innerHTML = '';
    }
    if (elements.cardsContainer) {
      elements.cardsContainer.innerHTML = '';
    }
    if (elements.pagination) {
      elements.pagination.innerHTML = '';
      elements.pagination.classList.add('hidden');
    }
    setStatus(error.message || 'Something went wrong while loading tracks.');
  } finally {
    toggleLoading(false);
  }
}

function normaliseData(entries) {
  const counts = new Map();

  const tracks = entries
    .map((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        return null;
      }

      const curator = typeof entry.curator === 'string' ? entry.curator.trim() : '';
      if (!curator) {
        return null;
      }

      const dateRaw =
        typeof entry.date === 'string'
          ? entry.date.trim()
          : entry.date != null
          ? String(entry.date)
          : '';
      const trackName = typeof entry.track === 'string' ? entry.track.trim() : '';
      const artist = typeof entry.artist === 'string' ? entry.artist.trim() : '';
      const spotifyId = typeof entry.spotify_id === 'string' ? entry.spotify_id.trim() : '';

      const parsedDate = parseDateValue(dateRaw);

      const track = {
        id: spotifyId || `${slugify(curator)}-${index}`,
        curator,
        artist,
        track: trackName,
        dateLabel: dateRaw,
        spotifyId,
        timestamp: parsedDate?.getTime() ?? null,
        parsedDate,
      };

      counts.set(curator, (counts.get(curator) ?? 0) + 1);
      return track;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return b.timestamp - a.timestamp;
      }
      if (a.timestamp) return -1;
      if (b.timestamp) return 1;
      return a.track.localeCompare(b.track, undefined, { sensitivity: 'base' });
    });

  return {
    tracks,
    counts,
  };
}

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
    const isoDate = new Date(`${trimmed}T00:00:00Z`);
    return Number.isNaN(isoDate.getTime()) ? null : isoDate;
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmyMatch) {
    const [, dayStr, monthStr, yearStr] = dmyMatch;
    const day = Number.parseInt(dayStr, 10);
    const month = Number.parseInt(monthStr, 10);
    let year = Number.parseInt(yearStr, 10);

    if (yearStr.length === 2) {
      year += year > 50 ? 1900 : 2000;
    }

    if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
      return null;
    }

    const normalized = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(normalized.getTime()) ? null : normalized;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

  const fragment = document.createDocumentFragment();
  state.fields.forEach((field) => {
    const item = document.createElement('li');
    item.textContent = field;
    fragment.appendChild(item);
  });
  elements.fieldList.appendChild(fragment);
}

function renderTabs() {
  if (!elements.tabList) return;
  elements.tabList.innerHTML = '';

  if (!state.curators.length) {
    return;
  }

  elements.tabList?.setAttribute('aria-orientation', 'vertical');

  const fragment = document.createDocumentFragment();

  state.curators.forEach((curator, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tab-button${curator === state.activeCurator ? ' active' : ''}`;
    button.dataset.curator = curator;
    button.id = `tab-${slugify(curator)}-${index}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', curator === state.activeCurator ? 'true' : 'false');
    button.setAttribute('tabindex', curator === state.activeCurator ? '0' : '-1');
    button.setAttribute('aria-controls', 'cardsContainer');
    const count = state.counts.get(curator) ?? 0;
    button.textContent = `${curator} (${formatNumber(count)})`;

    button.addEventListener('click', () => {
      if (curator !== state.activeCurator) {
        setActiveCurator(curator);
      }
    });

    fragment.appendChild(button);
  });

  elements.tabList.appendChild(fragment);
}

function renderFilters() {
  if (!elements.filterButtons) return;
  elements.filterButtons.innerHTML = '';

  const fragment = document.createDocumentFragment();
  FILTERS.forEach((filter) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `filter-button${filter.id === state.activeFilter ? ' active' : ''}`;
    button.dataset.filterId = filter.id;
    button.textContent = filter.label;

    button.addEventListener('click', () => {
      if (state.activeFilter !== filter.id) {
        state.activeFilter = filter.id;
        state.currentPage = 1;
        renderFilters();
        renderCards();
      }
    });

    fragment.appendChild(button);
  });

  elements.filterButtons.appendChild(fragment);
}

function renderCards() {
  if (!elements.cardsContainer) return;
  elements.cardsContainer.innerHTML = '';

  if (!state.activeCurator) {
    renderPagination(0, 0);
    setStatus('Select a curator to see tracks.');
    return;
  }

  const filtered = state.tracks
    .filter((track) => track.curator === state.activeCurator)
    .filter(matchesActiveFilter);

  if (!filtered.length) {
    renderPagination(0, 0);
    const message = document.createElement('p');
    message.className = 'status-message';
    message.textContent = 'No tracks found for the selected filters.';
    elements.cardsContainer.appendChild(message);
    setStatus(`No tracks to show for ${state.activeCurator} with the current filter.`);
    return;
  }

  const totalPages = Math.ceil(filtered.length / state.pageSize) || 1;
  state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
  const startIndex = (state.currentPage - 1) * state.pageSize;
  const endIndex = startIndex + state.pageSize;
  const pageSlice = filtered.slice(startIndex, endIndex);

  const fragment = document.createDocumentFragment();

  pageSlice.forEach((track) => {
    fragment.appendChild(createTrackCard(track));
  });

  elements.cardsContainer.appendChild(fragment);
  renderPagination(totalPages, filtered.length);
  setStatus(
    `Showing ${formatNumber(pageSlice.length)} of ${formatNumber(filtered.length)} track${
      filtered.length !== 1 ? 's' : ''
    } for ${state.activeCurator} (page ${state.currentPage} of ${totalPages}).`
  );
}

function createTrackCard(track) {
  const article = document.createElement('article');
  article.className = 'track-card';
  article.setAttribute('role', 'group');
  article.setAttribute(
    'aria-label',
    `${track.track || 'Untitled track'} by ${track.artist || 'Unknown artist'}`
  );

  const title = document.createElement('h3');
  title.className = 'track-title';
  title.textContent = track.track || 'Untitled track';

  const artist = document.createElement('p');
  artist.className = 'track-artist';
  artist.textContent = track.artist || 'Unknown artist';

  const info = document.createElement('div');
  info.className = 'track-info';
  info.append(title, artist);

  const meta = document.createElement('div');
  meta.className = 'track-meta';

  const dateBadge = createMetaBadge('Date', track.dateLabel || 'Unspecified');
  const curatorBadge = createMetaBadge('Curator', track.curator || 'Unknown');

  meta.append(dateBadge, curatorBadge);

  article.append(info, meta);

  return article;
}

function createMetaBadge(label, value) {
  const badge = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = label;
  badge.append(strong, document.createTextNode(` ${value}`));
  return badge;
}

function renderPagination(totalPages, totalItems) {
  if (!elements.pagination) return;
  elements.pagination.innerHTML = '';

  if (totalPages <= 1 || totalItems <= state.pageSize) {
    elements.pagination.classList.add('hidden');
    return;
  }

  elements.pagination.classList.remove('hidden');

  const fragment = document.createDocumentFragment();

  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.textContent = 'Previous';
  prevButton.disabled = state.currentPage === 1;
  prevButton.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage -= 1;
      renderCards();
    }
  });

  const indicator = document.createElement('span');
  indicator.className = 'page-indicator';
  indicator.textContent = `Page ${state.currentPage} of ${totalPages}`;

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.textContent = 'Next';
  nextButton.disabled = state.currentPage >= totalPages;
  nextButton.addEventListener('click', () => {
    if (state.currentPage < totalPages) {
      state.currentPage += 1;
      renderCards();
    }
  });

  fragment.append(prevButton, indicator, nextButton);
  elements.pagination.appendChild(fragment);
}

function matchesActiveFilter(track) {
  const filter = FILTERS.find((item) => item.id === state.activeFilter);
  if (!filter || filter.days == null) {
    return true;
  }
  if (!track.timestamp) {
    return false;
  }

  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const threshold = todayMidnight.getTime() - filter.days * 24 * 60 * 60 * 1000;
  return track.timestamp >= threshold;
}

function setActiveCurator(curator) {
  state.activeCurator = curator;
  state.currentPage = 1;
  renderTabs();
  renderCards();
  focusActiveTab();
}

function focusActiveTab() {
  if (!elements.tabList) return;
  const activeButton = elements.tabList.querySelector('.tab-button.active');
  activeButton?.focus();
}

function setStatus(message) {
  if (!elements.statusMessage) return;
  elements.statusMessage.textContent = message || '';
}

function toggleLoading(isLoading) {
  if (!elements.refreshButton) return;
  elements.refreshButton.disabled = isLoading;
  elements.refreshButton.textContent = isLoading ? 'Refreshing...' : 'Refresh';
  if (isLoading) {
    elements.refreshButton.setAttribute('aria-busy', 'true');
  } else {
    elements.refreshButton.removeAttribute('aria-busy');
  }
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .trim() || 'curator'
  );
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}
