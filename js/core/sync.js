/* ============ 云同步（客户端）：本机优先，云端只是中转 ============
   学习记录始终先存在本机 localStorage（离线也能玩）；开启云同步后，这里负责：
     • 答题保存后几秒内把改动上传（syncTouch → 防抖 → syncNow）
     • 打开页面 / 切回前台 / 每 30 秒拉一次云端的新内容
     • 两边都改过时按规则合并（mergeSRS），不是谁覆盖谁
   云端是 cloud/worker.mjs（Cloudflare Worker + D1），用“同步码”识别家庭，不需要注册账号。
   本文件只管数据，不画页面；页面在 pages/cloud.js。依赖 profile.js、srs.js（normSRS 等）。 */

const SYNC_KEY = "abc_sync_v1";
// 部署好 Cloudflare Worker 后，把它的地址填在这里（如 "https://abc-sync.xxx.workers.dev"），
// 这样家长页里就不用每台设备再输入一遍。留空也行，家长页会让你填。
const SYNC_URL = "";
const SYNC_PUSH_MS = 4000, SYNC_PUSH_MAXWAIT = 12000, SYNC_POLL_MS = 30000, SYNC_TIMEOUT_MS = 15000;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", CODE_LEN = 20;     // 去掉了容易看错的 0 O 1 I L

const cleanUrl = s => { s = String(s || "").trim().replace(/\/+$/, ""); return /^https?:\/\/[^\s\/?#]+(\/[^\s?#]*)?$/.test(s) ? s : ""; };
const normCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const validCode = c => c.length === CODE_LEN && /^[A-Z0-9]+$/.test(c);
const fmtCode = c => c.replace(/(.{4})(?=.)/g, "$1-");
function newSyncCode(){
  const b = new Uint8Array(CODE_LEN);
  try{ crypto.getRandomValues(b); }catch(e){ for(let i = 0; i < CODE_LEN; i++) b[i] = Math.floor(Math.random() * 256); }
  return Array.from(b, x => CODE_CHARS[x % CODE_CHARS.length]).join("");
}

/* ---------- 合并 ---------- */
// 键排好序再转文字：内容相同就得到相同文字（用来判断“两边是不是一样”）
function stableStr(o){
  if(Array.isArray(o)) return "[" + o.map(stableStr).join(",") + "]";
  if(o && typeof o === "object") return "{" + Object.keys(o).sort().map(k => JSON.stringify(k) + ":" + stableStr(o[k])).join(",") + "}";
  return JSON.stringify(o);
}
// 同一个词两边都有记录：改动时间新的赢；没有时间（旧记录）就比作答次数，再比最近作答日；全一样时取固定的一边，保证两台设备合并出同一个结果
function newerWord(a, b){
  if(a.updated != null && b.updated != null && a.updated !== b.updated) return a.updated > b.updated ? a : b;
  const act = w => (w.right || 0) + (w.wrong || 0);
  if(act(a) !== act(b)) return act(a) > act(b) ? a : b;
  if((a.last || 0) !== (b.last || 0)) return (a.last || 0) > (b.last || 0) ? a : b;
  return stableStr(a) >= stableStr(b) ? a : b;
}
// 逐题记录：两边相同的条目只留一份，各自多出来的都保留。
// 结果按（日期、内容）排成固定顺序：两台设备合并出的结果完全一样，否则会因为顺序不同而互相上传个没完
function mergeLog(la, lb){
  const key = r => [r.d, r.k, r.ok, r.n, r.ms, r.c, r.p].join("|");
  const pool = new Map(), out = la.slice();
  la.forEach(r => pool.set(key(r), (pool.get(key(r)) || 0) + 1));
  lb.forEach(r => { const k = key(r), c = pool.get(k) || 0; if(c > 0) pool.set(k, c - 1); else out.push(r); });
  return out.map(r => [key(r), r]).sort((p, q) => p[1].d - q[1].d || (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0)).map(x => x[1]).slice(-LOG_MAX);
}
/* 合并两份学习记录（x、y 任意顺序，结果相同）：
   • 词：逐个词比，改动时间新的赢（见 newerWord）；只有一边有的都保留
   • 打卡日：取并集；连续天数跟着“最近打卡”更新的那一边
   • 设置：设置最后改动时间（cfgAt）新的一边赢
   • 遗忘曲线：每档取样本多的一边；故事：每个取较大次数；逐题记录：见 mergeLog
   • “清空进度 / 覆盖导入”（resetAt）：更早的那一边只保留清空之后又学的词，旧记录不会被合并回来 */
function mergeSRS(x, y){
  let a = normSRS(x), b = normSRS(y);
  if(a.resetAt !== b.resetAt){
    const aNew = a.resetAt > b.resetAt, R = aNew ? a.resetAt : b.resetAt, old = aNew ? b : a, keep = {};
    Object.keys(old.words).forEach(k => { const w = old.words[k]; if(w.updated != null && w.updated >= R) keep[k] = w; });
    const stale = normSRS({words: keep, cfg: old.cfg, cfgAt: old.cfgAt, resetAt: old.resetAt});
    if(aNew) b = stale; else a = stale;
  }
  const r = freshSRS();
  r.resetAt = Math.max(a.resetAt, b.resetAt);
  const words = {};
  new Set(Object.keys(a.words).concat(Object.keys(b.words))).forEach(k => {
    const wa = a.words[k], wb = b.words[k];
    words[k] = !wa ? wb : !wb ? wa : newerWord(wa, wb);
  });
  r.words = words;
  const da = a.daily, db = b.daily;
  if(da.day !== db.day) r.daily = JSON.parse(JSON.stringify(da.day > db.day ? da : db));
  else{
    const news = [...new Set(da.news.concat(db.news))].sort().slice(0, 50);
    r.daily = {day: da.day, newCount: Math.max(da.newCount, db.newCount, news.length), done: da.done || db.done, news};
  }
  r.doneDays = [...new Set(a.doneDays.concat(b.doneDays))].sort((p, q) => p - q).slice(-60);
  const sa = (a.lastDone > b.lastDone || (a.lastDone === b.lastDone && a.streak >= b.streak)) ? a : b;
  r.streak = sa.streak; r.lastDone = sa.lastDone;
  const cs = a.cfgAt !== b.cfgAt ? (a.cfgAt > b.cfgAt ? a : b) : (stableStr(a.cfg) >= stableStr(b.cfg) ? a : b);
  r.cfg = cs.cfg; r.cfgAt = cs.cfgAt;
  r.curve = a.curve.map((pa, i) => { const pb = b.curve[i]; return (pa[0] > pb[0] || (pa[0] === pb[0] && pa[1] >= pb[1])) ? pa.slice() : pb.slice(); });
  const story = {};
  new Set(Object.keys(a.story).concat(Object.keys(b.story))).forEach(k => { story[k] = Math.max(a.story[k] || 0, b.story[k] || 0); });
  r.story = story;
  r.log = mergeLog(a.log, b.log);
  return normSRS(r);
}
// 两份记录“内容是否一样”的签名：键顺序、逐题记录的排列顺序都不影响
function srsSig(s){
  const c = Object.assign({}, normSRS(s));
  c.log = mergeLog(c.log, []);
  return stableStr(c);
}

/* ---------- 同步状态（存在本机，不上传） ----------
   url/code  云服务地址、同步码；空 code = 没开启
   rev       每个小朋友“我已经合并到的云端版本号”
   dirty     本机有改动、还没上传成功的小朋友
   del       本机删除了、还没告诉云端的小朋友 */
function readSync(){
  const s = {url: SYNC_URL, code: "", rev: {}, dirty: {}, del: {}, last: 0, err: ""};
  try{
    const o = JSON.parse(localStorage.getItem(SYNC_KEY));
    if(o && typeof o === "object"){
      if(!SYNC_URL && cleanUrl(o.url)) s.url = cleanUrl(o.url);
      if(validCode(normCode(o.code))) s.code = normCode(o.code);
      ["rev", "dirty", "del"].forEach(f => {
        if(!o[f] || typeof o[f] !== "object" || Array.isArray(o[f])) return;
        Object.keys(o[f]).forEach(id => { if(/^[\w-]{1,40}$/.test(id)) s[f][id] = f === "rev" ? Math.max(0, intOr(o[f][id], 0)) : 1; });
      });
      s.last = Math.max(0, intOr(o.last, 0));
    }
  }catch(e){}
  return s;
}
let SYNC = readSync();
const syncSave = () => { try{ localStorage.setItem(SYNC_KEY, JSON.stringify(SYNC)); }catch(e){} };
const syncOn = () => !!(SYNC.url && SYNC.code);
const syncSeq = {};                  // 每个小朋友“本次打开后改动了几次”：上传期间又有新改动时，不能把“有改动”的标记清掉
let syncBusy = false, syncAgain = false, syncTimer = 0, syncTimerAt = 0, syncPollId = 0;

function syncEnable(url, code){
  SYNC.url = SYNC_URL || cleanUrl(url);
  SYNC.code = normCode(code);
  SYNC.rev = {}; SYNC.dirty = {}; SYNC.del = {}; SYNC.last = 0; SYNC.err = "";
  syncSave(); syncStartPoll();
}
function syncLeave(){
  SYNC.code = ""; SYNC.rev = {}; SYNC.dirty = {}; SYNC.del = {}; SYNC.last = 0; SYNC.err = "";
  if(syncTimer){ clearTimeout(syncTimer); syncTimer = 0; }
  syncSave();
}
// 本机有改动（saveSRS / 改名时调用）：标记并在几秒后上传。连续答题时最多拖 12 秒
function syncTouch(id){
  if(!syncOn() || !id) return;
  syncSeq[id] = (syncSeq[id] || 0) + 1;
  if(!SYNC.dirty[id]){ SYNC.dirty[id] = 1; syncSave(); }
  syncSoon(SYNC_PUSH_MS);
}
// 本机删除了一个小朋友：记下来，下次同步时通知云端（其他设备同步时会跟着删）
function syncForget(id){
  if(!syncOn()) return;
  SYNC.del[id] = 1; delete SYNC.dirty[id]; syncSave(); syncSoon(1000);
}
function syncSoon(ms){
  if(!syncOn()) return;
  if(syncTimer){
    if(Date.now() - syncTimerAt > SYNC_PUSH_MAXWAIT) return;
    clearTimeout(syncTimer);
  }else syncTimerAt = Date.now();
  syncTimer = setTimeout(() => { syncTimer = 0; syncNow(); }, ms);
}
function syncStartPoll(){
  if(syncPollId || typeof setInterval === "undefined") return;
  syncPollId = setInterval(() => {
    if(syncOn() && !(typeof document !== "undefined" && document.visibilityState === "hidden")) syncNow();
  }, SYNC_POLL_MS);
}

/* ---------- 和云端通信 ---------- */
async function syncApi(method, path, body){
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  const tm = ac ? setTimeout(() => ac.abort(), SYNC_TIMEOUT_MS) : 0;
  try{
    const h = {"X-Family": SYNC.code};
    if(body) h["Content-Type"] = "application/json";
    const r = await fetch(SYNC.url + path, {method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: ac ? ac.signal : undefined, cache: "no-store"});
    let j = {};
    try{ j = await r.json(); }catch(e){}
    return {status: r.status, ok: r.ok, j: j || {}};
  }catch(e){
    return {status: 0, ok: false, j: {}};
  }finally{
    if(tm) clearTimeout(tm);
  }
}
function syncErr(r){
  const s = r.status;
  return new Error(s === 0 ? "连不上云端（网络不好，稍后会自动重试）"
    : s === 401 ? "同步码不对" : s === 403 ? "云端不允许这个网址访问"
    : s === 413 ? "记录太大，无法上传" : s === 429 ? "请求太频繁，稍后再试"
    : s >= 500 ? "云端暂时出错，稍后会自动重试" : "云端拒绝了请求（" + s + "）");
}
const kidPath = id => "/api/kid/" + encodeURIComponent(id);

// 把合并结果写回本机（不走 saveSRS：这不是孩子的新操作，不需要再标记“有改动”）
function applyLocal(id, srs){
  try{ localStorage.setItem(srsKeyOf(id), JSON.stringify(srs)); }catch(e){}
  if(id === PROFS.cur){ SRS = srs; CFG_SNAP[srsKeyOf(id)] = JSON.stringify(normCfg(srs.cfg)); }
}
function removeLocal(id, out){
  if(profById(id)){ deleteProfile(id, true); out.removed++; out.changedCur = true; }
  delete SYNC.rev[id]; delete SYNC.dirty[id];
}

// 同步一个小朋友：需要时先拉取并合并，再把合并结果上传（版本冲突就重来）
async function syncKid(id, c, out){
  if(c && c.deleted){ removeLocal(id, out); return; }
  let cloudRev = c ? c.rev : 0;
  if(!profById(id)){
    if(!c) return;
    const r = await syncApi("GET", kidPath(id));
    if(!r.ok) throw syncErr(r);
    if(r.j.deleted) return;
    if(adoptProfile(id, r.j.name, normSRS(r.j.data && r.j.data.srs))){
      SYNC.rev[id] = r.j.rev; out.pulled++;
      if(id === PROFS.cur) out.changedCur = true;
    }
    return;
  }
  let dirty = !!SYNC.dirty[id] || !c;
  for(let n = 0; n < 4; n++){
    if(cloudRev > 0 && cloudRev !== (SYNC.rev[id] || 0)){
      const r = await syncApi("GET", kidPath(id));
      if(!r.ok) throw syncErr(r);
      if(r.j.deleted){ removeLocal(id, out); return; }
      const theirs = normSRS(r.j.data && r.j.data.srs);
      const mine = srsOf(id);                      // 等网络回来之后再取本机最新的，期间孩子答的题不会丢
      const merged = mergeSRS(mine, theirs);
      if(srsSig(merged) !== srsSig(mine)){
        applyLocal(id, merged); out.pulled++;
        if(id === PROFS.cur) out.changedCur = true;
      }
      if(srsSig(merged) !== srsSig(theirs)) dirty = true;
      const p = profById(id), cn = cleanName(r.j.name);
      if(p && cn && cn !== p.name && !SYNC.dirty[id] && !PROFS.list.some(x => x.id !== id && sameName(x.name, cn))){
        p.name = cn; saveProfs(); out.changedCur = true;
      }
      SYNC.rev[id] = cloudRev = r.j.rev;
    }
    if(!dirty) return;
    const seq = syncSeq[id] || 0;
    const q = await syncApi("PUT", kidPath(id), {base: cloudRev, name: profById(id).name, data: {v: 1, srs: srsOf(id)}});
    if(q.ok){
      SYNC.rev[id] = q.j.rev; out.pushed++;
      if((syncSeq[id] || 0) === seq) delete SYNC.dirty[id];
      return;
    }
    if(q.status !== 409) throw syncErr(q);
    if(q.j.deleted){ removeLocal(id, out); return; }
    cloudRev = q.j.rev || 0;                       // 别的设备刚写过：回到循环开头，拉取、合并后再传
    if(cloudRev === 0) SYNC.rev[id] = 0;
  }
  throw new Error("云端数据一直在变化，稍后会自动重试");
}

async function syncRun(){
  const out = {pulled: 0, pushed: 0, removed: 0, cloudKids: 0, changedCur: false};
  for(const id of Object.keys(SYNC.del)){
    const r = await syncApi("DELETE", kidPath(id));
    if(!r.ok) throw syncErr(r);
    delete SYNC.del[id]; delete SYNC.rev[id]; delete SYNC.dirty[id];
  }
  const L = await syncApi("GET", "/api/kids");
  if(!L.ok) throw syncErr(L);
  const cloud = {};
  (L.j.kids || []).forEach(k => { if(k && typeof k.id === "string") cloud[k.id] = k; });
  out.cloudKids = Object.keys(cloud).filter(id => !cloud[id].deleted).length;
  // 云端有、本机没有这个 id，但本机有一个同名且从没同步过的小朋友：认成同一个人（换 id 后合并，不会出现两个同名账户）
  Object.keys(cloud).forEach(id => {
    const c = cloud[id];
    if(c.deleted || profById(id)) return;
    const loc = PROFS.list.find(p => SYNC.rev[p.id] === undefined && !cloud[p.id] && sameName(p.name, c.name));
    if(loc && rekeyProfile(loc.id, id)){ SYNC.dirty[id] = 1; delete SYNC.dirty[loc.id]; out.changedCur = true; }
  });
  const ids = new Set(Object.keys(cloud).concat(PROFS.list.map(p => p.id)));
  for(const id of ids) await syncKid(id, cloud[id], out);
  return out;
}

// 检查一个云服务地址能不能连上（开启同步前先试一下，地址填错了马上能知道）
async function syncPing(url){
  try{
    const r = await fetch(url + "/api/ping", {cache: "no-store"});
    const j = await r.json();
    return !!(j && j.ok);
  }catch(e){ return false; }
}

// 立即同步一次（同一时间只跑一个；跑的时候又有新改动，跑完再来一次）。返回结果对象，出错时有 err
async function syncNow(){
  if(!syncOn()) return {skip: true};
  if(syncBusy){ syncAgain = true; return {busy: true}; }
  syncBusy = true; syncAgain = false;
  let res;
  try{
    res = await syncRun();
    SYNC.err = ""; SYNC.last = Date.now();
  }catch(e){
    SYNC.err = (e && e.message) || "同步失败";
    res = {err: SYNC.err};
  }
  syncBusy = false; syncSave();
  try{ if(typeof onSyncDone === "function") onSyncDone(res); }catch(e){}
  if(syncAgain){ syncAgain = false; syncSoon(500); }
  return res;
}

/* ---------- 给页面用的小工具 ---------- */
function syncStatusText(){
  if(!syncOn()) return "未开启";
  if(syncBusy) return "🔄 正在同步…";
  const wait = Object.keys(SYNC.dirty).length;
  if(SYNC.err) return "⚠️ " + SYNC.err + (wait ? "（本机有改动等待上传，已保存在本机，不会丢）" : "");
  if(!SYNC.last) return "还没有同步过";
  const d = new Date(SYNC.last), pad = n => String(n).padStart(2, "0");
  return `✅ 已同步（${pad(d.getHours())}:${pad(d.getMinutes())}）` + (wait ? "，有改动等待上传" : "");
}
// “加入链接”：打开后会问要不要加入这个家庭的云同步（链接里带着云服务地址和同步码）
const syncLink = () => syncOn() ? linkBase() + "#s=" + b64enc(JSON.stringify({u: SYNC.url, c: SYNC.code})) : "";
// 家长输入的可能是加入链接，也可能只是同步码。返回 {url, code}（只有同步码时 url 为空），无效返回 null
function parseSyncInput(text){
  const s = String(text || "").trim();
  const m = /[#&?]s=([A-Za-z0-9_-]{8,})/.exec(s);
  if(m){
    try{
      const o = JSON.parse(b64dec(m[1])), code = normCode(o && o.c);
      if(validCode(code)) return {url: cleanUrl(o.u), code};
    }catch(e){}
    return null;
  }
  const code = normCode(s);
  return validCode(code) ? {url: "", code} : null;
}

/* ---------- 自动触发 ---------- */
if(typeof document !== "undefined" && document.addEventListener){
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") syncSoon(300); });
}
if(typeof window !== "undefined" && window.addEventListener) window.addEventListener("online", () => syncSoon(500));
if(syncOn()){ syncStartPoll(); syncSoon(800); }       // 打开页面：稍等一下（让首页先显示出来）就拉一次
