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
  activeTooltip: null,
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

  if (state.activeTooltip && !curatorTracks.some((item) => item.id === state.activeTooltip.trackId)) {
    closeActiveTooltip({ shouldResetButton: false });
  }

  if (state.lookupTrackId && !curatorTracks.some((item) => item.id === state.lookupTrackId)) {
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
  playButton.className = 'track-action-button';
  playButton.dataset.trackId = track.id;

  applyLookupButtonState(playButton, getLookupStateForTrack(track.id));

  playButton.addEventListener('click', () => {
    handlePlayButtonClick({ track, playButton });
  });

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'track-action-button';
  addButton.setAttribute('aria-label', 'Add track');
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

  addButton.addEventListener('click', () => {
    handleAddButtonClick({ track, addButton });
  });

  actions.append(playButton, addButton, statusButton);

  article.append(info, actions);

  return article;
}

function getLookupStateForTrack(trackId) {
  if (!trackId) {
    return 'idle';
  }
  if (state.lookupTrackId === trackId && state.isFetchingLookup) {
    return 'loading';
  }
  if (state.activeTooltip && state.activeTooltip.trackId === trackId) {
    return 'active';
  }
  return 'idle';
}

function applyLookupButtonState(button, stateValue) {
  if (!button) return;
  button.classList.remove('is-loading', 'is-active');
  button.disabled = false;
  button.setAttribute('aria-pressed', 'false');

  if (stateValue === 'loading') {
    button.classList.add('is-loading');
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    button.setAttribute('aria-label', 'Fetching track info');
    return;
  }

  if (stateValue === 'active') {
    button.classList.add('is-active');
    button.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i>';
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', 'Hide track info');
    return;
  }

  button.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i>';
  button.setAttribute('aria-label', 'Play track');
}

async function handlePlayButtonClick({ track, playButton }) {
  if (!track || !playButton) {
    return;
  }

  closeActiveTooltip();

  if (state.lookupAbortController) {
    try {
      state.lookupAbortController.abort();
    } catch (error) {
      console.warn('Unable to abort lookup request.', error);
    }
  }

  const requestId = Symbol('lookup-request');
  state.lookupRequestId = requestId;
  state.lookupTrackId = track.id;
  state.isFetchingLookup = true;
  state.lookupButton = playButton;

  const rawQuery = `${track.artist || ''} ${track.track || ''}`;
  const searchQuery = rawQuery.trim();
  const requestUrl = new URL('https://eu.qqdl.site/api/get-music');
  requestUrl.searchParams.set('q', searchQuery || rawQuery);
  requestUrl.searchParams.set('offset', '0');

  const controller = new AbortController();
  state.lookupAbortController = controller;

  applyLookupButtonState(playButton, 'loading');

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

    showTrackTooltip({
      playButton,
      trackId: track.id,
      performerName,
      trackTitle,
      isError: false,
    });
    applyLookupButtonState(playButton, 'active');
  } catch (error) {
    if (error.name === 'AbortError') {
      if (state.lookupButton !== playButton) {
        applyLookupButtonState(playButton, 'idle');
      }
      return;
    }

    console.error('Unable to fetch track information.', error);

    if (state.lookupRequestId !== requestId) {
      return;
    }

    showTrackTooltip({
      playButton,
      trackId: track.id,
      performerName: 'Lookup failed',
      trackTitle: error && error.message ? error.message : 'Unexpected error.',
      isError: true,
    });
    applyLookupButtonState(playButton, 'active');
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

function showTrackTooltip({ playButton, trackId, performerName, trackTitle, isError }) {
  closeActiveTooltip({ shouldResetButton: false });

  const tooltip = document.createElement('div');
  tooltip.className = 'track-tooltip';
  if (isError) {
    tooltip.classList.add('is-error');
  }
  tooltip.setAttribute('role', 'dialog');
  tooltip.setAttribute('aria-live', isError ? 'assertive' : 'polite');

  const content = document.createElement('div');
  content.className = 'track-tooltip-content';

  const displayLabel = [performerName, trackTitle].filter(Boolean).join(' - ') || 'Details unavailable';
  const label = document.createElement('span');
  label.className = 'track-tooltip-label';
  label.textContent = displayLabel;

  const tooltipPlayButton = document.createElement('button');
  tooltipPlayButton.type = 'button';
  tooltipPlayButton.className = 'track-action-button track-tooltip-play';
  tooltipPlayButton.innerHTML = '<i class="fa-solid fa-play"></i>';
  tooltipPlayButton.setAttribute('aria-label', 'Play track');
  tooltipPlayButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  content.append(label, tooltipPlayButton);

  tooltip.style.position = 'absolute';
  tooltip.style.visibility = 'hidden';

  tooltip.append(content);
  document.body.appendChild(tooltip);

  const reposition = () => positionTooltip(tooltip, playButton);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      closeActiveTooltip();
    }
  };
  const handleDocumentPointer = (event) => {
    if (tooltip.contains(event.target)) {
      return;
    }
    if (playButton.contains(event.target)) {
      return;
    }
    closeActiveTooltip();
  };
  document.addEventListener('keydown', handleEscape);
  document.addEventListener('pointerdown', handleDocumentPointer);

  reposition();
  tooltip.style.visibility = 'visible';

  state.activeTooltip = {
    element: tooltip,
    triggerButton: playButton,
    trackId,
    cleanup: () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('pointerdown', handleDocumentPointer);
    },
  };
}


function positionTooltip(tooltip, playButton) {
  if (!tooltip || !playButton) {
    return;
  }

  const buttonRect = playButton.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft || 0;

  let top = buttonRect.top + scrollTop - tooltipRect.height - 12;
  if (top < scrollTop + 8) {
    top = buttonRect.bottom + scrollTop + 12;
  }

  let left = buttonRect.left + scrollLeft + buttonRect.width / 2 - tooltipRect.width / 2;
  const minLeft = scrollLeft + 12;
  const maxLeft = scrollLeft + window.innerWidth - tooltipRect.width - 12;
  left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));

  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.style.left = `${Math.round(left)}px`;
}

function closeActiveTooltip({ shouldResetButton = true } = {}) {
  const active = state.activeTooltip;
  if (!active) {
    return;
  }

  if (typeof active.cleanup === 'function') {
    try {
      active.cleanup();
    } catch (error) {
      console.warn('Unable to clean up tooltip listeners.', error);
    }
  }

  if (active.element && active.element.parentNode) {
    active.element.parentNode.removeChild(active.element);
  }

  if (shouldResetButton && active.triggerButton && active.triggerButton.isConnected) {
    applyLookupButtonState(active.triggerButton, 'idle');
  }

  state.activeTooltip = null;
}

async function handleAddButtonClick({ track, addButton }) {
  if (!track || !addButton) return;

  const payload = buildTrackPayload(track);
  const label = formatTrackLabel(payload.artist, payload.title);
  const trackId = track.id;

  try {
    addButton.disabled = true;
    addButton.classList.add('is-busy');
    addButton.setAttribute('aria-busy', 'true');
    setStatus(`Adding ${label} to the radio queue...`);

    await postTrackToWebhook(payload);

    const changed = setTrackChecked(trackId, true);
    setStatus(
      `${label} sent to the radio queue ${changed ? 'and marked as checked.' : 'and was already checked.'}`
    );
  } catch (error) {
    console.error(error);
    setStatus(`Unable to add ${label}. Please try again.`);
  } finally {
    if (state.showChecked || !isTrackChecked(trackId)) {
      addButton.disabled = false;
    }
    addButton.classList.remove('is-busy');
    addButton.removeAttribute('aria-busy');
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

function buildTrackPayload(track) {
  return {
    artist: track?.artist || "Unknown Artist",
    title: track?.track || "Untitled Track",
    spotify_id: track?.spotifyId || "",
  };
}

function formatTrackLabel(artist, title) {
  const safeArtist = artist || "Unknown Artist";
  const safeTitle = title || "Untitled Track";
  return `${safeArtist} - ${safeTitle}`;
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
  elements.refreshButton.textContent = isLoading ? 'IN PROGRESS' : 'REFRESH';
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

