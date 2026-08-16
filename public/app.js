const state = { campaigns: [], campaignId: localStorage.getItem('campaignId'), locations: [], filter: 'all', recentFilter: 'all', query: '' };
const $ = (selector) => document.querySelector(selector);
const elements = { campaign: $('#campaign'), locations: $('#locations'), empty: $('#empty'), search: $('#search'), dialog: $('#campaignDialog'), form: $('#campaignForm') };

async function api(path, options) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

async function authenticate() {
  const session = await api('/api/auth/session');
  if (session.authenticated) return true;
  $('#loginError').textContent = '';
  $('#loginOverlay').hidden = false;
  document.body.classList.add('locked');
  return false;
}

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

async function loadCampaigns(selectNewest = false) {
  state.campaigns = await api('/api/campaigns');
  if (selectNewest || !state.campaigns.some(c => c.id === state.campaignId)) state.campaignId = state.campaigns.at(-1)?.id;
  localStorage.setItem('campaignId', state.campaignId);
  elements.campaign.innerHTML = state.campaigns.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  elements.campaign.value = state.campaignId;
  await loadLocations();
}

async function loadLocations() {
  state.locations = await api(`/api/campaigns/${state.campaignId}/locations`);
  render();
}

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }

function render() {
  const counts = { undiscovered: 0, discovered: 0, cleared: 0 };
  state.locations.forEach(l => counts[l.status]++);
  $('#undiscoveredCount').textContent = counts.undiscovered;
  $('#discoveredCount').textContent = counts.discovered;
  $('#clearedCount').textContent = counts.cleared;
  $('#allCount').textContent = state.locations.length;
  const percent = state.locations.length ? Math.round(counts.cleared / state.locations.length * 100) : 0;
  $('#clearedPercent').textContent = `${percent}%`;
  $('#progressRing').style.setProperty('--p', `${percent * 3.6}deg`);

  const query = state.query.toLowerCase();
  const visible = state.locations.filter(l => (state.filter === 'all' || l.status === state.filter) &&
    (!query || l.name.toLowerCase().includes(query) || l.coordinates.toLowerCase().includes(query) || String(l.number).includes(query)));
  elements.empty.hidden = visible.length > 0;
  elements.locations.hidden = visible.length === 0;
  elements.locations.innerHTML = visible.map(l => `
    <article class="location" data-number="${l.number}">
      <div class="location-main"><span class="number">${String(l.number).padStart(2,'0')}</span><span class="coords">${escapeHtml(l.coordinates)}</span><h3>${escapeHtml(l.name)}</h3></div>
      <div class="status-control" aria-label="Status for ${escapeHtml(l.name)}">
        ${['undiscovered','discovered','cleared'].map(s => `<button data-status="${s}" class="${l.status === s ? 'active' : ''}">${s[0].toUpperCase()+s.slice(1)}</button>`).join('')}
      </div>
    </article>`).join('');
  renderRecent();
}

function renderRecent() {
  const recent = state.locations
    .filter(location => location.updated_at && (state.recentFilter === 'all' || location.status === state.recentFilter))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 5);
  $('#recentCount').textContent = `${recent.length} ${recent.length === 1 ? 'update' : 'updates'}`;
  $('#recentEmpty').hidden = recent.length > 0;
  $('#recentLocations').hidden = recent.length === 0;
  $('#recentLocations').innerHTML = recent.map(location => `
    <div class="recent-item">
      <span class="recent-number">${String(location.number).padStart(2, '0')}</span>
      <span class="recent-coords">${escapeHtml(location.coordinates)}</span>
      <div class="recent-name"><strong>${escapeHtml(location.name)}</strong><small>${formatRelativeTime(location.updated_at)}</small></div>
      <span class="recent-status ${location.status}">${location.status === 'cleared' ? 'Done' : location.status[0].toUpperCase() + location.status.slice(1)}</span>
    </div>`).join('');
}

function formatRelativeTime(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

elements.locations.addEventListener('click', async event => {
  const button = event.target.closest('[data-status]'); if (!button) return;
  const article = button.closest('[data-number]'); const number = Number(article.dataset.number); const status = button.dataset.status;
  const location = state.locations.find(l => l.number === number); const previous = location.status; const previousUpdatedAt = location.updated_at;
  if (previous === status) return;
  location.status = status; location.updated_at = new Date().toISOString(); render();
  try {
    const saved = await api(`/api/campaigns/${state.campaignId}/locations/${number}`, { method: 'PUT', body: JSON.stringify({ status }) });
    location.updated_at = saved.updated_at;
    render();
  }
  catch (error) { location.status = previous; location.updated_at = previousUpdatedAt; render(); toast(error.message); }
});

elements.search.addEventListener('input', e => { state.query = e.target.value.trim(); render(); });
document.querySelector('.filters').addEventListener('click', e => { const button = e.target.closest('[data-filter]'); if (!button) return; document.querySelectorAll('.filter').forEach(b => b.classList.remove('active')); button.classList.add('active'); state.filter = button.dataset.filter; render(); });
document.querySelector('.recent-filters').addEventListener('click', e => { const button = e.target.closest('[data-recent-filter]'); if (!button) return; document.querySelectorAll('.recent-filter').forEach(b => b.classList.remove('active')); button.classList.add('active'); state.recentFilter = button.dataset.recentFilter; renderRecent(); });
elements.campaign.addEventListener('change', async e => { state.campaignId = e.target.value; localStorage.setItem('campaignId', state.campaignId); await loadLocations(); });
$('#newCampaign').addEventListener('click', () => { elements.form.reset(); elements.dialog.showModal(); setTimeout(() => $('#campaignName').focus(), 50); });
$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); });
$('#togglePassword').addEventListener('click', () => {
  const input = $('#password');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  $('#togglePassword').textContent = showing ? 'Show' : 'Hide';
  $('#togglePassword').setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  input.focus();
});
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  $('#loginError').textContent = '';
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    $('#loginOverlay').hidden = true;
    document.body.classList.remove('locked');
    $('#password').value = '';
    await loadCampaigns();
  } catch (error) { $('#loginError').textContent = error.message; }
  finally { button.disabled = false; }
});
document.querySelectorAll('.close,.cancel').forEach(b => b.addEventListener('click', () => elements.dialog.close()));
elements.form.addEventListener('submit', async e => { e.preventDefault(); try { await api('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: $('#campaignName').value }) }); elements.dialog.close(); await loadCampaigns(true); toast('Campaign created'); } catch (error) { toast(error.message); } });

authenticate().then(authenticated => authenticated && loadCampaigns()).catch(error => { toast(error.message); elements.locations.innerHTML = '<div class="empty"><h3>Unable to open the ledger</h3><p>Please refresh and try again.</p></div>'; });
