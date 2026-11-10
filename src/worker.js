// Earprint's small server side. Everything else is static files in public/, served without
// running this code. This handles only:
//   POST /api/feedback   store a feedback message in D1 (binding DB)
//   GET  /robots.txt     let search engines in on earprint.xyz, keep them off preview links
// It stores no IP addresses: spam protection is a per-IP rate limit counted in memory by
// Cloudflare (binding FEEDBACK_LIMIT), a hidden honeypot field, a same-origin check and a daily cap.

const PRODUCTION = ['earprint.xyz', 'www.earprint.xyz'];
const KINDS = ['idea', 'bug', 'comment'];
const DAILY_CAP = 500;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
});
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');

async function feedback(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST') return json({ ok: false, error: 'Send feedback with the form on /feedback/.' }, 405);
  // Only the site's own pages may post (stops other sites posting on a visitor's behalf).
  const origin = request.headers.get('origin');
  if (!origin || new URL(origin).host !== url.host) return json({ ok: false, error: 'Feedback has to come from the Earprint site.' }, 403);
  if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ ok: false, error: 'Unexpected format.' }, 415);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (env.FEEDBACK_LIMIT) {
    const { success } = await env.FEEDBACK_LIMIT.limit({ key: 'feedback:' + ip });
    if (!success) return json({ ok: false, error: 'That’s a lot of feedback in a minute. Wait a moment and try again.' }, 429);
  }

  const raw = await request.text();
  if (raw.length > 16000) return json({ ok: false, error: 'That message is too long. Keep it under 4,000 characters.' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ ok: false, error: 'Unexpected format.' }, 400); }

  // Bots fill in every field, including the hidden one, and submit instantly.
  if (clean(body.website, 200) || !(Number(body.ms) >= 1500)) return json({ ok: true, id: 0 });

  const kind = KINDS.includes(body.kind) ? body.kind : 'comment';
  const message = clean(body.message, 4000);
  if (message.length < 3) return json({ ok: false, error: 'Write a few words first.' }, 400);
  const contact = clean(body.contact, 200) || null;
  const page = clean(body.page, 200) || null;
  let details = null;
  if (body.details && typeof body.details === 'object') {
    const d = JSON.stringify(body.details);
    if (d.length <= 3000) details = d;
  }

  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')").first();
  if (today && today.n >= DAILY_CAP) return json({ ok: false, error: 'Feedback is full for today. Please try again tomorrow.' }, 503);

  const r = await env.DB.prepare('INSERT INTO feedback (kind, message, contact, page, details, site) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(kind, message, contact, page, details, url.host).run();
  return json({ ok: true, id: r.meta && r.meta.last_row_id });
}

function robots(url) {
  if (!PRODUCTION.includes(url.hostname)) {
    // Preview links are for testing; the real site is earprint.xyz.
    return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return new Response('User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://earprint.xyz/sitemap.xml\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/feedback') return await feedback(request, env);
      if (url.pathname === '/robots.txt') return robots(url);
      if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found.' }, 404);
    } catch (e) {
      console.error('worker error', url.pathname, e && e.message);
      // Preview links say what failed, to help testing; the real site doesn't.
      const detail = PRODUCTION.includes(url.hostname) ? undefined : String(e && e.message);
      return json({ ok: false, error: 'Something went wrong on our side. Please try again later.', detail }, 500);
    }
    return env.ASSETS.fetch(request);
  }
};
