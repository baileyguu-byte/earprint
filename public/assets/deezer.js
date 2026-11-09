// Deezer's public API. It sends no CORS headers, so calls use JSONP (a script tag with a
// callback), which works from any web page without a key. Limit: about 50 calls per 5 seconds
// per visitor, so results are cached and typing is debounced by the caller.

const API = 'https://api.deezer.com';
let seq = 0;

function deezerError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** Raw JSONP call. Rejects with code 'blocked', 'timeout', 'quota' or 'api'. */
export function call(path, { timeout = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    const cb = '__dz' + (++seq) + '_' + Math.random().toString(36).slice(2, 8);
    const s = document.createElement('script');
    let done = false;
    const finish = (err, data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      s.remove();
      if (err) reject(err); else resolve(data);
    };
    const timer = setTimeout(() => finish(deezerError('Deezer did not respond in time.', 'timeout')), timeout);
    window[cb] = (data) => {
      if (data && data.error) {
        const quota = data.error.code === 4 || /quota/i.test(data.error.message || '');
        finish(deezerError(data.error.message || 'Deezer returned an error.', quota ? 'quota' : 'api'));
      } else finish(null, data);
    };
    s.onerror = () => finish(deezerError('Deezer could not be reached from this page.', 'blocked'));
    s.src = API + path + (path.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + cb;
    document.head.appendChild(s);
  });
}

const cache = new Map();
function cached(path, ttl) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = call(path).catch((e) => { cache.delete(path); throw e; });
  cache.set(path, { at: Date.now(), promise });
  return promise;
}
const enc = encodeURIComponent;
const MIN = 60 * 1000;

export const chartArtists = (limit = 10) => cached('/chart/0/artists?limit=' + limit, 10 * MIN).then((r) => r.data || []);
export const chartTracks = (limit = 10) => cached('/chart/0/tracks?limit=' + limit, 10 * MIN).then((r) => r.data || []);
export const genres = () => cached('/genre', 24 * 60 * MIN).then((r) => (r.data || []).filter((g) => g.id !== 0));
export const suggest = (q) => cached('/search/autocomplete?q=' + enc(q), 5 * MIN);
export const searchArtists = (q, limit = 10) => cached('/search/artist?q=' + enc(q) + '&limit=' + limit, 5 * MIN).then((r) => r.data || []);
export const searchTracks = (q, limit = 20) => cached('/search?q=' + enc(q) + '&limit=' + limit, 5 * MIN).then((r) => r.data || []);
export const artist = (id) => cached('/artist/' + id, 10 * MIN);
export const artistTop = (id, limit = 10) => cached('/artist/' + id + '/top?limit=' + limit, 10 * MIN).then((r) => r.data || []);
export const genreChart = (id, limit = 50) => cached('/chart/' + id + '/tracks?limit=' + limit, 10 * MIN).then((r) => r.data || []);
/** Always fresh: preview links expire after roughly 15 minutes. */
export const track = (id) => call('/track/' + id);

/** Deezer keeps duplicate profiles for some artists. Keep the one with the most fans, in the original order. */
export function dedupeArtists(list) {
  const best = new Map();
  for (const a of list) {
    const k = (a.name || '').trim().toLowerCase();
    const prev = best.get(k);
    if (!prev || (a.nb_fan || 0) > (prev.nb_fan || 0)) best.set(k, a);
  }
  return list.filter((a) => best.get((a.name || '').trim().toLowerCase()) === a);
}

// Used if the genre list can't be fetched. Same ids and names Deezer returned in November 2026.
export const FALLBACK_GENRES = [
  [132, 'Pop'], [116, 'Rap/Hip Hop'], [152, 'Rock'], [113, 'Dance'], [165, 'R&B'], [85, 'Alternative'],
  [106, 'Electro'], [466, 'Folk'], [144, 'Reggae'], [129, 'Jazz'], [98, 'Classical'], [173, 'Films/Games'],
  [464, 'Metal'], [169, 'Soul & Funk'], [2, 'African Music'], [16, 'Asian Music'], [153, 'Blues'],
  [75, 'Brazilian Music'], [81, 'Indian Music'], [95, 'Kids'], [197, 'Latin Music']
].map(([id, name]) => ({ id, name }));

const ALIASES = {
  116: ['hip hop', 'hip-hop', 'hiphop', 'rap', 'trap', 'drill'],
  113: ['dance', 'edm', 'house', 'techno', 'trance', 'drum and bass', 'dnb'],
  106: ['electronic', 'electro', 'synth', 'edm', 'ambient'],
  85: ['alternative', 'indie', 'alt', 'shoegaze', 'emo'],
  165: ['r&b', 'rnb', 'r and b'],
  169: ['soul', 'funk', 'disco', 'motown'],
  464: ['metal', 'heavy metal', 'metalcore', 'prog metal', 'progressive metal', 'death metal'],
  152: ['rock', 'punk', 'grunge', 'classic rock', 'hard rock'],
  132: ['pop', 'k-pop', 'kpop'],
  466: ['folk', 'acoustic', 'singer-songwriter', 'country'],
  129: ['jazz', 'swing', 'bebop'],
  98: ['classical', 'orchestra', 'orchestral', 'opera', 'piano'],
  173: ['film', 'films', 'games', 'game', 'soundtrack', 'score'],
  144: ['reggae', 'dub', 'dancehall'],
  153: ['blues'],
  197: ['latin', 'reggaeton', 'salsa'],
  75: ['brazilian', 'brazil', 'samba', 'bossa nova', 'mpb'],
  81: ['indian', 'bollywood'],
  2: ['african', 'afrobeats', 'afrobeat', 'amapiano'],
  16: ['asian', 'j-pop', 'jpop', 'c-pop', 'k-pop', 'kpop'],
  95: ['kids', 'children']
};

/** Genres whose name or common nicknames match the typed text. */
export function matchGenres(list, q) {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const scored = [];
  for (const g of list) {
    const names = [g.name.toLowerCase(), ...(ALIASES[g.id] || [])];
    let score = 0;
    for (const n of names) {
      if (n === s) score = Math.max(score, 3);
      else if (n.startsWith(s)) score = Math.max(score, 2);
      else if (n.includes(s) || (s.length >= 4 && s.includes(n))) score = Math.max(score, 1);
    }
    if (score) scored.push([score, g]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const top = scored.length ? scored[0][0] : 0;
  return scored.filter(([score]) => score >= Math.max(1, top - 1)).map(([, g]) => g);
}
