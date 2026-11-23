// server.mjs — BillCheck Genie 支付服务端（支付宝 AI 网页应用收款集成）
// alipay.trade.page.pay + 交易查询 + 退款 + 退款查询 + 关闭交易 + 异步通知 + 同步回跳
import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// alipay-sdk 在不同版本下可能是 ESM 命名导出或 CommonJS，做兼容加载
const _sdkMod = await import('alipay-sdk');
const AlipaySdk = _sdkMod.AlipaySdk || _sdkMod.default?.AlipaySdk || _sdkMod.default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 支付配置：优先环境变量（云部署），回退本地 alipay.config.json ----
function loadPayConfig() {
  const envCfg = {
    appId: process.env.ALIPAY_APP_ID,
    privateKey: process.env.ALIPAY_PRIVATE_KEY,
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY,
    gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
  };
  if (envCfg.appId && envCfg.privateKey && envCfg.alipayPublicKey) return envCfg;
  const cfgPath = path.join(__dirname, 'alipay.config.json');
  if (!existsSync(cfgPath)) return null;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (!cfg.appId || !cfg.privateKey || !cfg.alipayPublicKey) return null;
    return cfg;
  } catch {
    return null;
  }
}

const PAY_CONFIG = loadPayConfig();
let alipaySdk = null;
if (PAY_CONFIG) {
  alipaySdk = new AlipaySdk({
    appId: PAY_CONFIG.appId,
    privateKey: PAY_CONFIG.privateKey,
    alipayPublicKey: PAY_CONFIG.alipayPublicKey,
    gateway: PAY_CONFIG.gateway || 'https://openapi.alipay.com/gateway.do',
    signType: 'RSA2',
  });
}

const PUBLIC_BASE_URL = PAY_CONFIG?.publicBaseUrl || '';
// 托管平台用 sharecode 做访问门禁，回跳地址需带上，否则付款后落到“链接不完整”页
const RETURN_SHARE_CODE = process.env.RETURN_SHARE_CODE || PAY_CONFIG?.shareCode || '';

// ---- 订单持久化（JSON 文件；生产建议换 DB） ----
const ORDERS_FILE = path.join(process.env.DATA_DIR || __dirname, '.orders.json');
function loadOrders() {
  try { return JSON.parse(readFileSync(ORDERS_FILE, 'utf8')); } catch { return {}; }
}
function saveOrders(o) { try { writeFileSync(ORDERS_FILE, JSON.stringify(o, null, 2)); } catch {} }
const orders = loadOrders();

function newOrderNo() {
  return 'BCG' + Date.now() + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'app')));

// 健康检查
app.get('/health', (_req, res) => res.json({ ok: true, payConfigured: !!alipaySdk }));

// ---- 下单：返回支付宝收银台 HTML 表单 ----
app.post('/api/pay/create', (req, res) => {
  if (!alipaySdk) {
    return res.status(503).json({
      error: 'payment_not_configured',
      message: '缺少支付配置（ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY）',
    });
  }
  const outTradeNo = newOrderNo();
  const totalAmount = '0.50';
  const subject = '账单精灵完整核查报告';
  orders[outTradeNo] = {
    out_trade_no: outTradeNo,
    total_amount: totalAmount,
    subject,
    status: 'WAIT_BUYER_PAY',
    created_at: new Date().toISOString(),
    paid_at: null,
    trade_no: null,
    notified: false,
  };
  saveOrders(orders);

  const requestOptions = {
    method: 'POST',
    returnUrl: (PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`) + '/return'
      + (RETURN_SHARE_CODE ? `?sharecode=${encodeURIComponent(RETURN_SHARE_CODE)}` : ''),
    bizContent: {
      out_trade_no: outTradeNo,
      total_amount: totalAmount,
      subject,
      product_code: 'FAST_INSTANT_TRADE_PAY',
    },
  };
  const notifyUrl = (process.env.ALIPAY_NOTIFY_URL || '').trim();
  if (notifyUrl) requestOptions.notifyUrl = notifyUrl;

  try {
    // 注意：pageExec(method, params) 只有两个参数，POST 需通过 params.method 指定
    const paymentHtml = alipaySdk.pageExec('alipay.trade.page.pay', requestOptions);
    res.json({ out_trade_no: outTradeNo, paymentHtml });
  } catch (e) {
    res.status(500).json({ error: 'create_failed', message: (e?.message || '').slice(0, 200) });
  }
});

// ---- 支付状态（前端轮询 + 主动查单兜底） ----
app.get('/api/pay/status', async (req, res) => {
  const no = String(req.query.out_trade_no || '');
  const o = orders[no];
  if (!o) return res.status(404).json({ error: 'order_not_found' });
  if (o.status === 'TRADE_SUCCESS' || o.status === 'TRADE_FINISHED') {
    return res.json({ status: o.status, paid: true, trade_no: o.trade_no });
  }
  if (!alipaySdk) return res.status(503).json({ error: 'payment_not_configured' });
  try {
    const r = await alipaySdk.exec('alipay.trade.query', { bizContent: { out_trade_no: no } });
    const t = r?.alipay_trade_query_response || r || {};
    // SDK 可能返回 snake_case 或 camelCase，两种都兼容
    const status = t.trade_status || t.tradeStatus || '';
    const tradeNo = t.trade_no || t.tradeNo || null;
    if (status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED') {
      if (!o.paid_at) {
        o.status = status;
        o.paid_at = new Date().toISOString();
        o.trade_no = tradeNo;
        saveOrders(orders);
      }
      return res.json({ status, paid: true, trade_no: tradeNo });
    }
    return res.json({ status: status || o.status, paid: false });
  } catch (e) {
    const msg = e?.message || '';
    if (/TRADE_NOT_EXIST/i.test(msg)) return res.json({ status: o.status, paid: false });
    return res.json({ status: o.status, paid: false, query_error: msg.slice(0, 120) });
  }
});

// ---- 同步回跳结果页（不信任回跳参数） ----
app.get('/return', (req, res) => {
  const no = String(req.query.out_trade_no || req.query.out_biz_no || '');
  res.type('html').send(`<!DOCTYPE html><html lang="zh"><meta charset="UTF-8">
<title>支付结果 · 账单精灵</title>
<body style="font:16px/1.7 system-ui,'Microsoft YaHei';max-width:520px;margin:60px auto;text-align:center">
<h2>🧾 账单精灵</h2><p id="st">正在确认支付结果…</p><p style="color:#888;font-size:13px">订单号：${no || '—'}</p>
<a href="/" style="display:inline-block;margin-top:18px;color:#1677ff">返回首页</a>
<script>
const no=${JSON.stringify(no)};
if(!no){document.getElementById('st').textContent='缺少订单号，请从支付页重试';}
else{const t=setInterval(async()=>{
  try{const r=await fetch('/api/pay/status?out_trade_no='+encodeURIComponent(no));
  const j=await r.json();
  if(j.paid){clearInterval(t);document.getElementById('st').innerHTML='✅ 支付成功，完整核查报告已解锁';}}
  catch(e){}},3000);}
</script></body>`);
});

// ---- 异步通知（POST 表单；验签 → 字段校验 → 幂等） ----
app.post('/notify', async (req, res) => {
  try {
    const params = req.body;
    if (!alipaySdk) return res.send('fail');
    const ok = alipaySdk.checkNotifySign(params);
    if (!ok) return res.send('fail');
    if (params.app_id !== PAY_CONFIG.appId) return res.send('fail');
    const o = orders[params.out_trade_no];
    if (!o) return res.send('fail');
    if (Number(params.total_amount) !== Number(o.total_amount)) return res.send('fail');
    const isPaymentEvent = !params.out_biz_no && !params.gmt_refund && !params.refund_fee;
    const paidStatus = params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED';
    if (paidStatus && isPaymentEvent && !o.paid_at) {
      o.status = params.trade_status;
      o.paid_at = new Date().toISOString();
      o.trade_no = params.trade_no || null;
      o.notified = true;
      saveOrders(orders);
    }
    res.send('success');
  } catch {
    res.send('fail');
  }
});

// ---- 退款 ----
app.post('/api/pay/refund', async (req, res) => {
  if (!alipaySdk) return res.status(503).json({ error: 'payment_not_configured' });
  const { out_trade_no, refund_amount } = req.body || {};
  const o = orders[out_trade_no];
  if (!o || !o.paid_at) return res.status(404).json({ error: 'order_not_paid' });
  if (!refund_amount || Number(refund_amount) <= 0) return res.status(400).json({ error: 'invalid_refund_amount' });
  if (Number(refund_amount) > Number(o.total_amount)) return res.status(400).json({ error: 'refund_exceeds_paid' });
  const outRequestNo = o.refund_request_no || (out_trade_no + 'R1');
  try {
    const r = await alipaySdk.exec('alipay.trade.refund', {
      bizContent: { out_trade_no, refund_amount: String(refund_amount), out_request_no: outRequestNo },
    });
    const t = r?.alipay_trade_refund_response || r || {};
    if (t.code !== '10000') return res.status(502).json({ error: t.sub_msg || t.subMsg || t.msg || 'refund_failed', code: t.code });
    const fundChange = t.fund_change || t.fundChange || 'N';
    o.refund_request_no = outRequestNo;
    o.fund_change = fundChange;
    saveOrders(orders);
    return res.json({ code: t.code, fund_change: fundChange, out_request_no: outRequestNo });
  } catch (e) {
    res.status(502).json({ error: (e?.message || 'refund_error').slice(0, 150) });
  }
});

// ---- 退款查询 ----
app.get('/api/pay/refund/status', async (req, res) => {
  if (!alipaySdk) return res.status(503).json({ error: 'payment_not_configured' });
  const { out_trade_no, out_request_no } = req.query;
  const o = orders[String(out_trade_no)];
  if (!o || !o.refund_request_no) return res.status(404).json({ error: 'no_refund_record' });
  try {
    const r = await alipaySdk.exec('alipay.trade.fastpay.refund.query', {
      bizContent: { out_trade_no, out_request_no: String(out_request_no || o.refund_request_no) },
    });
    const t = r?.alipay_trade_fastpay_refund_query_response || r || {};
    const rs = t.refund_status || t.refundStatus || 'PENDING';
    return res.json({ refund_status: rs, success: rs === 'REFUND_SUCCESS' });
  } catch (e) {
    res.status(502).json({ error: (e?.message || 'refund_query_error').slice(0, 150) });
  }
});

// ---- 关闭交易 ----
app.post('/api/pay/close', async (req, res) => {
  if (!alipaySdk) return res.status(503).json({ error: 'payment_not_configured' });
  const { out_trade_no } = req.body || {};
  const o = orders[out_trade_no];
  if (!o) return res.status(404).json({ error: 'order_not_found' });
  if (o.paid_at) return res.status(400).json({ error: 'order_already_paid' });
  try {
    const r = await alipaySdk.exec('alipay.trade.close', { bizContent: { out_trade_no } });
    const t = r?.alipay_trade_close_response || r || {};
    if (t.code !== '10000') return res.status(502).json({ error: t.sub_msg || t.msg || 'close_failed', code: t.code });
    o.status = 'TRADE_CLOSED';
    saveOrders(orders);
    res.json({ code: t.code, status: 'TRADE_CLOSED' });
  } catch (e) {
    res.status(502).json({ error: (e?.message || 'close_error').slice(0, 150) });
  }
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`BillCheck Genie on :${PORT}`);
  console.log(`pay config: ${PAY_CONFIG ? 'loaded (appId=' + PAY_CONFIG.appId + ')' : 'MISSING'}`);
});
