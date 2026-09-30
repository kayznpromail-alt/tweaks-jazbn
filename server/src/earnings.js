// What a customer payment leaves us: price paid − retail cost of its tokens at the provider,
// then the profit split between partners. Amounts are in euros; shares are rounded up to the cent.

const upCents = (n) => Math.ceil(Math.round(n * 1e6) / 1e4) / 100;

/** Parses "edgey:60,kayzn:40" into [{ name, percent }]. */
export function parseSplit(input) {
  return String(input)
    .split(',')
    .map((part) => part.split(':').map((s) => s.trim()))
    .filter(([name, pct]) => name && Number(pct) > 0)
    .map(([name, pct]) => ({ name, percent: Number(pct) }));
}

/** Retail cost: the tokens at the provider's price, or what a manual sale cost us (in € or $). */
export function earningsFor({ eur, tokens = 0, costUsd = null, costEur: fixedEur = null }, e) {
  const usd = costUsd != null ? costUsd : (tokens / 1e6) * e.costUsdPerMillion;
  const costEur = fixedEur != null ? Math.round(fixedEur * 100) / 100 : upCents(usd / e.usdPerEur);
  const profitEur = Math.round((eur - costEur) * 100) / 100;
  return {
    costEur,
    profitEur,
    split: e.split.map((s) => ({ ...s, eur: profitEur > 0 ? upCents((profitEur * s.percent) / 100) : 0 })),
  };
}

/** Totals for a list of payments ({ eur, tokens }). */
export function sumEarnings(rows, e) {
  const total = { payments: 0, revenueEur: 0, costEur: 0, profitEur: 0, split: e.split.map((s) => ({ ...s, eur: 0 })) };
  for (const row of rows) {
    const one = earningsFor(row, e);
    total.payments += 1;
    total.revenueEur += row.eur;
    total.costEur += one.costEur;
    total.profitEur += one.profitEur;
    one.split.forEach((s, i) => (total.split[i].eur += s.eur));
  }
  const cents = (n) => Math.round(n * 100) / 100;
  return {
    ...total,
    revenueEur: cents(total.revenueEur),
    costEur: cents(total.costEur),
    profitEur: cents(total.profitEur),
    split: total.split.map((s) => ({ ...s, eur: cents(s.eur) })),
  };
}
