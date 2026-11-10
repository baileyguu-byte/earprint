// Feedback form: posts to /api/feedback (src/worker.js), which stores it in Earprint's database.
const $ = (id) => document.getElementById(id);
const form = $('fbForm'), msg = $('fbMsg'), status = $('fbStatus'), send = $('fbSend');
const shownAt = Date.now();
const params = new URLSearchParams(location.search);

const PROMPTS = {
  idea: ['What would make Earprint more useful?', 'A feature, a device or export format you’d like, or something that confused you.'],
  bug: ['What went wrong?', 'What you did, what happened and what you expected. Mention the song, headphones or export format if it matters.'],
  comment: ['What’s on your mind?', 'Anything at all: what you liked, what you didn’t, how you use it.']
};
const kindNow = () => (form.querySelector('input[name="kind"]:checked') || {}).value || 'idea';
function renderKind() {
  const [label, hint] = PROMPTS[kindNow()];
  $('fbMsgLabel').textContent = label;
  $('fbMsgHint').textContent = hint;
}

/** Where they came from: ?from=/lab/ or the previous page on this site. */
function fromPage() {
  const f = params.get('from');
  if (f && /^\/[\w\-/]*$/.test(f)) return f;
  try {
    const r = document.referrer && new URL(document.referrer);
    if (r && r.host === location.host && r.pathname !== '/feedback/') return r.pathname;
  } catch (e) {}
  return '';
}
const saved = (k) => { try { return JSON.parse(localStorage.getItem('earprint:' + k)); } catch (e) { return null; } };
/** The technical details, exactly as they'll be sent (no age, no song history). */
function details() {
  const setup = saved('setup') || {};
  return {
    browser: navigator.userAgent,
    screen: innerWidth + '×' + innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x',
    language: navigator.language,
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    layout: saved('layout') || 'b10',
    exportFormat: saved('fmt') || '',
    headphones: setup.hp && setup.hp.name ? setup.hp.name + (setup.hpOn === false ? ' (off)' : '') : '',
    ageCompensation: setup.ageAmt || 'off'
  };
}
function renderDetails() { $('fbDetailsPreview').textContent = JSON.stringify(details(), null, 2); }

function setStatus(text, err) {
  status.textContent = text;
  status.classList.toggle('err', !!err);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = msg.value.trim();
  if (message.length < 3) { setStatus('Write a few words first.', true); msg.focus(); return; }
  send.disabled = true;
  setStatus('Sending…');
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: kindNow(), message, contact: $('fbContact').value.trim(), page: fromPage(),
        details: $('fbDetails').checked ? details() : null,
        website: $('fbWebsite').value, ms: Date.now() - shownAt
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'It didn’t send (error ' + res.status + ').');
    form.hidden = true;
    $('fbDoneText').textContent = $('fbContact').value.trim()
      ? 'It’s been passed on, and you may get a reply at the contact you left.'
      : 'It’s been passed on. You didn’t leave a way to reach you, so there won’t be a reply, but it will be read.';
    $('fbDone').hidden = false;
    $('fbDone').focus();
  } catch (err) {
    setStatus((err && err.message) || 'It didn’t send. Check your connection and try again.', true);
  } finally {
    send.disabled = false;
  }
});
$('fbAgain').addEventListener('click', () => {
  form.reset();
  msg.value = '';
  setKind(params.get('type'));
  renderCount(); setStatus('');
  $('fbDone').hidden = true;
  form.hidden = false;
  msg.focus();
});
function renderCount() { $('fbCount').textContent = msg.value.length.toLocaleString('en-AU') + ' / 4,000'; }
function setKind(k) {
  const r = form.querySelector('input[name="kind"][value="' + (PROMPTS[k] ? k : 'idea') + '"]');
  if (r) r.checked = true;
  $('fbDetails').checked = kindNow() === 'bug';
  renderKind();
}
form.querySelectorAll('input[name="kind"]').forEach((r) => r.addEventListener('change', () => {
  renderKind();
  if (kindNow() === 'bug') $('fbDetails').checked = true;
}));
msg.addEventListener('input', renderCount);
setKind(params.get('type'));
renderDetails();
renderCount();
