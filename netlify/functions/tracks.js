const DATA_SOURCE_URL = 'https://opensheet.elk.sh/19q7ac_1HikdJK_mAoItd65khDHi0pNCR8PrdIcR6Fhc/all_tracks';
const CACHE_KEY = 'tracks-cache-v1';
const CACHE_TTL_SECONDS = 300;
const MEMORY_CACHE_MS = CACHE_TTL_SECONDS * 1000;
const USER_AGENT = 'curated-digging/1.0 (+https://curated-digging.netlify.app)';

let memoryCache = { body: null, expiresAt: 0 };

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60',
  'Access-Control-Allow-Origin': '*',
};

exports.handler = async (event, context) => {
  const force = shouldForceRefresh(event);

  if (!force) {
    const cached = await readCache(context);
    if (cached) {
      return respond(200, cached, 'HIT');
    }
  }

  const fetchResult = await fetchTracksFromSource();

  if (fetchResult.error) {
    const cached = await readCache(context);
    if (cached) {
      return respond(200, cached, 'STALE');
    }

    return respond(
      fetchResult.statusCode,
      JSON.stringify({ error: fetchResult.message }),
      'ERROR',
      { cacheControl: 'no-store' }
    );
  }

  await writeCache(context, fetchResult.body);

  return respond(200, fetchResult.body, force ? 'REFRESH' : 'MISS');
};

function shouldForceRefresh(event) {
  const value = event?.queryStringParameters?.force;
  if (!value) return false;
  const normalized = String(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

async function readCache(context) {
  if (context?.cache && typeof context.cache.get === 'function') {
    try {
      const cached = await context.cache.get(CACHE_KEY);
      if (cached) {
        return cached;
      }
    } catch (error) {
      console.warn('Failed to read from Netlify cache, falling back to memory cache.', error);
    }
  }

  if (memoryCache.body && memoryCache.expiresAt > Date.now()) {
    return memoryCache.body;
  }

  return null;
}

async function writeCache(context, body) {
  memoryCache = {
    body,
    expiresAt: Date.now() + MEMORY_CACHE_MS,
  };

  if (context?.cache && typeof context.cache.set === 'function') {
    try {
      await context.cache.set(CACHE_KEY, body, { ttl: CACHE_TTL_SECONDS });
    } catch (error) {
      console.warn('Failed to write to Netlify cache, retaining memory cache only.', error);
    }
  }
}

async function fetchTracksFromSource() {
  try {
    const response = await fetch(DATA_SOURCE_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      return {
        error: true,
        statusCode: response.status,
        message: `Upstream source responded with ${response.status}`,
      };
    }

    const text = await response.text();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return {
        error: true,
        statusCode: 502,
        message: 'Upstream returned invalid JSON.',
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        error: true,
        statusCode: 502,
        message: 'Upstream payload was not an array of tracks.',
      };
    }

    return { error: false, body: text };
  } catch (error) {
    return {
      error: true,
      statusCode: 502,
      message: `Failed to reach upstream source: ${error.message}`,
    };
  }
}

function respond(statusCode, body, cacheState, options = {}) {
  const headers = {
    ...DEFAULT_HEADERS,
    ...(options.cacheControl ? { 'Cache-Control': options.cacheControl } : {}),
    ...(options.headers || {}),
  };
  headers['X-Cache'] = cacheState;

  return {
    statusCode,
    headers,
    body,
  };
}
