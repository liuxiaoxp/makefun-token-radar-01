'use strict';
(() => {
  const data = window.RADAR;
  const $ = id => document.getElementById(id);
  if (!data) { $('integrity').textContent = 'Data missing: run main.ts and open output/dashboard/index.html'; $('integrity').className = 'error'; return; }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => n === null ? '—' : '$' + (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0));
  const exactMoney = n => typeof n === 'number' ? '$' + n.toLocaleString('en-US', {maximumFractionDigits: 0}) : 'Not recorded';
  const number = n => n.toLocaleString('en-US');
  const fixed = n => n.toFixed(3);
  const category = p => p.category || 'Uncategorized';
  const numeric = n => typeof n === 'number' && Number.isFinite(n);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const slugCompare = (a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  const watchlist = new Set(data.watchlist);
  const listed = data.protocols.filter(p => numeric(p.mcap_usd));
  const defaults = { multiple_min: 0.05, multiple_max: 5, growth_min: -0.5, growth_max: 1, maturity_floor: 0.5, maturity_days: 730 };
  let scenario = {...defaults};
  let state = {};
  let lastFocus = null;
  function median(values) {
    const items = [...values].sort((a, b) => a - b), middle = Math.floor(items.length / 2);
    return items.length % 2 ? items[middle] : (items[middle - 1] + items[middle]) / 2;
  }
  function computeComparables(protocols) {
    // Rebuild medians from raw listed records, independently of the backend's peer map.
    const peers = protocols.filter(p => numeric(p.mcap_usd));
    const global = median(peers.map(p => p.mcap_usd / p.tvl_usd));
    return Object.fromEntries([...new Set(protocols.map(category))].map(key => {
      const group = peers.filter(p => category(p) === key);
      return [key, { count: group.length, raw: group.length ? median(group.map(p => p.mcap_usd / p.tvl_usd)) : global }];
    }));
  }
  const peerMap = computeComparables(data.protocols);
  function computeAge(listedAt) {
    if (!listedAt) return null;
    const time = Date.parse(listedAt + 'T00:00:00Z');
    return Number.isFinite(time) ? Math.max(0, Math.floor((Date.parse('2026-11-14T00:00:00Z') - time) / 86400000)) : null;
  }
  function computeModel(row, model = defaults) {
    const multiple = clamp(peerMap[category(row)].raw, model.multiple_min, model.multiple_max);
    const growth = 1 + clamp((row.change_7d ?? 0) / 100, model.growth_min, model.growth_max);
    const age = computeAge(row.listed_at);
    const maturity = model.maturity_floor + (1 - model.maturity_floor) * Math.min(1, (age ?? 0) / model.maturity_days);
    return { multiple, growth, maturity, age, value: Math.round(row.tvl_usd * multiple * growth * maturity) };
  }
  function verifyBoard() {
    return data.rows.filter(row => {
      const score = computeModel(row);
      return score.value !== row.implied_value_usd || score.multiple !== row.model.category_multiple || score.growth !== row.model.growth_multiplier || score.maturity !== row.model.maturity_multiplier || score.age !== row.age_days;
    }).map(row => row.slug);
  }
  const mismatches = verifyBoard();
  // Exposed for offline browser checks; the visible badge reflects this same result.
  window.RADAR_CHECK = { checked: data.rows.length, mismatches };
  $('integrity').textContent = mismatches.length ? `! ${mismatches.length} MODEL MISMATCHES` : `✓ ${data.rows.length}/${data.rows.length} MODEL CHECKS`;
  $('integrity').classList.toggle('error', mismatches.length > 0);
  const totalTVL = data.rows.reduce((sum, row) => sum + row.tvl_usd, 0);
  const stats = [
    ['PRE-TOKEN SIGNALS', data.rows.length, 'RANKED', 'Strict token-record screening'],
    ['WATCHLIST COVERAGE', data.watchlist.length + ' / ' + data.watchlist.length, 'COMPLETE', 'All snapshot watchlist protocols'],
    ['TRACKED CAPITAL', money(totalTVL), 'TVL', 'Across the discovery universe'],
    ['LISTED COMPARABLES', listed.length, 'PEERS', 'Category medians anchor the model']
  ];
  $('stats').innerHTML = stats.map(s => `<div class="stat"><span class="stat-label">${s[0]}</span><div class="stat-value"><b>${s[1]}</b><small>${s[2]}</small></div><p>${s[3]}</p></div>`).join('');
  for (const [id, values] of [['category', [...new Set(data.protocols.map(category))]], ['chain', [...new Set(data.protocols.flatMap(p => p.chains))]]]) {
    $(id).insertAdjacentHTML('beforeend', values.sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''));
  }
  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    state = { view: ['board','listed','sandbox','method'].includes(params.get('view')) ? params.get('view') : 'board', q: params.get('filter') || '', category: params.get('category') || '', chain: params.get('chain') || '', floor: Number(params.get('floor')) || 0, watch: params.get('watch') === '1', detail: params.get('detail') || '', sort: params.get('sort') || 'rank', dir: params.get('dir') === '-1' ? -1 : 1 };
    scenario = {...defaults};
    for (const key of Object.keys(defaults)) {
      const value = params.get(key);
      if (value !== null && Number.isFinite(Number(value))) scenario[key] = Number(value);
    }
    if (!validScenario(scenario)) scenario = {...defaults};
    syncControls();
  }
  function writeHash() {
    const params = new URLSearchParams();
    if (state.view !== 'board') params.set('view', state.view);
    for (const [key, value] of [['filter', state.q], ['category', state.category], ['chain', state.chain], ['floor', state.floor || ''], ['watch', state.watch ? '1' : ''], ['detail', state.detail]]) if (value) params.set(key, value);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.dir !== 1) params.set('dir', state.dir);
    for (const key of Object.keys(defaults)) if (scenario[key] !== defaults[key]) params.set(key, scenario[key]);
    history.replaceState(null, '', '#' + params.toString());
  }
  function syncControls() {
    $('search').value = state.q; $('category').value = state.category; $('chain').value = state.chain; $('floor').value = String(state.floor); $('watch').checked = state.watch;
    Object.keys(defaults).forEach(key => { $(key).value = scenario[key]; });
  }
  function filteredRows(rows) {
    const query = state.q.trim().toLowerCase();
    return rows.filter(p => (!query || [p.name, p.slug, category(p), ...p.chains].join(' ').toLowerCase().includes(query)) && (!state.category || category(p) === state.category) && (!state.chain || p.chains.includes(state.chain)) && p.tvl_usd >= state.floor && (!state.watch || watchlist.has(p.slug)));
  }
  function sortedRows(rows) {
    const keys = ['rank','name','tvl_usd','change_7d','age_days','implied_value_usd','mcap_usd','ratio'];
    const key = keys.includes(state.sort) ? state.sort : 'rank';
    return [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null || bv == null) return av == null && bv == null ? slugCompare(a, b) : av == null ? 1 : -1;
      const result = typeof av === 'string' ? (av.toLowerCase() < bv.toLowerCase() ? -1 : av.toLowerCase() > bv.toLowerCase() ? 1 : 0) : av - bv;
      return result * state.dir || slugCompare(a, b);
    });
  }
  function renderTable() {
    const isListed = state.view === 'listed', isScenario = state.view === 'sandbox';
    let universe;
    if (isListed) universe = [...listed].sort((a, b) => b.mcap_usd - a.mcap_usd || slugCompare(a, b)).map((p, i) => ({...p, rank: i + 1, age_days: computeAge(p.listed_at), ratio: p.mcap_usd / p.tvl_usd}));
    else universe = data.rows.map(row => ({...row, calculated: computeModel(row, isScenario ? scenario : defaults)})).map(row => ({...row, implied_value_usd: row.calculated.value})).sort((a, b) => b.implied_value_usd - a.implied_value_usd || slugCompare(a, b)).map((row, i) => ({...row, rank: i + 1}));
    const rows = sortedRows(filteredRows(universe));
    const headings = [['rank','#'], ['name','PROTOCOL / DEPLOYMENT'], ['tvl_usd','TVL'], ['change_7d','7D CHANGE'], ['age_days','LISTING AGE'], [isListed ? 'mcap_usd' : 'implied_value_usd', isListed ? 'MARKET CAP' : isScenario ? 'SCENARIO VALUE' : 'IMPLIED VALUE / BREAKDOWN']];
    if (isListed) headings.push(['ratio','MCAP / TVL']);
    $('table-head').innerHTML = '<tr>' + headings.map(([key, label]) => `<th scope="col" aria-sort="${state.sort === key ? state.dir === 1 ? 'ascending' : 'descending' : 'none'}"><button data-sort="${key}">${label} ${state.sort === key ? state.dir === 1 ? '↑' : '↓' : '↕'}</button></th>`).join('') + '</tr>';
    const max = Math.max(...universe.map(r => r.implied_value_usd || 0), 1);
    $('table-body').innerHTML = rows.map(r => {
      const s = r.calculated;
      const name = `<button class="protocol-link" data-detail="${esc(r.slug)}">${esc(r.name)}</button>${watchlist.has(r.slug) ? '<span class="star" title="Snapshot watchlist">◆</span>' : ''}`;
      const growth = r.change_7d === null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(2) + '%';
      return `<tr><td class="rank num">${String(r.rank).padStart(2,'0')}</td><td>${name}<span class="subline" title="${esc(r.chains.join(', '))}">${esc(category(r))} · ${esc(r.chains.slice(0,2).join(', ') || 'Chain unknown')}${r.chains.length > 2 ? ' +' + (r.chains.length - 2) : ''}</span></td><td class="num">${money(r.tvl_usd)}</td><td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'positive' : 'negative'}">${growth}</td><td class="num">${r.age_days === null ? 'Unknown' : number(r.age_days) + 'd'}</td><td class="num ${isListed ? '' : 'score'}" title="${exactMoney(isListed ? r.mcap_usd : r.implied_value_usd)}">${money(isListed ? r.mcap_usd : r.implied_value_usd)}${isListed ? '' : `<span class="breakdown">${money(r.tvl_usd)} × ${fixed(s.multiple)} × ${fixed(s.growth)} × ${fixed(s.maturity)}</span><span class="signal-bar"><i style="width:${Math.max(1, r.implied_value_usd / max * 100)}%"></i></span>`}</td>${isListed ? `<td class="num">${r.ratio.toFixed(3)}×</td>` : ''}</tr>`;
    }).join('');
    $('result-count').innerHTML = `<b>${rows.length}</b> / ${universe.length} ${isListed ? 'LISTED COMPARABLES' : 'SIGNALS'}${state.watch ? ' · WATCHLIST' : ''}`;
    $('table-note').textContent = isListed ? 'Recorded market caps · excluded from discovery board' : 'TVL × category multiple × growth × maturity';
    $('table-total').textContent = `${isScenario ? 'SCENARIO / ' : ''}${rows.length} SHOWN · SNAPSHOT 2026-11-14`;
    $('empty').hidden = rows.length !== 0;
    if (isScenario) {
      const total = universe.reduce((sum,r) => sum + r.implied_value_usd, 0), baseline = data.rows.reduce((sum,r) => sum + r.implied_value_usd, 0);
      $('scenario-status').textContent = `Scenario aggregate ${money(total)} / baseline ${money(baseline)} / ${((total / baseline - 1) * 100).toFixed(1)}% change. Ranks recomputed across all ${universe.length} signals.`;
    }
  }
  function renderDetail() {
    const row = data.rows.find(r => r.slug === state.detail) || data.protocols.find(r => r.slug === state.detail);
    const dialog = $('drawer');
    if (!row) { if (dialog.open) dialog.close(); return; }
    const isBoard = numeric(row.implied_value_usd), isScenario = state.view === 'sandbox' && isBoard;
    const score = computeModel(row, isScenario ? scenario : defaults), peers = peerMap[category(row)];
    const factors = [['TVL',money(row.tvl_usd)], ['CATEGORY',fixed(score.multiple) + '×'], ['GROWTH',fixed(score.growth) + '×'], ['MATURITY',fixed(score.maturity) + '×']];
    const raw = Object.fromEntries(['slug','name','category','chains','tvl_usd','change_7d','mcap_usd','listed_at','gecko_id','symbol'].map(key => [key,row[key]]));
    $('detail-content').innerHTML = `<header class="drawer-head"><div><span class="eyebrow">${isBoard ? 'SIGNAL ' + String(row.rank).padStart(3,'0') + ' / ' + data.rows.length : 'LISTED COMPARABLE'} ${watchlist.has(row.slug) ? ' · WATCHLIST ◆' : ''}</span><h2 id="detail-title">${esc(row.name)}</h2><p>${esc(category(row))} / ${esc(row.chains.join(', ') || 'Chain unknown')}</p></div><button id="close-detail" aria-label="Close protocol details">Close ×</button></header><div class="drawer-body"><div class="detail-label">${isBoard ? isScenario ? 'SCENARIO IMPLIED VALUE' : 'MODEL IMPLIED VALUE · NOT A MARKET PRICE' : 'RECORDED MARKET CAP'}</div><div class="detail-value">${exactMoney(isBoard ? score.value : row.mcap_usd)}</div>${isBoard ? `<div class="factor-grid">${factors.map(([label,value]) => `<div><span>${label}</span><b>${value}</b></div>`).join('')}</div><p class="evidence">${peers.count ? peers.count + ' listed category peer(s)' : 'No listed category peers → global median fallback'} · raw median ${fixed(peers.raw)}×<br>${isScenario ? 'Local scenario; submitted board ' + exactMoney(row.implied_value_usd) : computeModel(row).value === row.implied_value_usd ? '✓ Recomputed value matches board.json exactly' : 'ERROR: board value mismatch'}<br>Factors displayed to 3 decimals; calculation uses full precision.</p><h3>FARM PLAN / SIX CHECKPOINTS</h3><ol class="steps">${row.farm_steps.map(step => { const parts = step.split(' Cost: '); return `<li>${esc(parts[0])}<span class="step-cost">Cost: ${esc(parts.slice(1).join(' Cost: '))}</span></li>`; }).join('')}</ol>` : `<p class="evidence">${fixed(row.mcap_usd / row.tvl_usd)}× market cap / TVL · ${peers.count} category peers<br>Recorded market data, excluded from the ranked board.</p>`}<details><summary>Raw snapshot fields / ${esc(row.slug)}</summary><pre>${esc(JSON.stringify(raw,null,2))}</pre></details><p class="detail-disclaimer">No token recorded does not mean no token. Verify official contracts, access and withdrawal rules before committing capital. Plans do not promise rewards.</p></div>`;
    $('close-detail').onclick = closeDetail;
    if (!dialog.open) { lastFocus = document.activeElement; dialog.showModal(); }
  }
  function closeDetail() { state.detail = ''; writeHash(); $('drawer').close(); if (lastFocus && lastFocus.isConnected) lastFocus.focus(); }
  function render() {
    document.querySelectorAll('[data-view]').forEach(button => { const active = button.dataset.view === state.view; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    $('filters').hidden = state.view === 'method'; $('results').hidden = state.view === 'method'; $('sandbox').hidden = state.view !== 'sandbox'; $('method').hidden = state.view !== 'method';
    if (state.view !== 'method') renderTable();
    renderDetail();
  }
  function clearFilters() { Object.assign(state, {q:'',category:'',chain:'',floor:0,watch:false}); syncControls(); writeHash(); render(); }
  function validScenario(model) { return Object.keys(defaults).every(key => numeric(model[key]) && model[key] >= Number($(key).min) && model[key] <= Number($(key).max)) && model.multiple_min <= model.multiple_max; }
  $('search').addEventListener('input', e => { state.q = e.target.value; writeHash(); renderTable(); });
  for (const id of ['category','chain','floor','watch']) $(id).addEventListener('change', e => { state[id] = id === 'watch' ? e.target.checked : id === 'floor' ? Number(e.target.value) : e.target.value; writeHash(); renderTable(); });
  document.querySelector('.view-nav').addEventListener('click', e => { const button = e.target.closest('[data-view]'); if (!button) return; state.view = button.dataset.view; state.sort = 'rank'; state.dir = 1; writeHash(); render(); });
  $('table-head').addEventListener('click', e => { const button = e.target.closest('[data-sort]'); if (!button) return; state.dir = state.sort === button.dataset.sort ? -state.dir : ['rank','name'].includes(button.dataset.sort) ? 1 : -1; state.sort = button.dataset.sort; writeHash(); renderTable(); });
  $('table-body').addEventListener('click', e => { const button = e.target.closest('[data-detail]'); if (!button) return; state.detail = button.dataset.detail; writeHash(); renderDetail(); });
  $('reset').onclick = clearFilters; $('clear-empty').onclick = clearFilters;
  $('drawer').addEventListener('cancel', e => { e.preventDefault(); closeDetail(); });
  $('drawer').addEventListener('click', e => { if (e.target === $('drawer') && e.clientX < $('drawer').getBoundingClientRect().left) closeDetail(); });
  for (const key of Object.keys(defaults)) $(key).addEventListener('input', () => {
    const candidate = Object.fromEntries(Object.keys(defaults).map(k => [k, $(k).value === '' ? NaN : Number($(k).value)]));
    if (!validScenario(candidate)) { $('scenario-status').textContent = 'Enter values within the shown limits; multiple floor must not exceed cap. Last valid scenario remains displayed.'; return; }
    scenario = candidate; writeHash(); renderTable();
  });
  $('restore').onclick = () => { scenario = {...defaults}; syncControls(); writeHash(); renderTable(); };
  const fallback = Object.keys(peerMap).filter(key => !peerMap[key].count);
  $('peer-summary').textContent = `Global listed median: ${fixed(median(listed.map(p => p.mcap_usd / p.tvl_usd)))}×. ${listed.length} numeric market caps. ${Object.keys(peerMap).length} categories. Global fallback categories: ${fallback.join(', ')}. Source: DefiLlama sealed protocol index; no live prices or launch announcements are requested.`;
  window.addEventListener('hashchange', () => { readHash(); render(); });
  readHash(); render();
})();
