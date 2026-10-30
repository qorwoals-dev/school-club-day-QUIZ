import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

export const configured = Boolean(
  firebaseConfig &&
  firebaseConfig.databaseURL &&
  !firebaseConfig.databaseURL.includes("YOUR_")
);

let offset = 0;
// 서버 시간 기준 현재 시각 (모든 폰의 타이머를 맞추기 위함)
export const serverNow = () => Date.now() + offset;

export async function initFirebase() {
  const appMod = await import(`${SDK}/firebase-app.js`);
  const dbMod = await import(`${SDK}/firebase-database.js`);
  const app = appMod.initializeApp(firebaseConfig);
  const db = dbMod.getDatabase(app);
  dbMod.onValue(dbMod.ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
  return { ...dbMod, db };
}
