const DATA_SOURCE_URL = 'https://opensheet.elk.sh/19q7ac_1HikdJK_mAoItd65khDHi0pNCR8PrdIcR6Fhc/all_tracks';
const API_URL = '/.netlify/functions/tracks';
const WEBHOOK_URL = 'https://n8n.niprobin.com/webhook/add-to-radio';
const STATUS_WEBHOOK_URL = 'https://n8n.niprobin.com/webhook/track-checked';

const STORAGE_KEYS = {
  checked: 'curatedDigging:checkedTracks',
  showChecked: 'curatedDigging:showChecked',
};

const FILTERS = [
  { id: 'all', label: 'See all', days: null },
  { id: 'last7', label: 'Last 7 days', days: 7 },
  { id: 'last14', label: 'Last 14 days', days: 14 },
  { id: 'last30', label: 'Last 30 days', days: 30 },
];

const PLAYLIST_OPTIONS = [
  'Afrobeat & Highlife',
  'Beats',
  'Bossa Nova',
  'Brazilian Music',
  'Disco',
  'DNB Intelligent',
  'Downtempo Trip-hop',
  'Funk & Rock',
  'Hip-hop',
  'House Chill',
  'House Dancefloor',
  'Jazz Classic',
  'Jazz Funk',
  'Latin Music',
  'Morning Chill',
  'Neo Soul',
  'Reggae',
  'RnB',
  'Soul Music',
];


const state = {
  tracks: [],
  curators: [],
  counts: new Map(),
  activeCurator: null,
  activeFilter: FILTERS[0].id,
  currentPage: 1,
  pageSize: 20,
  checkedTracks: new Set(),
  showChecked: false,
  lookupTrackId: null,
  isFetchingLookup: false,
  lookupRequestId: null,
  lookupAbortController: null,
  lookupButton: null,
  playlistDrawer: null,
  playlistDrawerOverlay: null,
  playlistDrawerTitle: null,
  playlistDrawerList: null,
  playlistDrawerCloseButton: null,
  playlistDrawerTrigger: null,
  playlistDrawerTrack: null,
  playlistDrawerTrackId: null,
  isPlaylistDrawerOpen: false,
  miniPlayer: null,
  miniPlayerControl: null,
  miniPlayerProgress: null,
  miniPlayerCurrentTime: null,
  miniPlayerDuration: null,
  miniPlayerLabel: null,
  miniPlayerCloseButton: null,
  miniPlayerAudio: null,
  miniPlayerTrackSourceId: null,
  miniPlayerTrack: null,
  miniPlayerRemoteTrack: null,
  miniPlayerAbortController: null,
  miniPlayerRequestId: null,
  miniPlayerIsOpen: false,
  isMiniPlayerLoading: false,
  activeTrackId: null,
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
  initializeCheckedState();
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
    const payload = await requestTracks({ force });
    if (!Array.isArray(payload)) {
      throw new Error('Unexpected response format; expected an array of tracks.');
    }

    const { tracks, counts } = normaliseData(payload);

    if (!tracks.length) {
      throw new Error('No tracks returned from the source.');
    }

    state.tracks = tracks;
    state.counts = counts;
    pruneCheckedTracks(tracks);
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

      const checkedValue = entry.checked;
      if (isCheckedFlag(checkedValue)) {
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

function isCheckedFlag(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return ['true', '1', 'yes', 'y'].includes(normalized);
  }
  return false;
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
    button.textContent = `${curator}`;

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
    button.setAttribute('aria-pressed', filter.id === state.activeFilter ? 'true' : 'false');

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

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = `filter-button filter-button--checked-toggle${state.showChecked ? ' active' : ''}`;
  toggleButton.textContent = state.showChecked ? 'Hide checked tracks' : 'Show checked tracks';
  toggleButton.setAttribute('aria-pressed', state.showChecked ? 'true' : 'false');
  toggleButton.addEventListener('click', () => {
    state.showChecked = !state.showChecked;
    persistShowCheckedPreference(state.showChecked);
    state.currentPage = 1;
    renderFilters();
    renderCards();
  });

  fragment.appendChild(toggleButton);

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

  const curatorTracks = state.tracks
    .filter((track) => track.curator === state.activeCurator)
    .filter(matchesActiveFilter);

  if (state.lookupTrackId != null && !curatorTracks.some((item) => String(item.id) === String(state.lookupTrackId))) {
    if (state.lookupAbortController) {
      try {
        state.lookupAbortController.abort();
      } catch (error) {
        console.warn('Unable to abort lookup request during rerender.', error);
      }
    }
    state.lookupTrackId = null;
    state.isFetchingLookup = false;
    state.lookupRequestId = null;
    state.lookupAbortController = null;
    state.lookupButton = null;
  }

  if (state.isPlaylistDrawerOpen) {
    const trigger = state.playlistDrawerTrigger;
    const drawerTrackId = state.playlistDrawerTrackId;
    const triggerConnected = Boolean(trigger && trigger.isConnected);
    const stillVisible = drawerTrackId != null && curatorTracks.some((item) => String(item.id) === drawerTrackId);
    if (!triggerConnected || !stillVisible) {
      closePlaylistDrawer({ focusTrigger: false });
    }
  }

  const hiddenCount = curatorTracks.filter((track) => isTrackChecked(track.id)).length;
  const filtered = state.showChecked
    ? curatorTracks
    : curatorTracks.filter((track) => !isTrackChecked(track.id));

  if (!filtered.length) {
    renderPagination(0, 0);
    const message = document.createElement('p');
    message.className = 'status-message';
    message.textContent = state.showChecked
      ? 'No tracks found for the selected filters.'
      : 'No unchecked tracks found for the selected filters.';
    elements.cardsContainer.appendChild(message);
    setStatus(
      state.showChecked
        ? `No tracks to show for ${state.activeCurator} with the current filter.`
        : `All tracks for ${state.activeCurator} are marked as checked.`
    );
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
  const visibleLabel = state.showChecked ? 'tracks' : 'unchecked tracks';
  const visibleCount = filtered.length;
  const totalMatches = curatorTracks.length;
  const baseMessage = `Showing ${formatNumber(pageSlice.length)} of ${formatNumber(visibleCount)} ${visibleLabel} for ${state.activeCurator} (page ${state.currentPage} of ${totalPages}).`;
  let hiddenMessage = '';
  if (hiddenCount > 0) {
    hiddenMessage = state.showChecked
      ? ` ${formatNumber(hiddenCount)} track${hiddenCount !== 1 ? 's are' : ' is'} marked as checked.`
      : ` ${formatNumber(hiddenCount)} of ${formatNumber(totalMatches)} track${hiddenCount !== 1 ? 's are' : ' is'} hidden because they are checked.`;
  }
  setStatus(baseMessage + hiddenMessage);
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

  const dateLine = document.createElement('p');
  dateLine.className = 'track-date';
  dateLine.textContent = track.dateLabel ? `Date: ${track.dateLabel}` : 'Date: Unspecified';

  const info = document.createElement('div');
  info.className = 'track-info';
  info.append(title, artist, dateLine);

  const actions = document.createElement('div');
  actions.className = 'track-actions';

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'track-action-button play-button';
  playButton.dataset.trackId = track.id != null ? String(track.id) : '';
  playButton.setAttribute('aria-label', 'Play track');
  playButton.setAttribute('aria-pressed', 'false');

  setPlayButtonState(playButton, getPlayButtonStateForTrack(track.id));

  playButton.addEventListener('click', () => {
    handlePlayButtonClick({ track, playButton });
  });

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'track-action-button track-action-button--add';
  addButton.setAttribute('aria-label', 'Add track to playlist');
  addButton.setAttribute('aria-haspopup', 'dialog');
  addButton.setAttribute('aria-expanded', 'false');
  addButton.innerHTML = '<i class=\"fa-solid fa-plus\"></i>';

  const statusButton = document.createElement('button');
  statusButton.type = 'button';
  statusButton.className = 'track-action-button status-button';
  statusButton.setAttribute('aria-label', 'Mark track as checked');
  statusButton.setAttribute('aria-pressed', 'false');
  statusButton.innerHTML = '<i class=\"fa-solid fa-check\"></i>';

  const trackId = track.id;
  const setStatusButtonState = (checked) => {
    statusButton.classList.toggle('is-checked', checked);
    statusButton.setAttribute('aria-pressed', checked ? 'true' : 'false');
    statusButton.setAttribute(
      'aria-label',
      checked ? 'Unmark track as checked' : 'Mark track as checked'
    );
  };

  setStatusButtonState(isTrackChecked(trackId));

  statusButton.addEventListener('click', async () => {
    const nextState = !isTrackChecked(trackId);
    const label = formatTrackLabel(track.artist, track.track);

    statusButton.disabled = true;
    statusButton.classList.add('is-busy');
    statusButton.setAttribute('aria-busy', 'true');

    try {
      await postTrackCheckedStatus({ track, checked: nextState });
      const changed = setTrackChecked(trackId, nextState);
      if (changed) {
        setStatus(nextState ? `${label} marked as checked.` : `${label} marked as unchecked.`);
      }
    } catch (error) {
      console.error('Unable to update track checked status.', error);
      setStatus(`Unable to update status for ${label}. Please try again.`);
    } finally {
      statusButton.disabled = false;
      statusButton.classList.remove('is-busy');
      statusButton.removeAttribute('aria-busy');
    }
  });

  addButton.addEventListener('click', (event) => {
    event.preventDefault();
    openPlaylistDrawer({ track, trigger: addButton });
  });

  actions.append(playButton, addButton, statusButton);

  article.append(info, actions);

  return article;
}

function getPlayButtonStateForTrack(trackId) {
  if (trackId == null) {
    return 'idle';
  }
  const normalised = String(trackId);
  if (state.lookupTrackId != null && String(state.lookupTrackId) === normalised && state.isFetchingLookup) {
    return 'loading';
  }
  if (state.miniPlayerIsOpen && state.miniPlayerTrack && state.miniPlayerTrack.id != null && String(state.miniPlayerTrack.id) === normalised) {
    return 'active';
  }
  if (state.activeTrackId != null && String(state.activeTrackId) === normalised) {
    return 'active';
  }
  return 'idle';
}
function setPlayButtonState(button, stateValue) {
  if (!button) return;
  button.classList.remove('is-loading', 'is-active');
  button.disabled = false;
  if (stateValue === 'loading') {
    button.classList.add('is-loading');
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    button.setAttribute('aria-label', 'Loading preview');
    button.setAttribute('aria-pressed', 'false');
    return;
  }
  if (stateValue === 'active') {
    button.classList.add('is-active');
    button.innerHTML = '<i class="fa-solid fa-play"></i>';
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', 'Playing preview');
    return;
  }
  button.innerHTML = '<i class="fa-solid fa-play"></i>';
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', 'Play track');
}
async function handlePlayButtonClick({ track, playButton }) {
  if (!track || !playButton) {
    return;
  }
  if (state.lookupAbortController) {
    try {
      state.lookupAbortController.abort();
    } catch (error) {
      console.warn('Unable to abort lookup request.', error);
    }
  }
  const requestId = Symbol('lookup-request');
  state.lookupRequestId = requestId;
  const currentTrackId = track.id != null ? String(track.id) : null;
  state.lookupTrackId = currentTrackId;
  state.isFetchingLookup = true;
  state.lookupButton = playButton;
  const rawQuery = `${track.artist || ''} ${track.track || ''}`;
  const searchQuery = rawQuery.trim();
  const requestUrl = new URL('https://eu.qqdl.site/api/get-music');
  requestUrl.searchParams.set('q', searchQuery || rawQuery);
  requestUrl.searchParams.set('offset', '0');
  const controller = new AbortController();
  state.lookupAbortController = controller;
  setPlayButtonState(playButton, 'loading');
  try {
    const response = await fetch(requestUrl.toString(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const payload = await response.json();
    if (payload?.success === false) {
      const reason = payload?.error?.message || 'Lookup failed.';
      throw new Error(reason);
    }
    const items =
      payload?.data?.tracks?.items ||
      payload?.tracks?.items ||
      payload?.data?.items ||
      payload?.items ||
      [];
    const item = Array.isArray(items) ? items[0] : null;
    if (!item) {
      throw new Error('No results found.');
    }
    if (state.lookupRequestId !== requestId) {
      return;
    }
    const performerName = item?.performer?.name ?? 'Unknown performer';
    const trackTitle = item?.title ?? 'Unknown title';
    const remoteTrackId = item?.id != null ? String(item.id) : null;
    if (!remoteTrackId) {
      throw new Error('Preview unavailable for this track.');
    }
    clearActiveTrackButton();
    openMiniPlayer({
      remoteTrackId,
      track,
      performerName,
      trackTitle,
    });
    setPlayButtonState(playButton, 'active');
    state.activeTrackId = currentTrackId;
  } catch (error) {
    if (error.name === 'AbortError') {
      if (state.lookupButton !== playButton) {
        setPlayButtonState(playButton, 'idle');
      }
      return;
    }
    console.error('Unable to fetch track information.', error);
    if (state.lookupRequestId !== requestId) {
      return;
    }
    const label = formatTrackLabel(track.artist, track.track);
    const message = error && error.message ? error.message : 'Unexpected error.';
    setStatus(`Lookup failed for ${label}: ${message}`);
    setPlayButtonState(playButton, 'idle');
  } finally {
    if (state.lookupRequestId === requestId) {
      state.lookupTrackId = null;
      state.isFetchingLookup = false;
      state.lookupAbortController = null;
      state.lookupButton = null;
      state.lookupRequestId = null;
    }
  }
}

function getPlayButtonElement(trackId) {
  if (trackId == null) {
    return null;
  }
  const value = String(trackId);
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\u0027\\]/g, '\\$&');
  return document.querySelector(`.play-button[data-track-id="${escaped}"]`);
}
function clearActiveTrackButton() {
  if (state.activeTrackId == null) {
    return;
  }
  const button = getPlayButtonElement(state.activeTrackId);
  if (button) {
    setPlayButtonState(button, 'idle');
  }
  state.activeTrackId = null;
}

function ensurePlaylistDrawer() {
  if (state.playlistDrawer) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'playlist-drawer-overlay';
  overlay.setAttribute('hidden', '');

  const drawer = document.createElement('aside');
  drawer.className = 'playlist-drawer';
  drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = `
    <div class="playlist-drawer__header">
      <h2 class="playlist-drawer__title">Select playlist</h2>
      <button type="button" class="playlist-drawer__close" aria-label="Close playlist drawer">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="playlist-drawer__body">
      <p class="playlist-drawer__track-label">Choose a playlist for this track.</p>
      <div class="playlist-drawer__list" role="listbox"></div>
    </div>
  `;

  document.body.append(overlay, drawer);

  state.playlistDrawer = drawer;
  state.playlistDrawerOverlay = overlay;
  state.playlistDrawerTitle = drawer.querySelector('.playlist-drawer__track-label');
  state.playlistDrawerList = drawer.querySelector('.playlist-drawer__list');
  state.playlistDrawerCloseButton = drawer.querySelector('.playlist-drawer__close');

  if (state.playlistDrawerCloseButton) {
    state.playlistDrawerCloseButton.addEventListener('click', () => {
      closePlaylistDrawer({ focusTrigger: true });
    });
  }
  if (state.playlistDrawerOverlay) {
    state.playlistDrawerOverlay.addEventListener('click', () => {
      closePlaylistDrawer({ focusTrigger: true });
    });
  }

  const list = state.playlistDrawerList;
  if (list) {
    PLAYLIST_OPTIONS.forEach((option) => {
      const optionButton = document.createElement('button');
      optionButton.type = 'button';
      optionButton.className = 'playlist-drawer__item';
      optionButton.textContent = option;
      optionButton.dataset.playlistName = option;
      optionButton.addEventListener('click', () => {
        handlePlaylistSelection(option);
      });
      list.appendChild(optionButton);
    });
  }
}

function openPlaylistDrawer({ track, trigger }) {
  if (!track || !trigger) {
    return;
  }

  ensurePlaylistDrawer();

  if (state.isPlaylistDrawerOpen) {
    closePlaylistDrawer({ focusTrigger: false });
  }

  state.playlistDrawerTrack = track;
  state.playlistDrawerTrackId = track?.id != null ? String(track.id) : null;
  state.playlistDrawerTrigger = trigger;
  state.isPlaylistDrawerOpen = true;

  trigger.setAttribute('aria-expanded', 'true');

  const label = formatTrackLabel(track.artist, track.track);
  if (state.playlistDrawerTitle) {
    state.playlistDrawerTitle.textContent = label;
  }

  if (state.playlistDrawerOverlay) {
    state.playlistDrawerOverlay.removeAttribute('hidden');
  }
  if (state.playlistDrawer) {
    state.playlistDrawer.classList.add('is-open');
    state.playlistDrawer.setAttribute('aria-hidden', 'false');
  }

  document.removeEventListener('keydown', handlePlaylistDrawerKeydown);
  document.addEventListener('keydown', handlePlaylistDrawerKeydown);

  if (state.playlistDrawerList) {
    const firstItem = state.playlistDrawerList.querySelector('.playlist-drawer__item');
    if (firstItem) {
      try {
        firstItem.focus({ preventScroll: true });
      } catch (error) {
        console.warn('Unable to focus playlist option', error);
      }
    }
  }
}

function handlePlaylistDrawerKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closePlaylistDrawer({ focusTrigger: true });
  }
}

function handlePlaylistSelection(playlist) {
  if (!playlist || !state.playlistDrawerTrack) {
    return;
  }
  const trigger = state.playlistDrawerTrigger;
  handleAddButtonClick({ track: state.playlistDrawerTrack, addButton: trigger, playlist });
}

function closePlaylistDrawer({ focusTrigger = false } = {}) {
  if (!state.isPlaylistDrawerOpen) {
    return;
  }

  state.isPlaylistDrawerOpen = false;
  state.playlistDrawerTrack = null;
  state.playlistDrawerTrackId = null;

  if (state.playlistDrawer) {
    state.playlistDrawer.classList.remove('is-open');
    state.playlistDrawer.setAttribute('aria-hidden', 'true');
  }
  if (state.playlistDrawerOverlay) {
    state.playlistDrawerOverlay.setAttribute('hidden', '');
  }

  const firstItem = state.playlistDrawerList?.querySelector('.playlist-drawer__item');
  if (firstItem) {
    try {
      firstItem.blur();
    } catch (error) {
      console.warn('Unable to blur playlist option', error);
    }
  }

  if (state.playlistDrawerTrigger && state.playlistDrawerTrigger.isConnected) {
    state.playlistDrawerTrigger.setAttribute('aria-expanded', 'false');
  }

  if (focusTrigger && state.playlistDrawerTrigger && state.playlistDrawerTrigger.isConnected) {
    try {
      state.playlistDrawerTrigger.focus();
    } catch (error) {
      console.warn('Unable to focus playlist trigger', error);
    }
  }

  state.playlistDrawerTrigger = null;
  document.removeEventListener('keydown', handlePlaylistDrawerKeydown);
}

async function handleAddButtonClick({ track, addButton, playlist }) {
  if (!track || !addButton) return;

  const selectedPlaylist = typeof playlist === 'string' ? playlist.trim() : '';
  if (!selectedPlaylist) {
    setStatus('Select a playlist before adding this track.');
    return;
  }

  closePlaylistDrawer({ focusTrigger: false });

  const label = formatTrackLabel(track.artist, track.track);
  const trackId = track.id;
  const payload = buildTrackPayload(track, selectedPlaylist);

  try {
    addButton.disabled = true;
    addButton.classList.add('is-busy');
    addButton.setAttribute('aria-busy', 'true');
    setStatus(`Adding ${label} to ${selectedPlaylist}...`);

    await postTrackToWebhook(payload);

    const changed = setTrackChecked(trackId, true);
    setStatus(
      `${label} sent to ${selectedPlaylist} ${changed ? 'and marked as checked.' : 'and was already checked.'}`
    );
  } catch (error) {
    console.error(error);
    setStatus(`Unable to add ${label} to ${selectedPlaylist}. Please try again.`);
  } finally {
    if (state.showChecked || !isTrackChecked(trackId)) {
      addButton.disabled = false;
    }
    addButton.classList.remove('is-busy');
    addButton.removeAttribute('aria-busy');
    addButton.setAttribute('aria-expanded', 'false');
    try {
      addButton.focus();
    } catch (error) {
      console.warn('Unable to focus add button after submission.', error);
    }
  }
}

async function postTrackToWebhook(payload) {
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook responded with ${response.status}`);
  }
}

async function postTrackCheckedStatus({ track, checked }) {
  const payload = {
    'spotify_id': track?.spotifyId || '',
    artist: track?.artist || 'Unknown Artist',
    title: track?.track || 'Untitled Track',
    checked: Boolean(checked),
  };

  const response = await fetch(STATUS_WEBHOOK_URL, {
    method: 'POST',
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Status webhook responded with ${response.status}`);
  }
}

function ensureMiniPlayer() {
  if (state.miniPlayer) {
    return;
  }

  const container = document.createElement('section');
  container.className = 'mini-player';
  container.setAttribute('aria-live', 'polite');

  container.innerHTML = `
    <div class="mini-player__content">
      <button type="button" class="track-action-button mini-player__control" aria-label="Play preview">
        <i class="fa-solid fa-play"></i>
      </button>
      <div class="mini-player__info">
        <span class="mini-player__label">Preview</span>
        <div class="mini-player__timeline">
          <span class="mini-player__time mini-player__time--current">0:00</span>
          <input type="range" min="0" value="0" class="mini-player__progress" />
          <span class="mini-player__time mini-player__time--duration">--:--</span>
        </div>
      </div>
      <button type="button" class="track-action-button mini-player__close" aria-label="Close preview">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `;

  document.body.appendChild(container);

  state.miniPlayer = container;
  state.miniPlayerControl = container.querySelector('.mini-player__control');
  state.miniPlayerProgress = container.querySelector('.mini-player__progress');
  state.miniPlayerCurrentTime = container.querySelector('.mini-player__time--current');
  state.miniPlayerDuration = container.querySelector('.mini-player__time--duration');
  state.miniPlayerLabel = container.querySelector('.mini-player__label');
  state.miniPlayerCloseButton = container.querySelector('.mini-player__close');

  if (state.miniPlayerControl) {
    state.miniPlayerControl.addEventListener('click', handleMiniPlayerControlClick);
  }
  if (state.miniPlayerProgress) {
    state.miniPlayerProgress.addEventListener('input', handleMiniPlayerSeek);
    state.miniPlayerProgress.disabled = true;
    state.miniPlayerProgress.value = '0';
    state.miniPlayerProgress.max = '0';
  }
  if (state.miniPlayerCloseButton) {
    state.miniPlayerCloseButton.addEventListener('click', closeMiniPlayer);
  }

  if (state.miniPlayerCurrentTime) {
    state.miniPlayerCurrentTime.textContent = '0:00';
  }
  if (state.miniPlayerDuration) {
    state.miniPlayerDuration.textContent = '--:--';
  }
}

function openMiniPlayer({ remoteTrackId, track, performerName, trackTitle }) {
  if (!remoteTrackId) {
    setStatus('Preview unavailable for this track.');
    return;
  }

  ensureMiniPlayer();

  const labelText = formatRemoteTrackLabel(performerName, trackTitle);
  if (state.miniPlayerLabel) {
    state.miniPlayerLabel.textContent = labelText;
  }

  state.miniPlayerTrackSourceId = String(remoteTrackId);
  state.miniPlayerTrack = track || null;
  state.miniPlayerRemoteTrack = {
    performer: performerName || 'Unknown performer',
    title: trackTitle || 'Unknown title',
  };
  state.miniPlayerIsOpen = true;
  state.activeTrackId = track?.id != null ? String(track.id) : null;

  if (state.miniPlayer) {
    state.miniPlayer.classList.add('is-visible');
  }

  stopMiniPlayerAudio({ silent: true });
  resetMiniPlayerProgress();
  setMiniPlayerControlState('loading');

  beginMiniPlayerPlayback();
}

function setMiniPlayerControlState(mode) {
  const button = state.miniPlayerControl;
  if (!button) return;

  button.classList.remove('is-loading', 'is-playing');
  button.disabled = false;

  if (mode === 'loading') {
    button.classList.add('is-loading');
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    button.setAttribute('aria-label', 'Loading preview');
    return;
  }

  if (mode === 'playing') {
    button.classList.add('is-playing');
    button.innerHTML = '<i class="fa-solid fa-pause"></i>';
    button.setAttribute('aria-label', 'Pause preview');
    return;
  }

  button.innerHTML = '<i class="fa-solid fa-play"></i>';
  button.setAttribute('aria-label', 'Play preview');
}

function handleMiniPlayerControlClick() {
  if (state.isMiniPlayerLoading) {
    return;
  }

  if (state.miniPlayerAudio && !state.miniPlayerAudio.paused) {
    stopMiniPlayerAudio({ silent: false });
    return;
  }

  if (!state.miniPlayerTrackSourceId) {
    setStatus('Preview unavailable for this track.');
    return;
  }

  setMiniPlayerControlState('loading');
  beginMiniPlayerPlayback();
}

async function beginMiniPlayerPlayback() {
  const remoteTrackId = state.miniPlayerTrackSourceId;
  if (!remoteTrackId) {
    setMiniPlayerControlState('idle');
    return;
  }

  stopMiniPlayerAudio({ silent: true });

  const requestId = Symbol('mini-player');
  state.miniPlayerRequestId = requestId;

  const controller = new AbortController();
  state.miniPlayerAbortController = controller;
  state.isMiniPlayerLoading = true;

  const label = state.miniPlayerLabel?.textContent || 'track';
  setStatus(`Fetching preview for ${label}...`);

  try {
    const requestUrl = new URL('https://eu.qqdl.site/api/download-music');
    requestUrl.searchParams.set('track_id', remoteTrackId);
    requestUrl.searchParams.set('quality', '27');

    const response = await fetch(requestUrl.toString(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const streamUrl = payload?.data?.url || payload?.url;
    if (!streamUrl) {
      throw new Error('Playable URL missing.');
    }

    if (state.miniPlayerRequestId !== requestId || controller.signal.aborted) {
      return;
    }

    const audio = new Audio(streamUrl);
    audio.crossOrigin = 'anonymous';
    audio.addEventListener('timeupdate', updateMiniPlayerProgress);
    audio.addEventListener('loadedmetadata', updateMiniPlayerMetadata);
    audio.addEventListener('ended', handleMiniPlayerEnded);
    audio.addEventListener('pause', handleMiniPlayerPaused);

    state.miniPlayerAudio = audio;
    state.miniPlayerAbortController = null;

    try {
      await audio.play();
    } catch (error) {
      audio.removeEventListener('timeupdate', updateMiniPlayerProgress);
      audio.removeEventListener('loadedmetadata', updateMiniPlayerMetadata);
      audio.removeEventListener('ended', handleMiniPlayerEnded);
      audio.removeEventListener('pause', handleMiniPlayerPaused);
      state.miniPlayerAudio = null;
      throw error;
    }

    if (state.miniPlayerRequestId !== requestId) {
      return;
    }

    state.isMiniPlayerLoading = false;
    state.miniPlayerRequestId = null;

    if (state.miniPlayerProgress) {
      state.miniPlayerProgress.disabled = false;
      if (!Number.isNaN(audio.duration) && audio.duration > 0) {
        state.miniPlayerProgress.max = String(audio.duration);
      }
    }
    if (state.miniPlayerDuration && !Number.isNaN(audio.duration) && audio.duration > 0) {
      state.miniPlayerDuration.textContent = formatTime(audio.duration);
    }

    setMiniPlayerControlState('playing');
    setStatus(`Playing preview for ${label}.`);
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }
    console.error('Unable to start mini player preview', error);
    state.isMiniPlayerLoading = false;
    setMiniPlayerControlState('idle');
    const currentLabel = state.miniPlayerLabel?.textContent || 'track';
    setStatus(`Unable to play preview for ${currentLabel}.`);
  } finally {
    if (state.miniPlayerAbortController === controller) {
      state.miniPlayerAbortController = null;
    }
    if (state.miniPlayerRequestId === requestId) {
      state.miniPlayerRequestId = null;
      state.isMiniPlayerLoading = false;
    }
  }
}

function updateMiniPlayerMetadata() {
  const audio = state.miniPlayerAudio;
  if (!audio || Number.isNaN(audio.duration)) {
    return;
  }
  if (state.miniPlayerProgress) {
    state.miniPlayerProgress.max = String(audio.duration);
    state.miniPlayerProgress.disabled = false;
  }
  if (state.miniPlayerDuration) {
    state.miniPlayerDuration.textContent = formatTime(audio.duration);
  }
}

function updateMiniPlayerProgress() {
  const audio = state.miniPlayerAudio;
  if (!audio) {
    return;
  }

  const current = audio.currentTime || 0;
  if (!Number.isNaN(current)) {
    if (state.miniPlayerProgress) {
      state.miniPlayerProgress.value = String(current);
    }
    if (state.miniPlayerCurrentTime) {
      state.miniPlayerCurrentTime.textContent = formatTime(current);
    }
  }
}

function handleMiniPlayerSeek(event) {
  const audio = state.miniPlayerAudio;
  if (!audio || Number.isNaN(audio.duration) || audio.duration <= 0) {
    event.target.value = '0';
    return;
  }
  const nextTime = Number(event.target.value);
  if (!Number.isNaN(nextTime)) {
    audio.currentTime = nextTime;
    if (state.miniPlayerCurrentTime) {
      state.miniPlayerCurrentTime.textContent = formatTime(nextTime);
    }
  }
}

function handleMiniPlayerEnded() {
  const label = state.miniPlayerLabel?.textContent || 'track';
  stopMiniPlayerAudio({ silent: true });
  setMiniPlayerControlState('idle');
  setStatus(`Preview finished for ${label}.`);
}

function handleMiniPlayerPaused() {
  // No-op: playback lifecycle is managed by the control button.
}

function stopMiniPlayerAudio({ silent = false } = {}) {
  if (state.miniPlayerAbortController) {
    try {
      state.miniPlayerAbortController.abort();
    } catch (error) {
      console.warn('Unable to abort mini player request.', error);
    }
  }
  state.miniPlayerAbortController = null;
  state.miniPlayerRequestId = null;
  state.isMiniPlayerLoading = false;

  const audio = state.miniPlayerAudio;
  if (audio) {
    audio.removeEventListener('timeupdate', updateMiniPlayerProgress);
    audio.removeEventListener('loadedmetadata', updateMiniPlayerMetadata);
    audio.removeEventListener('ended', handleMiniPlayerEnded);
    audio.removeEventListener('pause', handleMiniPlayerPaused);
    try {
      audio.pause();
    } catch (error) {
      console.warn('Unable to pause mini player audio.', error);
    }
    audio.src = '';
  }
  state.miniPlayerAudio = null;

  resetMiniPlayerProgress();
  setMiniPlayerControlState('idle');

  if (!silent) {
    const label = state.miniPlayerLabel?.textContent || 'track';
    setStatus(`Preview paused for ${label}.`);
  }
}

function resetMiniPlayerProgress() {
  if (state.miniPlayerProgress) {
    state.miniPlayerProgress.value = '0';
    state.miniPlayerProgress.max = '0';
    state.miniPlayerProgress.disabled = true;
  }
  if (state.miniPlayerCurrentTime) {
    state.miniPlayerCurrentTime.textContent = '0:00';
  }
  if (state.miniPlayerDuration) {
    state.miniPlayerDuration.textContent = '--:--';
  }
}

function closeMiniPlayer() {
  stopMiniPlayerAudio({ silent: true });
  clearActiveTrackButton();
  state.miniPlayerIsOpen = false;
  state.miniPlayerTrackSourceId = null;
  state.miniPlayerTrack = null;
  state.miniPlayerRemoteTrack = null;
  if (state.miniPlayer) {
    state.miniPlayer.classList.remove('is-visible');
  }
}

function formatTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '--:--';
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}


function buildTrackPayload(track, playlist) {
  return {
    artist: track?.artist || "Unknown Artist",
    title: track?.track || "Untitled Track",
    spotify_id: track?.spotifyId || "",
    playlist: playlist || "",
  };
}

function formatTrackLabel(artist, title) {
  const safeArtist = artist || "Unknown Artist";
  const safeTitle = title || "Untitled Track";
  return `${safeArtist} - ${safeTitle}`;
}
function formatRemoteTrackLabel(performer, title) {
  const safePerformer = performer || 'Unknown performer';
  const safeTitle = title || 'Unknown title';
  return `${safePerformer} - ${safeTitle}`;
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
      scrollToGrid();
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
      scrollToGrid();
    }
  });

  fragment.append(prevButton, indicator, nextButton);
  elements.pagination.appendChild(fragment);
}

async function requestTracks({ force = false } = {}) {
  const apiUrl = new URL(API_URL, window.location.origin);
  if (force) {
    apiUrl.searchParams.set('force', '1');
  }

  try {
    const response = await fetch(apiUrl.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (response.ok) {
      return await response.json();
    }

    if (response.status !== 404) {
      const message = await response.text().catch(() => '');
      throw new Error(
        message
          ? `API responded with ${response.status}: ${message}`
          : `API responded with ${response.status}`
      );
    }
  } catch (error) {
    console.warn('Track API unavailable, falling back to source fetch.', error);
  }

  const fallbackUrl = DATA_SOURCE_URL + (force ? `?t=${Date.now()}` : '');
  const fallbackResponse = await fetch(fallbackUrl);
  if (!fallbackResponse.ok) {
    throw new Error(
      `Failed to load tracks: ${fallbackResponse.status} ${fallbackResponse.statusText}`
    );
  }
  return await fallbackResponse.json();
}


function initializeCheckedState() {
  state.checkedTracks = loadCheckedTracksFromStorage();
  state.showChecked = loadShowCheckedPreference();
}

function loadCheckedTracksFromStorage() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.checked);
    if (!raw) {
      return new Set();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed.map((value) => String(value)).filter((value) => value));
  } catch (error) {
    console.warn('Unable to read checked tracks from storage.', error);
    return new Set();
  }
}

function persistCheckedTracks() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }

  try {
    const serialised = JSON.stringify(Array.from(state.checkedTracks));
    window.localStorage.setItem(STORAGE_KEYS.checked, serialised);
  } catch (error) {
    console.warn('Unable to persist checked tracks.', error);
  }
}

function loadShowCheckedPreference() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.showChecked);
    if (raw == null) {
      return false;
    }
    const normalised = raw.toLowerCase();
    return normalised === 'true' || normalised === '1' || normalised === 'yes';
  } catch (error) {
    console.warn('Unable to read show-checked preference from storage.', error);
    return false;
  }
}

function persistShowCheckedPreference(value) {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEYS.showChecked, value ? 'true' : 'false');
  } catch (error) {
    console.warn('Unable to persist show-checked preference.', error);
  }
}

function isTrackChecked(trackId) {
  if (trackId == null) {
    return false;
  }
  return state.checkedTracks.has(String(trackId));
}

function setTrackChecked(trackId, checked) {
  if (trackId == null) {
    return;
  }

  const normalised = String(trackId);
  const alreadyChecked = state.checkedTracks.has(normalised);
  let changed = false;

  if (checked) {
    if (!alreadyChecked) {
      state.checkedTracks.add(normalised);
      changed = true;
    }
  } else if (alreadyChecked) {
    state.checkedTracks.delete(normalised);
    changed = true;
  }

  if (changed) {
    persistCheckedTracks();
    renderCards();
  }

  return changed;
}

function pruneCheckedTracks(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) {
    return;
  }

  const validIds = new Set(
    tracks
      .map((track) => (track ? track.id : null))
      .filter((id) => id != null)
      .map((id) => String(id))
  );
  let changed = false;

  state.checkedTracks.forEach((id) => {
    if (!validIds.has(id)) {
      state.checkedTracks.delete(id);
      changed = true;
    }
  });

  if (changed) {
    persistCheckedTracks();
  }
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

function scrollToGrid() {
  if (!elements.cardsContainer) return;
  const top = window.scrollY + elements.cardsContainer.getBoundingClientRect().top - 16;
  window.scrollTo({ top, behavior: 'smooth' });
}

function setStatus(message) {
  if (!elements.statusMessage) return;
  elements.statusMessage.textContent = message || '';
}

function toggleLoading(isLoading) {
  if (!elements.refreshButton) return;
  elements.refreshButton.disabled = isLoading;
  elements.refreshButton.innerHTML = isLoading ? '<i class="fa-solid fa-arrows-rotate"></i>' : '<i class="fa-solid fa-arrows-rotate"></i>';
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












