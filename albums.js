const ALBUM_DATA_URL = 'https://opensheet.elk.sh/1LOx-C1USXeC92Mtv0u6NizEvcTMWkKJNGiNTwAtSj3E/2';
const ALBUM_HIDE_WEBHOOK_URL = 'https://n8n.niprobin.com/webhook/album-done';
const ALBUM_ADD_WEBHOOK_URL = 'https://n8n.niprobin.com/webhook/add-album';
const ALBUM_LISTEN_WEBHOOK_URL = 'https://n8n.niprobin.com/webhook/listen-to-album';
const YAMS_SEARCH_URL = 'https://api.yams.tf/search';
const TIDAL_SEARCH_URL = 'https://tidal-api-2.binimum.org/search/';
const TIDAL_SEARCH_TOKEN = '1759763452~YWE4MWM4OGU1MmI3YzI5MmFkODFlN2JiZmNhZGI4ZDExODBhNTI4MA==';
const TIDAL_ALBUM_URL_BASE = 'https://music.binimum.org/album/';
const YAMS_ALBUM_URL_BASE = 'https://yams.tf/#/album/2/';


const albumState = {
  albums: [],
  activeRatingMenu: null,
  activeAddButton: null,
};

const albumElements = {
  grid: null,
  listenForm: null,
  listenInput: null,
  listenButton: null,
};

const releaseDateFormatter = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

document.addEventListener('DOMContentLoaded', () => {
  albumElements.grid = document.querySelector('#albumGrid');

  if (!albumElements.grid) {
    let main = document.querySelector('main');

    if (!main) {
      main = document.createElement('main');
      main.classList.add('container');
      const appShell = document.querySelector('.app-shell');
      if (appShell) {
        appShell.appendChild(main);
      } else {
        document.body.appendChild(main);
      }
    }

    if (main && !main.querySelector('#albumGrid')) {
      const fallbackGrid = document.createElement('section');
      fallbackGrid.id = 'albumGrid';
      fallbackGrid.className = 'album-grid';
      fallbackGrid.setAttribute('aria-live', 'polite');
      fallbackGrid.setAttribute('aria-label', 'Album results');
      main.appendChild(fallbackGrid);
    }

    albumElements.grid = document.querySelector('#albumGrid');
  }

  albumElements.listenForm = document.querySelector('#albumListenForm');
  albumElements.listenInput = document.querySelector('#albumListenInput');
  albumElements.listenButton = document.querySelector('#albumListenSubmit');

  if (!albumElements.grid) {
    console.error('Albums page is missing required containers.');
    return;
  }
  bindAlbumGridEvents();
  bindAlbumListenForm();
  document.addEventListener('mousedown', handleGlobalPointerDown);
  document.addEventListener('keydown', handleGlobalKeydown);
  hydrateAlbumsPage();
});



function bindAlbumGridEvents() {
  albumElements.grid.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) {
      return;
    }

    if (button.classList.contains('album-card__rating-option')) {
      event.preventDefault();
      handleAlbumRatingSelection(button);
      return;
    }

    if (button.classList.contains('album-card__add-button')) {
      event.preventDefault();
      handleAddButton(button);
      return;
    }

    if (button.classList.contains('album-card__hide-button')) {
      if (button.hasAttribute('aria-busy')) {
        return;
      }

      closeActiveRatingMenu();

      const card = button.closest('.album-card');
      if (!card) {
        return;
      }

      const albumId = card.getAttribute('data-album-id');
      if (!albumId) {
        return;
      }

      toggleAlbumHidden(albumId, button);
      return;
    }

    if (button.classList.contains('album-card__play-button')) {
      if (button.hasAttribute('aria-busy')) {
        return;
      }

      closeActiveRatingMenu();
      handleAlbumPlay(button);
    }
  });
}

function bindAlbumListenForm() {
  const { listenForm, listenInput } = albumElements;
  if (!listenForm || !listenInput) {
    return;
  }

  listenForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (listenForm.dataset.submitting === 'true') {
      return;
    }

    const albumName = listenInput.value.trim();
    if (!albumName) {
      listenInput.focus();
      return;
    }

    listenForm.dataset.submitting = 'true';
    const submitButton = albumElements.listenButton || listenForm.querySelector("button[type='submit']");
    if (submitButton && !submitButton.dataset.defaultLabel) {
      submitButton.dataset.defaultLabel = submitButton.textContent ? submitButton.textContent.trim() : 'Send';
    }
    if (submitButton) {
      albumElements.listenButton = submitButton;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = 'Sending...';
    }

    try {
      const response = await fetch(ALBUM_LISTEN_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ album_name: albumName }),
      });

      if (!response.ok) {
        throw new Error(`Album listen webhook responded with ${response.status}`);
      }

      listenInput.value = '';
      if (submitButton) {
        submitButton.textContent = 'Sent!';
      }
    } catch (error) {
      console.error(error);
      if (submitButton) {
        submitButton.textContent = 'Try again';
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        const defaultLabel = submitButton.dataset.defaultLabel || 'Send';
        window.setTimeout(() => {
          submitButton.textContent = defaultLabel;
        }, 1600);
      }
      listenForm.removeAttribute('data-submitting');
    }
  });
}

async function hydrateAlbumsPage() {

  try {
    const response = await fetch(ALBUM_DATA_URL, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to fetch albums: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error('Unexpected response format for albums.');
    }

    albumState.albums = normalizeAlbums(payload);
    renderAlbumGrid(albumState.albums);
  } catch (error) {
    console.error(error);
  }
}

function normalizeAlbums(records) {
  return records
    .map((record, index) => buildAlbumRecord(record, index))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.releaseDateValue === b.releaseDateValue) {
        return a.releaseName.localeCompare(b.releaseName);
      }
      return b.releaseDateValue - a.releaseDateValue;
    });
}

function buildAlbumRecord(record, index) {
  if (!record) return null;

  const hideValue = (record.hide ?? '').toString().trim().toLowerCase();
  if (hideValue === 'true') {
    return null;
  }

  const releaseName = (record.release_name || '').toString().trim();
  const coverUrl = (record.cover_url || '').toString().trim();
  const spotifyUrl = (record.spotify_url || '').toString().trim();
  const releaseDateRaw = (record.release_date || '').toString().trim();
  const addedDateRaw = (record.added_date || '').toString().trim();
  const releaseDate = parseReleaseDate(releaseDateRaw);

  return {
    id: spotifyUrl || `album-${index}`,
    releaseName: releaseName || 'Unknown release',
    coverUrl,
    spotifyUrl,
    releaseDate,
    releaseDateRaw,
    addedDateRaw,
    releaseDateValue: releaseDate ? releaseDate.getTime() : Number.NEGATIVE_INFINITY,
    releaseDateFormatted: releaseDate ? releaseDateFormatter.format(releaseDate) : 'Date TBC',
    isHidden: false,
  };
}

function parseReleaseDate(value) {
  if (!value) return null;

  const cleanedValue = value.trim();
  if (!cleanedValue) return null;

  const isoMatch = cleanedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [_, year, month, day] = isoMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const dmyMatch = cleanedValue.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmyMatch) {
    const [_, day, month, year] = dmyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(cleanedValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function renderAlbumGrid(albums) {
  closeActiveRatingMenu();
  albumElements.grid.innerHTML = '';

  if (!albums.length) {
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const album of albums) {
    fragment.appendChild(createAlbumCard(album));
  }

  albumElements.grid.appendChild(fragment);
}

function createAlbumCard(album) {
  const card = document.createElement('article');
  card.className = 'album-card';
  card.setAttribute('data-album-id', album.id);
  card.setAttribute('data-hidden', String(Boolean(album.isHidden)));

  const cover = document.createElement('div');
  cover.className = 'album-card__cover';
  cover.setAttribute('aria-hidden', 'true');

  if (album.coverUrl) {
    const img = document.createElement('img');
    img.src = album.coverUrl;
    img.alt = `${album.releaseName} cover art`;
    img.className = 'album-card__cover-image';
    cover.appendChild(img);
  } else {
    const coverLabel = document.createElement('span');
    coverLabel.className = 'album-card__cover-label';
    coverLabel.textContent = 'Artwork coming soon';
    cover.appendChild(coverLabel);
  }

  const body = document.createElement('div');
  body.className = 'album-card__body';

  const release = document.createElement('h3');
  release.className = 'album-card__title';
  release.textContent = album.releaseName;

  const date = document.createElement('p');
  date.className = 'album-card__date';

  if (album.releaseDate) {
    const time = document.createElement('time');
    time.dateTime = album.releaseDateRaw || album.releaseDate.toISOString().split('T')[0];
    time.textContent = album.releaseDateFormatted;
    date.append('Released on ', time);
  } else {
    date.textContent = 'Release date: TBD';
  }

  body.append(release, date);

  const actions = document.createElement('div');
  actions.className = 'album-card__actions';

  const addWrapper = document.createElement('div');
  addWrapper.className = 'album-card__add';

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'album-card__add-button';
  addButton.innerHTML = '<i class="fa-solid fa-plus"></i>';
  addButton.dataset.releaseName = album.releaseName;
  addButton.setAttribute('aria-label', `Add ${album.releaseName} to albums shortlist`);
  addButton.setAttribute('aria-expanded', 'false');
  addButton.setAttribute('aria-haspopup', 'true');
  addWrapper.appendChild(addButton);

  const ratingMenu = document.createElement('div');
  ratingMenu.className = 'album-card__rating-menu';
  ratingMenu.hidden = true;
  ratingMenu.setAttribute('aria-hidden', 'true');
  ratingMenu.setAttribute('role', 'menu');
  ratingMenu.setAttribute('aria-label', `Select a rating for ${album.releaseName}`);

  for (let rating = 3; rating <= 5; rating += 1) {
    const ratingButton = document.createElement('button');
    ratingButton.type = 'button';
    ratingButton.className = 'album-card__rating-option';
    ratingButton.dataset.rating = String(rating);
    ratingButton.setAttribute('role', 'menuitem');
    ratingButton.dataset.releaseName = album.releaseName;
    ratingButton.innerHTML = `${rating} <i class=\"fa-solid fa-star\"></i>`;
    ratingButton.setAttribute('aria-label', `Rate ${album.releaseName} ${rating} out of 5`);
    ratingMenu.appendChild(ratingButton);
  }

  addWrapper.appendChild(ratingMenu);
  actions.appendChild(addWrapper);

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'album-card__play-button';
  playButton.innerHTML = '<i class="fa-solid fa-play"></i>';
  playButton.dataset.releaseName = album.releaseName;
  playButton.setAttribute('aria-label', `Find streaming links for ${album.releaseName}`);
  actions.appendChild(playButton);

  const hideButton = document.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'album-card__hide-button';
  hideButton.innerHTML = '<i class="fa-solid fa-check"></i>';
  hideButton.dataset.releaseName = album.releaseName;
  applyHideButtonState(hideButton, Boolean(album.isHidden));

  actions.appendChild(hideButton);

  const playLinks = document.createElement('div');
  playLinks.className = 'album-card__play-links';
  playLinks.hidden = true;
  playLinks.setAttribute('aria-live', 'polite');
  playLinks.setAttribute('role', 'status');

  card.append(cover, body, actions, playLinks);
  return card;
}

function handleAddButton(button) {
  const wrapper = button.closest('.album-card__add');
  if (!wrapper) {
    return;
  }

  const menu = wrapper.querySelector('.album-card__rating-menu');
  if (!menu) {
    return;
  }

  const isExpanded = button.getAttribute('aria-expanded') === 'true';

  if (isExpanded) {
    closeRatingMenu(menu, button);
    return;
  }

  closeActiveRatingMenu();
  openRatingMenu(menu, button);
}

async function handleAlbumRatingSelection(button) {
  const ratingValue = Number(button.dataset.rating);
  if (!ratingValue || Number.isNaN(ratingValue)) {
    return;
  }

  const wrapper = button.closest('.album-card__add');
  const card = button.closest('.album-card');
  if (!wrapper || !card) {
    return;
  }

  const addButton = wrapper.querySelector('.album-card__add-button');
  if (!addButton) {
    return;
  }

  const releaseName = (addButton.dataset.releaseName || '').trim();
  if (!releaseName) {
    console.warn('Missing release name for album add.');
    return;
  }

  const albumId = card.getAttribute('data-album-id');
  const hideButton = card.querySelector('.album-card__hide-button');

  closeActiveRatingMenu();

  addButton.disabled = true;
  addButton.setAttribute('aria-busy', 'true');

  try {
    await postAlbumAdd({ releaseName, rating: ratingValue });

    if (albumId && hideButton) {
      await setAlbumHiddenState(albumId, hideButton, true);
    }

  } catch (error) {
    console.error(error);
  } finally {
    addButton.disabled = false;
    addButton.removeAttribute('aria-busy');
  }
}

function openRatingMenu(menu, button) {
  if (!menu) return;
  menu.hidden = false;
  menu.setAttribute('aria-hidden', 'false');
  button.setAttribute('aria-expanded', 'true');
  albumState.activeRatingMenu = menu;
  albumState.activeAddButton = button;
}

function closeRatingMenu(menu, button) {
  if (!menu) return;
  menu.hidden = true;
  menu.setAttribute('aria-hidden', 'true');
  if (button) {
    button.setAttribute('aria-expanded', 'false');
  }
  if (albumState.activeRatingMenu === menu) {
    albumState.activeRatingMenu = null;
    albumState.activeAddButton = null;
  }
}

function closeActiveRatingMenu() {
  if (!albumState.activeRatingMenu) {
    return;
  }
  closeRatingMenu(albumState.activeRatingMenu, albumState.activeAddButton);
}

function handleGlobalPointerDown(event) {
  if (!albumState.activeRatingMenu) {
    return;
  }

  const menu = albumState.activeRatingMenu;
  const button = albumState.activeAddButton;

  if (menu.contains(event.target)) {
    return;
  }

  if (button && button.contains(event.target)) {
    return;
  }

  closeActiveRatingMenu();
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') {
    closeActiveRatingMenu();
  }
}

async function toggleAlbumHidden(albumId, button) {
  await setAlbumHiddenState(albumId, button);
}

async function setAlbumHiddenState(albumId, button, desiredState = null) {
  const album = albumState.albums.find((item) => item.id === albumId);
  if (!album) {
    return null;
  }

  const currentState = Boolean(album.isHidden);
  const nextState = desiredState === null ? !currentState : Boolean(desiredState);

  if (desiredState !== null && nextState === currentState) {
    return currentState;
  }

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  applyHideButtonState(button, nextState);

  try {
    await postAlbumHideState({
      releaseName: album.releaseName,
      hidden: nextState,
    });

    album.isHidden = nextState;
    const card = button.closest('.album-card');
    if (card) {
      card.setAttribute('data-hidden', String(nextState));
    }
    return nextState;
  } catch (error) {
    console.error(error);
    applyHideButtonState(button, currentState);
    throw error;
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

async function handleAlbumPlay(button) {
  const releaseName = (button.dataset.releaseName || '').trim();
  if (!releaseName) {
    console.warn('Missing release name for play lookup.');
    return;
  }

  const card = button.closest('.album-card');
  const linksContainer = card ? card.querySelector('.album-card__play-links') : null;
  if (linksContainer) {
    linksContainer.hidden = true;
    linksContainer.innerHTML = '';
  }

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');

  try {
    const results = await Promise.allSettled([
      lookupYamsAlbum(releaseName),
      lookupTidalAlbum(releaseName),
    ]);

    const links = [];
    const failedProviders = [];

    results.forEach((result, index) => {
      const provider = index === 0 ? 'yams' : 'tidal';
      if (result.status === 'fulfilled') {
        links.push(result.value);
      } else {
        const reason = result.status === 'rejected' ? result.reason : new Error(`Unknown ${provider} error`);
        console.error(reason);
        failedProviders.push(provider);
      }
    });

    if (linksContainer) {
      const fragment = document.createDocumentFragment();

      if (links.length) {
        const heading = document.createElement('p');
        heading.className = 'album-card__play-links-heading';
        heading.textContent = 'Available links';
        fragment.appendChild(heading);

        const list = document.createElement('ul');
        list.className = 'album-card__play-links-list';

        links.forEach((link) => {
          const item = document.createElement('li');
          item.className = 'album-card__play-links-item';

          const anchor = document.createElement('a');
          anchor.className = 'album-card__play-link';
          anchor.href = link.url;
          anchor.target = '_blank';
          anchor.rel = 'noopener';
          anchor.textContent = link.label;

          item.appendChild(anchor);
          list.appendChild(item);
        });

        fragment.appendChild(list);
      }

      if (failedProviders.length) {
        const providerLabels = failedProviders.map((provider) => (provider === 'yams' ? 'YAMS' : 'Binimum Music'));
        const note = document.createElement('p');
        note.className = 'album-card__play-links-note';
        note.textContent = providerLabels.length === 1
          ? `Could not find a link on ${providerLabels[0]}.`
          : `Could not find links on ${providerLabels.join(' and ')}.`;
        fragment.appendChild(note);
      }

      if (!links.length && !failedProviders.length) {
        const note = document.createElement('p');
        note.className = 'album-card__play-links-note';
        note.textContent = 'No streaming links available right now.';
        fragment.appendChild(note);
      }

      if (fragment.childNodes.length) {
        linksContainer.appendChild(fragment);
        linksContainer.hidden = false;
      } else {
        linksContainer.hidden = true;
      }
    }

  } catch (error) {
    console.error(error);
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

async function lookupYamsAlbum(releaseName) {
  const url = new URL(YAMS_SEARCH_URL);
  url.searchParams.set('query', releaseName);

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`YAMS lookup failed with ${response.status}`);
  }

  const payload = await response.json();
  const albumId = Array.isArray(payload?.albums) && payload.albums.length ? payload.albums[0]?.id : null;
  if (!albumId) {
    throw new Error('Album ID missing in YAMS response');
  }

  return {
    provider: 'yams',
    url: `${YAMS_ALBUM_URL_BASE}${albumId}`,
    label: 'Open on YAMS',
  };
}

async function lookupTidalAlbum(releaseName) {
  const url = new URL(TIDAL_SEARCH_URL);
  url.searchParams.set('al', releaseName);
  url.searchParams.set('token', TIDAL_SEARCH_TOKEN);

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Binimum lookup failed with ${response.status}`);
  }

  const payload = await response.json();
  const albumId = payload?.albums?.items?.[0]?.id || null;
  if (!albumId) {
    throw new Error('Album ID missing in Binimum response');
  }

  return {
    provider: 'tidal',
    url: `${TIDAL_ALBUM_URL_BASE}${albumId}`,
    label: 'Open on Binimum Music',
  };
}

async function postAlbumAdd({ releaseName, rating }) {
  const payload = {
    release_name: releaseName,
    rating: Number(rating),
  };

  const response = await fetch(ALBUM_ADD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Album add webhook responded with ${response.status}`);
  }
}

async function postAlbumHideState({ releaseName, hidden }) {
  const payload = {
    release_name: releaseName,
    hide: Boolean(hidden),
  };

  const response = await fetch(ALBUM_HIDE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Album webhook responded with ${response.status}`);
  }
}

function applyHideButtonState(button, hidden) {
  button.classList.toggle('is-hidden', hidden);
  button.setAttribute('aria-pressed', String(hidden));
  const releaseName = button.dataset.releaseName || 'this release';
  button.setAttribute('aria-label', hidden ? `Unhide ${releaseName}` : `Mark ${releaseName} as hidden`);
}


