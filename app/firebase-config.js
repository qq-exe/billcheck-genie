// firebase-config.js — 公开的 Firebase Web 配置（apiKey 对 Web 应用本身就是公开信息，
// 真正的访问控制在 App Check + Firebase 控制台的授权域名）。
//
// 项目：billcheck-genie（Spark 免费计划）
// 推理模式：Firebase AI Logic + InferenceMode.ONLY_ON_DEVICE
//   → 推理跑在 Chrome 内置的 Gemini Nano 上，不调用云端 Gemini，
//     因此不需要 Blaze 计划、不需要绑定结算账号，也不产生 API 费用。
// 端侧不可用时：app 自动回落到服务端 /api/scan，页面照常可用。

window.__FIREBASE_CONFIG__ = {
  apiKey: "AIzaSyA4UU66GVgLTMy519hdh8zZsJ8-LhHY1mE",
  authDomain: "billcheck-genie.firebaseapp.com",
  projectId: "billcheck-genie",
  storageBucket: "billcheck-genie.firebasestorage.app",
  messagingSenderId: "697066343375",
  appId: "1:697066343375:web:4cbafb6b34768aed0f60ba",
  // App Check（Firebase 自 2026-11-02 起对 AI Logic 强制要求）
  // provider: "enterprise" = Google Cloud Fraud Defense（原 reCAPTCHA Enterprise）
  appCheck: {
    provider: "enterprise",
    siteKey: "6Lc-dTAuAAAAAK6AdshKOAl2GX1LY1K2l0YKEmrO"
  }
};

// 本地调试 App Check（只在你自己机器上有效）：把控制台打印的 token 贴到
// Firebase 控制台 → App Check → 应用 → 管理调试令牌。生产域名请改用 reCAPTCHA v3。
// self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
