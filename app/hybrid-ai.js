// hybrid-ai.js — 浏览器端 Firebase AI Logic（on-device inference）
//
// 设计取舍：只用端侧。Firebase AI Logic 的 hybrid API 支持四种推理模式，
// 这里固定用 ONLY_ON_DEVICE —— 推理跑在 Chrome 内置的 Gemini Nano 上，
// 小票照片不离开设备、没有 API 调用费用、也不依赖项目的计费状态。
// 端侧不可用时（旧浏览器 / 模型未下载完）直接抛错，由 index.html 回落到
// 服务端 /api/scan，用户不会看到白屏。
//
// 依赖通过 CDN 动态 import，项目本身仍然零构建（no bundler）。

import { SYSTEM_PROMPT, USER_PROMPT, extractJson, auditReceipt } from './audit.js';

const CDN = 'https://www.gstatic.com/firebasejs/13.4.0';

let cache = null;   // { model, config, sdk }

function config() {
  const c = (typeof window !== 'undefined' && window.__FIREBASE_CONFIG__) || null;
  if (!c || !c.apiKey || String(c.apiKey).startsWith('__')) return null;
  return c;
}

/** 端侧能力探测（不依赖 Firebase，直接问 Chrome 的 Prompt API） */
export async function onDeviceAvailability() {
  if (typeof LanguageModel === 'undefined') {
    return { supported: false, state: 'unavailable', text: 'unavailable', image: 'unavailable' };
  }
  const out = { supported: true, text: 'unknown', image: 'unknown' };
  try {
    out.text = await LanguageModel.availability();
    out.image = await LanguageModel.availability({ expectedInputs: [{ type: 'image' }] });
    out.state = out.image === 'available' ? 'available' : out.image;
  } catch (e) {
    out.state = 'error';
    out.message = String(e && e.message ? e.message : e);
  }
  return out;
}

async function build() {
  if (cache) return cache;
  const cfg = config();
  if (!cfg) throw new Error('firebase config missing (app/firebase-config.js)');

  const [{ initializeApp }, ai, appCheck] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-ai.js`),
    import(`${CDN}/firebase-app-check.js`),
  ]);

  const app = initializeApp(cfg, 'billcheck');

  // App Check 在 AI Logic 上是强制校验项：即使是端侧推理，
  // SDK 初始化也会读这个配置，缺了会在开发期报错。
  if (cfg.appCheck && cfg.appCheck.siteKey) {
    const provider = cfg.appCheck.provider === 'enterprise'
      ? new appCheck.ReCaptchaEnterpriseProvider(cfg.appCheck.siteKey)
      : new appCheck.ReCaptchaV3Provider(cfg.appCheck.siteKey);
    appCheck.initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  }

  const aiInstance = ai.getAI(app, { backend: new ai.GoogleAIBackend() });

  // ONLY_ON_DEVICE：不建云端模型、不发云端请求。
  const model = ai.getGenerativeModel(aiInstance, {
    mode: ai.InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
        expectedInputs: [
          { type: 'text', languages: ['en'] },
          { type: 'image' },
        ],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      },
    },
  });

  cache = { model, config: cfg, sdk: ai };
  return cache;
}

function parts(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) throw new Error('not a data URL');
  return [
    { text: USER_PROMPT },
    { inlineData: { mimeType: m[1], data: m[2] } },
  ];
}

/**
 * 扫描一张小票（纯端侧推理）。
 * 失败时抛错，调用方负责回落到服务端。
 * @returns {Promise<{items,findings,total,dupTotal,merchant,currency,engine,source,sourceLabel}>}
 */
export async function scanReceipt(dataUrl) {
  const { model } = await build();
  const content = parts(dataUrl);

  const result = await model.generateContent(content);

  const text = result.response.text();
  const parsed = extractJson(text);
  if (!parsed) throw new Error('model returned no JSON');

  const report = auditReceipt(parsed);
  const source = result.inferenceSource || 'on_device';
  return {
    ...report,
    engine: 'on-device · Gemini Nano',
    source,
    sourceLabel: 'on-device · Gemini Nano',
  };
}
