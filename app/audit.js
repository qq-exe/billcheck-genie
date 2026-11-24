// audit.js — 唯一一份审计逻辑，浏览器与 Node 服务端共用（ESM）
// 只做算术：重复行、合计对不上。不猜市场价，所以不会编造结论。

export const SYSTEM_PROMPT = [
  'You are a receipt auditor. You read a photo of a shopping receipt and return strict JSON only.',
  'Never invent line items that are not visible. If a value is unreadable use null.',
  'Output schema: {"merchant":string|null,"currency":string,"items":[{"name":string,"qty":number,"unit_price":number|null,"amount":number}],"total":number|null}',
].join(' ');

export const USER_PROMPT = [
  'Read every line item on this receipt photo.',
  'Return JSON only, no prose, no markdown fences.',
  'Schema: {"merchant","currency","items":[{"name","qty","unit_price","amount"}],"total"}',
  'Use the printed line amount when present; otherwise qty * unit_price. Unreadable values must be null.',
].join(' ');

export function extractJson(text) {
  const s = String(text || '').replace(/```json/gi, '```');
  const fenced = s.match(/```([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : s;
  const m = candidate.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export function auditReceipt(receipt) {
  const items = ((receipt && receipt.items) || []).filter(i => i && i.name);
  const groups = new Map();
  const findings = [];
  let dupTotal = 0;

  for (const it of items) {
    const k = String(it.name).toLowerCase().replace(/\s+/g, ' ').trim();
    groups.set(k, (groups.get(k) || []).concat([it]));
  }
  for (const [, g] of groups) {
    if (g.length > 1) {
      const unit = Number(g[0].amount ?? g[0].unit_price ?? 0) || 0;
      dupTotal += unit * (g.length - 1);
      findings.push({ ok: false, text: `Possible duplicate: "${g[0].name}" appears ${g.length} times (x${unit.toFixed(2)}).` });
    }
  }

  const sum = items.reduce((a, it) => a + (Number(it.amount) || 0), 0);
  const total = Number(receipt && receipt.total);
  if (Number.isFinite(total) && total > 0 && Math.abs(sum - total) > 0.05) {
    findings.push({ ok: false, text: `Line items do not add up: items sum to ${sum.toFixed(2)}, printed total is ${total.toFixed(2)}.` });
  }
  if (!findings.length) {
    findings.push({ ok: true, text: `No duplicates found: ${items.length} line items reconcile with the printed total.` });
  }

  return {
    items,
    findings,
    sum: Number(sum.toFixed(2)),
    total: Number.isFinite(total) ? total : Number(sum.toFixed(2)),
    dupTotal: Number(dupTotal.toFixed(2)),
    merchant: (receipt && receipt.merchant) || null,
    currency: (receipt && receipt.currency) || 'CNY',
  };
}
