// firebase-config.js — 公开的 Firebase Web 配置（apiKey 对 Web 应用本身就是公开信息，
// 真正的访问控制在 App Check + Firebase 控制台的授权域名）。
//
// 拿到真实配置后，把下面整个对象替换成 Firebase 控制台「项目设置 → 你的应用」里给出的 config。
// 保持字段名不变，可直接粘贴。
//
// 未配置时：app 会自动回落到服务端 /api/scan（WorkBuddy 云 LLM），页面照常可用，
// 只是不会走 Firebase AI Logic。

window.__FIREBASE_CONFIG__ = null;

/* 填好后的样子（示例，勿直接使用）：
window.__FIREBASE_CONFIG__ = {
  apiKey: "AIza...",
  authDomain: "billcheck-genie.firebaseapp.com",
  projectId: "billcheck-genie",
  storageBucket: "billcheck-genie.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:abcdef123456",
  cloudModel: "gemini-2.5-flash"   // 云端回落用的模型，可省
};
*/
