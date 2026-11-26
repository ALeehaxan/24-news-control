import { fields, categories, empty, validURL, normalizeBackup, publishingCaption } from './data.mjs';
import { draw, dl, resetPhoto } from './studio.js';

const $ = id => document.getElementById(id);
let db = empty();
let editing = null;
let session = null;
let pending = false;
let radarRequest = 0;
let sdk, auth, store;

function el(tag, text, parent) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

function btn(text, action, parent) {
  const button = el('button', text, parent);
  button.onclick = action;
  return button;
}

function link(text, url, parent) {
  const node = el('a', text, parent);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  node.className = 'btn';
}

function show(id) {
  if (!session?.ready) return;
  document.querySelectorAll('main section').forEach(section => section.hidden = section.id !== id);
  if (id === 'Editor') draw();
  if (id === 'Radar') loadRadar();
}

for (const name of ['Dashboard', 'Editor', 'Sources', 'Radar', 'Publishing', 'Settings']) {
  btn(name, () => show(name), $('nav'));
}
for (const category of categories) el('option', category, $('category'));

function render() {
  const stats = $('stats');
  stats.replaceChildren();
  const totals = [
    ['Stories', db.stories.length],
    ['Drafts', db.stories.filter(story => story.status === 'Draft').length],
    ['Approved', db.stories.filter(story => story.status === 'Approved').length],
    ['Posted manually', db.stories.filter(story => story.status === 'Posted').length]
  ];
  for (const [label, count] of totals) {
    const panel = el('div', '', stats);
    panel.className = 'panel';
    el('small', label, panel);
    el('div', count, panel).className = 'stat';
  }
  for (const id of ['queue', 'pub']) {
    const parent = $(id);
    parent.replaceChildren();
    const rows = db.stories.filter(story => id === 'queue' || story.status === 'Approved');
    if (!rows.length) el('p', 'No stories yet.', parent);
    for (const story of rows) {
      const panel = el('div', '', parent);
      panel.className = 'panel';
      el('div', story.status + ' · ' + story.category, panel).className = 'tag';
      const headline = el('h3', story.en || story.dv, panel);
      headline.lang = story.en ? 'en' : 'dv';
      headline.dir = story.en ? 'ltr' : 'rtl';
      el('small', story.location, panel);
      const actions = el('div', '', panel);
      actions.className = 'actions';
      btn('Edit', () => edit(story), actions);
      if (id === 'pub') {
        btn('Export approved caption', () => exportApproved(story), actions);
        btn('Mark posted manually', () => {
          if (confirm('Confirm you have published this story?')) {
            updateStory(story, current => ({ ...current, status: 'Posted' }));
          }
        }, actions);
      } else {
        btn('Delete', () => {
          if (confirm('Delete story?')) updateStory(story, () => null);
        }, actions);
      }
    }
  }
  const sources = $('sources');
  sources.replaceChildren();
  db.sources.forEach((source, index) => {
    const panel = el('div', '', sources);
    panel.className = 'panel';
    if (validURL(source.url)) link(source.name, source.url, panel);
    btn('Remove', () => mutate(data => {
      data.sources.splice(index, 1);
    }), panel);
  });
}

function sameStory(left, right) {
  return left && right && [...fields, 'id', 'status', 'verified'].every(key => left[key] === right[key]);
}

function updateStory(story, update) {
  return mutate(data => {
    const index = data.stories.findIndex(item => item.id === story.id);
    if (!sameStory(data.stories[index], story)) throw Error('This story changed on another device. Reopen it and try again.');
    const replacement = update(data.stories[index]);
    data.stories.splice(index, 1, ...(replacement ? [replacement] : []));
  });
}

async function mutate(change, expectedVersion = db.version) {
  const active = session;
  if (!active?.ready || pending) return false;
  pending = true;
  const version = crypto.randomUUID();
  $('syncStatus').textContent = 'Saving…';
  try {
    await sdk.runTransaction(store, async transaction => {
      const snapshot = await transaction.get(active.ref);
      const data = snapshot.exists() ? snapshot.data() : empty();
      if (session !== active || data.version !== expectedVersion) {
        throw Error('Newsroom data changed. Review the latest version and try again.');
      }
      change(data);
      data.version = version;
      if (new TextEncoder().encode(JSON.stringify(data)).length > 800_000) {
        throw Error('The newsroom has reached its storage limit. Export a backup and archive older stories.');
      }
      transaction.set(active.ref, data);
    });
    if (session !== active) return false;
    if ($('syncStatus').textContent === 'Saving…') $('syncStatus').textContent = 'Saved to Firebase';
    return true;
  } catch (error) {
    if (session === active) $('syncStatus').textContent = error.code
      ? 'Could not save. Check your connection and admin access.'
      : error.message;
    return false;
  } finally {
    if (session === active) pending = false;
  }
}

async function save(approve) {
  const story = Object.fromEntries(fields.map(field => [field, $(field).value.trim()]));
  if (!story.en && !story.dv) return alert('Enter a headline.');
  story.verified = $('verified').checked;
  if (approve && (!story.verified || !validURL(story.source))) {
    return alert('Approval requires a valid source URL and verification.');
  }
  const original = editing;
  story.id = original?.id || crypto.randomUUID();
  story.status = approve ? 'Approved' : 'Draft';
  const saved = original ? await updateStory(original, () => story) : await mutate(data => data.stories.unshift(story));
  if (saved && editing === original) {
    editing = story;
    $('exportApprovedPoster').hidden = story.status !== 'Approved';
  }
}

function clearEditor() {
  editing = null;
  for (const field of fields) $(field).value = '';
  $('category').selectedIndex = 0;
  $('verified').checked = false;
  $('exportApprovedPoster').hidden = true;
  resetPhoto();
  draw();
}

function edit(story) {
  clearEditor();
  editing = story;
  for (const field of fields) $(field).value = story[field];
  $('verified').checked = story.verified;
  $('exportApprovedPoster').hidden = story.status !== 'Approved';
  show('Editor');
}

async function addSource() {
  const name = $('sn').value.trim();
  const url = $('su').value.trim();
  if (!name || !validURL(url)) return alert('Enter a name and valid HTTP(S) URL.');
  if (await mutate(data => data.sources.push({ name, url }))) {
    if ($('sn').value.trim() === name && $('su').value.trim() === url) $('sn').value = $('su').value = '';
  }
}

function downloadText(text, type, filename) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  dl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function withApprovedStory(story, exportStory) {
  const active = session;
  if (!active?.ready) return;
  try {
    const snapshot = await sdk.getDocFromServer(active.ref);
    if (session !== active) return;
    const current = snapshot.data()?.stories.find(item => item.id === story.id);
    if (!sameStory(current, story)) throw Error('The story changed. Review the latest publishing queue.');
    exportStory(current, publishingCaption(current));
  } catch (error) {
    if (session === active) alert(error.code ? 'Could not verify current approval.' : error.message);
  }
}

function exportApproved(story) {
  return withApprovedStory(story, (current, caption) => {
    downloadText(caption, 'text/plain;charset=utf-8', '24-news-' + current.id + '.txt');
  });
}

for (const field of fields) {
  $(field).addEventListener('input', () => {
    $('verified').checked = false;
    $('exportApprovedPoster').hidden = true;
  });
}

$('exportApprovedPoster').onclick = () => {
  if (!editing) return;
  const original = editing;
  return withApprovedStory(original, current => {
    if (editing !== original || !fields.every(field => $(field).value.trim() === current[field])) {
      throw Error('Save and approve the current story before exporting.');
    }
    draw();
    dl($('poster').toDataURL('image/png'), '24-news-' + current.id + '.png');
  });
};

function backup() {
  if (!session?.ready) return;
  downloadText(JSON.stringify({ stories: db.stories, sources: db.sources }, null, 2),
    'application/json', '24-news-backup.json');
}

async function restore(raw, expectedVersion) {
  try {
    const data = normalizeBackup(JSON.parse(raw));
    if (confirm('Replace synced stories and sources on all devices with this backup?') &&
      await mutate(current => Object.assign(current, data), expectedVersion)) {
      clearEditor();
    }
  } catch {
    alert('Invalid backup.');
  }
}

$('restore').onchange = async event => {
  const file = event.target.files[0];
  const version = db.version;
  const active = session;
  event.target.value = '';
  if (!file) return;
  try {
    const raw = await file.text();
    if (session === active) await restore(raw, version);
  } catch {
    alert('Could not read the backup.');
  }
};

function legacyData() {
  try { return localStorage.getItem('24news-v1'); } catch { return null; }
}
$('importLegacy').onclick = () => restore(legacyData(), db.version);
Object.assign(window, { save, clearEditor, addSource, backup });

async function loadRadar() {
  const active = session;
  const request = ++radarRequest;
  const status = $('radarStatus');
  const rows = $('radarItems');
  const language = $('radarLanguage').value;
  rows.replaceChildren();
  status.textContent = 'Loading Radar…';
  try {
    const response = await fetch('./radar.json', { cache: 'no-cache' });
    if (!response.ok) throw Error();
    const data = await response.json();
    if (session !== active || request !== radarRequest) return;
    const items = data.items.filter(item => (!language || item.language === language) && validURL(item.url));
    status.textContent = data.generatedAt
      ? 'Snapshot updated ' + new Date(data.generatedAt).toLocaleString() + '. Review each source and revise the draft before approval.'
      : 'Waiting for the first scheduled collection.';
    if (!items.length) el('p', 'No matching leads.', rows);
    for (const item of items) {
      const panel = el('article', '', rows);
      panel.className = 'panel';
      const title = el('h3', item.title, panel);
      title.lang = item.language;
      title.dir = item.language === 'dv' ? 'rtl' : 'ltr';
      el('p', [item.source, item.region, new Date(item.publishedAt).toLocaleDateString()].join(' · '), panel);
      const draft = typeof item.draft === 'string' ? item.draft : '';
      const preview = el('p', draft, panel);
      preview.lang = title.lang;
      preview.dir = title.dir;
      preview.style.whiteSpace = 'pre-line';
      const actions = el('div', '', panel);
      actions.className = 'actions';
      link('Open source', item.url, actions);
      btn(draft ? 'Edit prepared draft' : 'Open in editor', () => {
        clearEditor();
        $(item.language === 'dv' ? 'dv' : 'en').value = item.title;
        $(item.language === 'dv' ? 'bodyDv' : 'bodyEn').value = draft;
        $('source').value = item.url;
        $('location').value = item.region;
        show('Editor');
      }, actions);
    }
  } catch {
    if (session === active && request === radarRequest) status.textContent = 'Radar is temporarily unavailable.';
  }
}
$('radarLanguage').onchange = loadRadar;

function resetWorkspace() {
  session?.unsubscribe?.();
  session = null;
  pending = false;
  db = empty();
  $('workspace').hidden = true;
  $('login').hidden = false;
  $('radarItems').replaceChildren();
  $('sn').value = $('su').value = '';
  $('restore').value = '';
  clearEditor();
  render();
}

async function authenticate(user) {
  resetWorkspace();
  $('signIn').hidden = Boolean(user);
  $('switchAccount').hidden = !user;
  $('loginStatus').textContent = user ? 'Checking newsroom access…' : 'Sign in with an authorized Google account.';
  if (!user) return;
  const active = { ref: sdk.doc(store, 'newsrooms/main'), ready: false };
  session = active;
  try {
    const access = await sdk.getDocFromServer(sdk.doc(store, 'admins', user.uid));
    if (session !== active) return;
    if (!access.exists()) throw Error();
    active.unsubscribe = sdk.onSnapshot(active.ref, { includeMetadataChanges: true }, snapshot => {
      if (session !== active || (!active.ready && snapshot.metadata.fromCache)) return;
      db = snapshot.exists() ? snapshot.data() : empty();
      render();
      if (!active.ready) {
        active.ready = true;
        $('importLegacy').hidden = !legacyData();
        show('Dashboard');
        $('workspace').hidden = false;
        $('login').hidden = true;
      }
      $('syncStatus').textContent = snapshot.metadata.fromCache ? 'Offline · showing last synced data' : 'Synced with Firebase';
    }, () => {
      if (session !== active) return;
      resetWorkspace();
      $('loginStatus').textContent = 'Newsroom access is unavailable. Sign out and try again.';
    });
  } catch {
    if (session === active) $('loginStatus').textContent = 'Could not verify admin access. Sign out and check your account or connection.';
  }
}

async function init() {
  try {
    const response = await fetch('./firebase-config.json', { cache: 'no-cache' });
    const config = await response.json();
    if (!response.ok || !['apiKey', 'authDomain', 'projectId', 'appId'].every(key => typeof config[key] === 'string' && config[key])) {
      $('loginStatus').textContent = 'Firebase setup is required before the newsroom can open.';
      return;
    }
    const base = 'https://www.gstatic.com/firebasejs/12.15.0/';
    const [app, authentication, firestore] = await Promise.all([
      import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')
    ]);
    sdk = { ...authentication, ...firestore };
    const firebase = app.initializeApp(config);
    auth = sdk.getAuth(firebase);
    store = sdk.getFirestore(firebase);
    await sdk.setPersistence(auth, sdk.browserSessionPersistence);
    $('signIn').onclick = async () => {
      $('signIn').disabled = true;
      try {
        await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
      } catch {
        $('loginStatus').textContent = 'Google sign-in did not complete. Allow pop-ups and try again.';
      } finally {
        $('signIn').disabled = false;
      }
    };
    const signOut = async () => {
      try { await sdk.signOut(auth); } catch { alert('Could not sign out. Try again.'); }
    };
    $('signOut').onclick = $('switchAccount').onclick = signOut;
    sdk.onAuthStateChanged(auth, authenticate);
    $('signIn').disabled = false;
  } catch {
    $('loginStatus').textContent = 'Could not initialize Firebase. Check the project configuration and connection.';
  }
}

init();
