const ALBUM_DATA_URL = 'https://opensheet.elk.sh/1LOx-C1USXeC92Mtv0u6NizEvcTMWkKJNGiNTwAtSj3E/2';
const ALBUM_HIDE_WEBHOOK_URL = 'https://n8n.niprobin.com/webhook/album-done';

const albumState = {
  albums: [],
};

const albumElements = {
  grid: null,
  status: null,
};

const releaseDateFormatter = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

document.addEventListener('DOMContentLoaded', () => {
  albumElements.grid = document.querySelector('#albumGrid');
  albumElements.status = document.querySelector('#albumsStatus');

  if (!albumElements.grid || !albumElements.status) {
    console.error('Albums page is missing required containers.');
    return;
  }

  bindAlbumGridEvents();
  hydrateAlbumsPage();
});

function bindAlbumGridEvents() {
  albumElements.grid.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) {
      return;
    }

    if (button.classList.contains('album-card__hide-button')) {
      if (button.hasAttribute('aria-busy')) {
        return;
      }

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

      handleAlbumPlay(button);
    }
  });
}

async function hydrateAlbumsPage() {
  setAlbumsStatus('Loading albums...');

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
    if (albumState.albums.length === 0) {
      setAlbumsStatus('No recent releases to display.');
    } else {
      setAlbumsStatus('');
    }
  } catch (error) {
    console.error(error);
    setAlbumsStatus('We could not load albums. Please try again later.');
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

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'album-card__play-button';
  playButton.innerHTML = '<i class="fa-solid fa-play"></i>';
  playButton.dataset.releaseName = album.releaseName;
  playButton.setAttribute('aria-label', `Open ${album.releaseName} on YAMS`);
  actions.appendChild(playButton);

  const hideButton = document.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'album-card__hide-button';
  hideButton.innerHTML = '<i class="fa-solid fa-check"></i>';
  hideButton.dataset.releaseName = album.releaseName;
  applyHideButtonState(hideButton, Boolean(album.isHidden));

  actions.appendChild(hideButton);

  card.append(cover, body, actions);
  return card;
}

async function toggleAlbumHidden(albumId, button) {
  const album = albumState.albums.find((item) => item.id === albumId);
  if (!album) {
    return;
  }

  const currentState = Boolean(album.isHidden);
  const nextState = !currentState;

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  applyHideButtonState(button, nextState);
  setAlbumsStatus(nextState ? `Marking ${album.releaseName} as hidden...` : `Making ${album.releaseName} visible...`);

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
    setAlbumsStatus(nextState ? `${album.releaseName} is now hidden.` : `${album.releaseName} is visible again.`);
  } catch (error) {
    console.error(error);
    applyHideButtonState(button, currentState);
    setAlbumsStatus('We could not update the album. Please try again.');
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

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  setAlbumsStatus(`Looking up ${releaseName}...`);

  try {
    const url = new URL('https://api.yams.tf/search');
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

    const albumUrl = `https://www.yams.tf/#/album/2/${albumId}`;
    window.open(albumUrl, '_blank', 'noopener');
    setAlbumsStatus(`Opening ${releaseName} on YAMS...`);
  } catch (error) {
    console.error(error);
    setAlbumsStatus(`We couldn't locate a YAMS album for ${releaseName}.`);
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
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

function setAlbumsStatus(message) {
  if (!albumElements.status) return;
  albumElements.status.textContent = message;
  albumElements.status.style.display = message ? 'block' : 'none';
}