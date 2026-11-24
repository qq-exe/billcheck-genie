// hybrid-ai.js — 浏览器端 Firebase AI Logic（hybrid inference）
//
// 端侧优先：可用时用 Chrome 内置 Gemini Nano（Prompt API）在设备上推理，
// 不可用时由 SDK 自动回落到云端 Gemini。两条路都跑同一个 prompt 与 JSON 解析。
//
// 依赖通过 CDN 动态 import，项目本身仍然零构建（no bundler）。

import { SYSTEM_PROMPT, USER_PROMPT, extractJson, auditReceipt } from './audit.js';

const CDN = 'https://www.gstatic.com/firebasejs/13.4.0';
const DEFAULT_CLOUD_MODEL = 'gemini-2.5-flash';

let cache = null;   // { hybrid, cloudOnly, config }

function config() {
  const c = (typeof window !== 'undefined' && window.__FIREBASE_CONFIG__) || null;
  if (!c || !c.apiKey || String(c.apiKey).startsWith('__')) return null;
  return c;
}

/** 端侧模型可用性（不依赖 Firebase，直接问 Chrome 的 Prompt API） */
export async function onDeviceAvailability() {
  if (typeof LanguageModel === 'undefined') return { supported: false, state: 'unavailable' };
  try {
    const state = await LanguageModel.availability();
    return { supported: true, state };
  } catch (e) {
    return { supported: true, state: 'error', message: String(e && e.message ? e.message : e) };
  }
}

async function build() {
  if (cache) return cache;
  const cfg = config();
  if (!cfg) throw new Error('firebase config missing (app/firebase-config.js)');

  const [{ initializeApp }, ai] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-ai.js`),
  ]);

  const app = initializeApp(cfg, 'billcheck');
  const aiInstance = ai.getAI(app, { backend: new ai.GoogleAIBackend() });

  const cloudModel = cfg.cloudModel || DEFAULT_CLOUD_MODEL;
  const hybrid = ai.getGenerativeModel(aiInstance, {
    mode: ai.InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      },
    },
    inCloudParams: {
      model: cloudModel,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 1200,
      },
    },
  });

  const cloudOnly = ai.getGenerativeModel(aiInstance, {
    model: cloudModel,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 1200 },
  });

  cache = { hybrid, cloudOnly, config: cfg, sdk: ai };
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

function sourceLabel(src) {
  if (src === 'on_device') return 'on-device · Gemini Nano';
  if (src === 'in_cloud') return 'cloud · Gemini';
  return 'unknown';
}

/**
 * 扫描一张小票。
 * @returns {Promise<{items,findings,total,dupTotal,merchant,currency,engine,source,sourceLabel}>}
 */
export async function scanReceipt(dataUrl) {
  const { hybrid, cloudOnly } = await build();
  const content = parts(dataUrl);

  let result;
  try {
    result = await hybrid.generateContent(content);
  } catch (err) {
    // 端侧失败（模型未下载 / 浏览器不支持多模态输入）→ 显式再走一次纯云端
    if (typeof console !== 'undefined') console.warn('[hybrid] on-device path failed, retrying in cloud:', err && err.message);
    result = await cloudOnly.generateContent(content);
    result.__fallbackReason = String((err && err.message) || err);
  }

  const text = result.response.text();
  const parsed = extractJson(text);
  if (!parsed) throw new Error('model returned no JSON');

  const report = auditReceipt(parsed);
  const source = result.inferenceSource || 'in_cloud';
  return {
    ...report,
    engine: sourceLabel(source),
    source,
    sourceLabel: sourceLabel(source),
    fallbackReason: result.__fallbackReason || null,
  };
}
