/** Snapshot-only valuation: comparable market caps anchor an explicitly hypothetical score. */
export type Protocol = {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
};
export type Snapshot = { as_of: string; source: string; floor_usd: number; watchlist: string[]; protocols: Protocol[] };
export const AS_OF = '2026-11-14';
export const constants = { multiple_min: 0.05, multiple_max: 5, growth_min: -0.5, growth_max: 1, maturity_floor: 0.5, maturity_days: 730 };
export const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x));
export const slugOrder = (a: {slug: string}, b: {slug: string}) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
export const numeric = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const categoryKey = (p: Protocol) => p.category || 'Uncategorized';
export function median(values: number[]): number {
  if (!values.length) throw new Error('No listed comparables in snapshot');
  const ordered = [...values].sort((a, b) => a - b), mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
}
export function ageDays(date: string | null): number | null {
  if (!date) return null;
  const stamp = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(stamp) ? Math.max(0, Math.floor((Date.parse(AS_OF + 'T00:00:00Z') - stamp) / 86400000)) : null;
}
export function rankable(p: Protocol): boolean {
  const releaseSuffix = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  return !numeric(p.mcap_usd) && !p.gecko_id && !p.symbol && p.category !== 'CEX' && !releaseSuffix.test(p.name);
}
export function parseInput(text: string): Snapshot {
  const s = JSON.parse(text);
  if (s.as_of !== AS_OF || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw new Error('Expected sealed 2026-11-14 snapshot');
  const ids = new Set<string>();
  for (const p of s.protocols) {
    if (!p.slug || ids.has(p.slug) || typeof p.name !== 'string' || !numeric(p.tvl_usd) || p.tvl_usd <= 0 || !Array.isArray(p.chains)) throw new Error('Invalid or duplicate protocol');
    ids.add(p.slug);
  }
  if (s.watchlist.some((slug: unknown) => typeof slug !== 'string' || !ids.has(slug))) throw new Error('Unknown watchlist slug');
  return s;
}
export function comparables(protocols: Protocol[]) {
  const listed = protocols.filter(p => numeric(p.mcap_usd));
  const globalMedian = median(listed.map(p => p.mcap_usd! / p.tvl_usd));
  const categories = Object.fromEntries([...new Set(protocols.map(categoryKey))].sort().map(category => {
    const peers = listed.filter(p => categoryKey(p) === category);
    const raw = peers.length ? median(peers.map(p => p.mcap_usd! / p.tvl_usd)) : globalMedian;
    return [category, { count: peers.length, raw_median: raw, multiple: clamp(raw, constants.multiple_min, constants.multiple_max), fallback: peers.length === 0 }];
  }));
  return { global_median: globalMedian, categories };
}
export function score(p: Protocol, multiple: number) {
  const age = ageDays(p.listed_at);
  const growth = 1 + clamp((p.change_7d ?? 0) / 100, constants.growth_min, constants.growth_max);
  const maturity = constants.maturity_floor + (1 - constants.maturity_floor) * Math.min(1, (age ?? 0) / constants.maturity_days);
  return { age, growth, maturity, value: Math.round(p.tvl_usd * multiple * growth * maturity) };
}
function categoryAction(category: string, capital: number): [string, string] {
  const c = category.toLowerCase();
  if (/uncollateralized|rwa|cedefi|otc/.test(c)) return [`Check eligibility, custody and redemption documents before allocating up to $${capital}; if public access or identity requirements cannot be met, observe only.`, 'Request redemption using the issuer procedure; allow for settlement windows and check the cash actually arrives.'];
  if (/lend|cdp|collateral/.test(c)) return [`Supply up to $${capital} of a supported asset after checking utilization and caps; avoid borrowing during this trial so no liquidation threshold is introduced.`, 'Repay any debt first, then withdraw collateral; check available liquidity and revoke unused approvals.'];
  if (/bridge/.test(c)) return [`Test a $10 supported transfer between documented chains; only move the remaining $${Math.max(0, capital - 10)} after confirming the destination balance and return route.`, 'Bridge back through the documented return route, retaining native gas on both chains; confirm finality before revoking approvals.'];
  if (/staking|staked/.test(c)) return [`Stake up to $${capital} of the documented underlying asset; record the receipt exchange rate, validator exposure and unbonding queue before signing.`, 'Request unstaking, wait the published unbonding period, then redeem receipts; compare secondary-market exit slippage first.'];
  if (/dex|liquidity|farm/.test(c)) return [`Test a $10 swap, then consider up to $${capital} in a supported liquid pool; inspect price range, pool fees and impermanent loss rather than chasing volume.`, 'Remove liquidity, collect fees, swap residual assets only within a chosen slippage limit and revoke the pool allowance.'];
  if (/derivative|options|prediction|basis/.test(c)) return [`Read settlement and liquidation rules; fund at most $${capital} and test only a $10 fully collateralized position if available. Skip leverage and stop if loss cannot be bounded.`, 'Close positions or wait for documented settlement, cancel open orders, then withdraw all available margin or proceeds.'];
  if (/stable|reserve/.test(c)) return [`Inspect collateral backing and the redemption route, then test minting or depositing at most $${capital} of an eligible asset; do not assume a stable asset holds its peg.`, 'Redeem through the documented route; check fees, queues and peg deviation before converting the remaining balance.'];
  if (/yield|vault|curator|allocator|indexes/.test(c)) return [`Inspect a public vault strategy, underlying venues and withdrawal terms; deposit at most $${capital} only if permissionless access and supported collateral are confirmed.`, 'Redeem vault shares, allowing for any cooldown or queue; verify underlying tokens received and revoke stale allowances.'];
  if (/insurance/.test(c)) return [`Compare exclusions and claim conditions; request a small cover quote within a $${capital} budget and buy only coverage you actually need.`, 'Check cancellation terms or let cover expire; redeem any refundable balance and retain policy evidence.'];
  return [`Inspect the documented ${category} workflow and identify its smallest reversible action within a $${capital} budget; simulate first and observe only if no safe public action exists.`, 'Reverse the tested action using the documented withdrawal or cancellation flow; verify balances and remove unused permissions.'];
}
export function farmPlan(p: Protocol, age: number | null): string[] {
  const capital = p.tvl_usd >= 1e9 ? 150 : p.tvl_usd >= 1e8 ? 100 : 50;
  const chain = p.chains[0] || 'the documented deployment';
  const gas = chain === 'Ethereum' ? '$5–25' : '$1–5';
  const window = age === null || age < 180 ? 30 : 14;
  const [action, exit] = categoryAction(categoryKey(p), capital);
  return [
    `Verify ${p.name}'s official deployment on ${chain}, audit history and withdrawal terms. Snapshot TVL is $${Math.round(p.tvl_usd).toLocaleString('en-US')}; TVL is not a safety guarantee. Cost: $0. Time: 20 minutes.`,
    `Prepare a separate wallet on ${chain} with at most $${capital} trial capital and ${gas} native gas reserve. Check every spender and use exact approval amounts; never enter a seed phrase in an app. Cost: gas only if funding. Time: 10 minutes.`,
    `${action} Cost: up to $${capital} exposed capital plus ${gas} estimated gas and quoted fees; abort if fees exceed your budget. Time: 15–25 minutes.`,
    `Review balances and withdrawal availability over ${window} days; listing age is ${age === null ? 'unknown' : age + ' days'}. Log receipts and fees; stop on contract changes or unexplained losses. Cost: capital opportunity cost, $0 for read-only checks. Time: 10 minutes weekly.`,
    `What to watch: inspect official points rules, governance proposals and eligibility announcements weekly. Record published criteria; no points, token launch or allocation is promised. Avoid repetitive transactions just to manufacture activity. Cost: $0 to read. Time: 10 minutes weekly.`,
    `How to exit: ${exit} Test a small withdrawal before increasing exposure. Cost: reserve ${gas} gas plus quoted exit fees. Time: 15 minutes to request; completion follows the protocol's published queue.`
  ];
}
export function buildModel(snapshot: Snapshot) {
  const peers = comparables(snapshot.protocols);
  const rows = snapshot.protocols.filter(rankable).map(p => {
    const peer = peers.categories[categoryKey(p)], s = score(p, peer.multiple);
    return { ...p, rank: 0, token_status: 'pre-token', age_days: s.age, implied_value_usd: s.value,
      model: { base_multiple: peer.multiple, category_multiple: peer.multiple, growth_pct: (s.growth - 1) * 100, growth_multiplier: s.growth, maturity_multiplier: s.maturity, age_days: s.age, comparable_count: peer.count, global_fallback: peer.fallback },
      farm_steps: farmPlan(p, s.age) };
  }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || slugOrder(a, b));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const present = new Set(rows.map(r => r.slug));
  if (snapshot.watchlist.some(s => !present.has(s))) throw new Error('Rankability and watchlist conflict');
  if (rows.length < 100 || rows.length > 4000) throw new Error('Board size outside contract');
  if (new Set(rows.map(row => row.implied_value_usd)).size < 2) throw new Error('Model must distinguish values');
  for (const row of rows) {
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.farm_steps.length < 3 || row.farm_steps.length > 12 || row.farm_steps.some(s => s.length < 20 || s.length > 600)) throw new Error(`Invalid row: ${row.slug}`);
  }
  return { board: { rows }, data: { model_version: 'radar-2', as_of: snapshot.as_of, source: snapshot.source, watchlist: snapshot.watchlist, constants, peers, rows, protocols: snapshot.protocols } };
}
