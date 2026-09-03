const fmtUsd = (n) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n || 0}`;
};
const fmtQuarter = (isoDate) => {
  const d = new Date(isoDate);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
};
// Flat technology taxonomy (v3) — a single field, no qualifier tier.
const TECH_LABELS = {
  conventional: 'Conventional', egs: 'EGS', ags: 'AGS', shr: 'Superhot rock',
  direct_use: 'Direct use', cross_cutting_or_other: 'Cross-cutting / other',
};
const TECH_COLORS = {
  conventional: 'var(--series-2)', egs: 'var(--series-1)', ags: 'var(--series-3)',
  shr: 'var(--series-5)', direct_use: 'var(--series-4)', cross_cutting_or_other: 'var(--series-6)',
};
function techLabel(d) {
  return TECH_LABELS[d.tech_category] || d.tech_category;
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function loadSummary() {
  const s = await fetchJson('/api/summary');
  const tiles = [
    { value: s.deal_count.toLocaleString(), label: 'Published deals', sub: 'Acquisitions excluded' },
    { value: fmtUsd(s.total_investment_usd), label: 'Total disclosed investment', sub: 'New capital only' },
    { value: s.acquisitions.deal_count.toLocaleString(), label: 'Acquisitions', sub: `${fmtUsd(s.acquisitions.total_consideration_usd)} total consideration` },
    { value: s.pending_review_count.toLocaleString(), label: 'Pending manual review', sub: s.pending_review_count > 0 ? 'Needs your attention' : 'All caught up' },
    { value: (s.by_confidence.high || 0).toLocaleString(), label: 'High-confidence deals', sub: `${s.by_confidence.medium || 0} medium · ${s.by_confidence.low || 0} low` },
  ];
  document.getElementById('kpi-row').innerHTML = tiles.map((t) => `
    <div class="kpi-tile"><div class="value">${t.value}</div><div class="label">${t.label}</div><div class="sub">${t.sub}</div></div>
  `).join('');

  const reviewSection = document.getElementById('review-section');
  if (s.pending_review_count > 0) {
    reviewSection.hidden = false;
    loadReviewQueue();
  }
}

async function loadQuarterTrend() {
  const rows = await fetchJson('/api/trends/by-quarter');
  const byQuarter = {};
  for (const r of rows) {
    byQuarter[r.quarter] ||= { investment: 0, acquisitions: 0 };
    byQuarter[r.quarter][r.is_acquisition ? 'acquisitions' : 'investment'] += r.total_usd;
  }
  const quarters = Object.keys(byQuarter).sort().slice(-8); // last 8 quarters
  const max = Math.max(1, ...quarters.map((q) => Math.max(byQuarter[q].investment, byQuarter[q].acquisitions)));

  document.getElementById('quarter-legend').innerHTML = `
    <span class="legend-item"><span class="legend-swatch" style="background:var(--series-1)"></span>New capital</span>
    <span class="legend-item"><span class="legend-swatch" style="background:var(--series-2)"></span>Acquisitions</span>
  `;

  document.getElementById('quarter-chart').innerHTML = quarters.length ? quarters.map((q) => {
    const { investment, acquisitions } = byQuarter[q];
    return `
      <div class="quarter-col">
        <div class="quarter-bars">
          <div class="bar" style="height:${(investment / max) * 100}%; background: var(--series-1)" title="${fmtQuarter(q)} new capital: ${fmtUsd(investment)}"></div>
          <div class="bar" style="height:${(acquisitions / max) * 100}%; background: var(--series-2)" title="${fmtQuarter(q)} acquisitions: ${fmtUsd(acquisitions)}"></div>
        </div>
        <div class="quarter-label">${fmtQuarter(q)}</div>
      </div>`;
  }).join('') : '<p class="empty-state">No dated deals yet.</p>';
}

async function loadTechChart() {
  const rows = await fetchJson('/api/trends/by-tech');
  const max = Math.max(1, ...rows.map((r) => r.total_usd));
  document.getElementById('tech-chart').innerHTML = rows.length ? rows.map((r) => `
    <div class="hbar-row">
      <div class="hbar-label">${TECH_LABELS[r.tech_category] || r.tech_category}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(r.total_usd / max) * 100}%; background:${TECH_COLORS[r.tech_category] || 'var(--series-6)'}"></div></div>
      <div class="hbar-value">${fmtUsd(r.total_usd)}</div>
    </div>`).join('') : '<p class="empty-state">No data yet.</p>';
}

async function loadGeoChart() {
  const rows = await fetchJson('/api/trends/by-geography');
  const max = Math.max(1, ...rows.map((r) => r.total_usd));
  document.getElementById('geo-chart').innerHTML = rows.length ? rows.map((r) => `
    <div class="hbar-row">
      <div class="hbar-label">${r.country}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(r.total_usd / max) * 100}%; background:var(--series-1)"></div></div>
      <div class="hbar-value">${fmtUsd(r.total_usd)}</div>
    </div>`).join('') : '<p class="empty-state">No data yet.</p>';
}

function confidenceBadge(level) {
  return `<span class="badge confidence-${level}">${level}</span>`;
}
function investorNames(deal) {
  return (deal.investors || []).map((i) => i.investor_name).join(', ') || '—';
}
// source_mix is computed server-side per deal from its investors' capital_source
// (public/private/unclear per investor -> public/private/mixed/unclear per deal — see
// api.js's deriveSourceMix) but was never actually rendered anywhere in the UI, even
// though it was already in every /api/deals response — the taxonomy captured it, the
// review queue just never showed it, so there was no way to see or correct it.
function capitalSourceBadge(deal) {
  const mix = deal.source_mix || 'unclear';
  const title = (deal.investors || [])
    .map((i) => `${i.investor_name}: ${i.capital_source}${i.capital_source_qualifier ? ` (${i.capital_source_qualifier.replace(/_/g, ' ')})` : ''}`)
    .join('\n');
  return `<span class="badge capital-${mix}" title="${title.replace(/"/g, '&quot;')}">${mix}</span>`;
}
function dealLabel(deal) {
  const parts = [deal.deal_type];
  if (deal.deal_type_qualifier) parts.push(deal.deal_type_qualifier.replace(/_/g, ' '));
  return parts.filter(Boolean).join(' · ');
}

async function loadDealFeed() {
  const deals = await fetchJson('/api/deals?limit=50');
  const tbody = document.getElementById('deals-tbody');
  tbody.innerHTML = deals.length ? deals.map((d) => `
    <tr>
      <td>${d.recipient || '—'}</td>
      <td>${investorNames(d)}</td>
      <td>${capitalSourceBadge(d)}</td>
      <td>${dealLabel(d)}</td>
      <td>${d.amount ? `${fmtUsd(d.amount_usd || d.amount)}${d.currency && d.currency !== 'USD' ? ` (${d.amount.toLocaleString()} ${d.currency})` : ''}` : 'Undisclosed'}</td>
      <td>${techLabel(d)}</td>
      <td>${d.geography_country || '—'}</td>
      <td>${d.announced_date || '—'}</td>
      <td>${confidenceBadge(d.confidence)}</td>
      <td><a href="${d.source_url}" target="_blank" rel="noopener">Source</a></td>
    </tr>`).join('') : '<tr><td colspan="10" class="empty-state">No published deals yet — the collector runs daily.</td></tr>';
}

let TAXONOMY = null;
let reviewDealsById = {};

function duplicateWarning(d) {
  if (!d.possible_duplicate_of_id) return '';
  const amt = d.duplicate_of_amount_usd ? fmtUsd(d.duplicate_of_amount_usd) : 'undisclosed amount';
  const date = d.duplicate_of_announced_date ? d.duplicate_of_announced_date.slice(0, 10) : 'undated';
  return `<div class="dup-warning">⚠ possibly the same deal as <strong>${d.duplicate_of_recipient}</strong> (${amt}, ${date}, deal #${d.possible_duplicate_of_id}) — check before approving</div>`;
}

function viewRow(d) {
  return `
    <tr id="review-row-${d.id}">
      <td>${d.recipient || '(unnamed)'}${duplicateWarning(d)}</td>
      <td>${dealLabel(d)}</td>
      <td>${d.amount ? fmtUsd(d.amount_usd || d.amount) : 'Undisclosed'}</td>
      <td>${capitalSourceBadge(d)}</td>
      <td>${techLabel(d)}</td>
      <td>${d.announced_date ? d.announced_date.slice(0, 10) : '—'}</td>
      <td><a href="${d.source_url}" target="_blank" rel="noopener">Source</a></td>
      <td class="review-actions">
        <button class="approve" data-id="${d.id}" data-action="approve">Approve</button>
        <button class="reject" data-id="${d.id}" data-action="reject">Reject</button>
        <button class="edit" data-id="${d.id}" data-action="edit">Edit</button>
      </td>
    </tr>`;
}

function optionList(values, selected) {
  return values.map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${v.replace(/_/g, ' ')}</option>`).join('');
}

function editRow(d) {
  const dealTypes = TAXONOMY ? TAXONOMY.DEAL_TYPE : [d.deal_type];
  const techCategories = TAXONOMY ? TAXONOMY.TECH_CATEGORY : [d.tech_category];
  return `
    <tr id="review-row-${d.id}" class="editing">
      <td><input type="text" data-field="recipient" value="${d.recipient || ''}" placeholder="Recipient">${duplicateWarning(d)}</td>
      <td>
        <select data-field="deal_type">${optionList(dealTypes, d.deal_type)}</select>
        <input type="text" data-field="deal_type_qualifier" value="${d.deal_type_qualifier || ''}" placeholder="qualifier">
      </td>
      <td>
        <input type="number" data-field="amount" value="${d.amount || ''}" placeholder="Amount" style="width:90px">
        <input type="text" data-field="currency" value="${d.currency || ''}" placeholder="USD" style="width:50px">
      </td>
      <td>${capitalSourceBadge(d)}</td>
      <td>
        <select data-field="tech_category">${optionList(techCategories, d.tech_category)}</select>
      </td>
      <td><input type="date" data-field="announced_date" value="${d.announced_date ? d.announced_date.slice(0, 10) : ''}"></td>
      <td><a href="${d.source_url}" target="_blank" rel="noopener">Source</a></td>
      <td class="review-actions">
        <button class="approve" data-id="${d.id}" data-action="save">Save</button>
        <button class="reject" data-id="${d.id}" data-action="cancel">Cancel</button>
      </td>
    </tr>`;
}

async function loadReviewQueue() {
  if (!TAXONOMY) {
    try { TAXONOMY = await fetchJson('/api/taxonomy'); } catch (err) { console.error(err); }
  }
  const deals = await fetchJson('/api/deals?status=pending_review&limit=50');
  reviewDealsById = Object.fromEntries(deals.map((d) => [d.id, d]));
  const tbody = document.getElementById('review-tbody');
  tbody.innerHTML = deals.map(viewRow).join('');
}

document.getElementById('review-tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  const { id, action } = btn.dataset;
  const row = document.getElementById(`review-row-${id}`);

  if (action === 'edit') {
    row.outerHTML = editRow(reviewDealsById[id]);
    return;
  }
  if (action === 'cancel') {
    row.outerHTML = viewRow(reviewDealsById[id]);
    return;
  }

  btn.disabled = true;
  try {
    if (action === 'save') {
      const fields = {};
      row.querySelectorAll('[data-field]').forEach((el) => { fields[el.dataset.field] = el.value || null; });
      if (fields.amount !== null) fields.amount = Number(fields.amount);
      const updated = await fetchJson(`/api/deals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      reviewDealsById[id] = { ...reviewDealsById[id], ...updated };
      row.outerHTML = viewRow(reviewDealsById[id]);
    } else if (action === 'approve' || action === 'reject') {
      await fetchJson(`/api/deals/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: action === 'approve' ? 'approved' : 'rejected' }),
      });
      row.remove();
      loadDealFeed(); // approved deals now show in the main feed
    }
  } catch (err) {
    console.error(err);
    btn.disabled = false;
  }
});

Promise.all([loadSummary(), loadQuarterTrend(), loadTechChart(), loadGeoChart(), loadDealFeed()])
  .catch((err) => console.error('[dashboard] load failed', err));
