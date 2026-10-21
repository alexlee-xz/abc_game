/* ============ 小朋友账户：按名字分开保存学习记录 ============
   所有数据都先存在本机 localStorage 里（默认不上传服务器；开启云同步后由 sync.js 同步）：
   • abc_profiles_v1        账户列表 {v, cur, list:[{id, name, created, exported}]}
   • abc_srs_v1__<id>       每个小朋友一份学习记录（结构见 srs.js 的 freshSRS）
   • abc_srs_v1             旧版（没有账户时）的学习记录，第一次输入名字时并入那个账户
   本文件只管“存取和账户增删改”，不画页面；页面在 account.js。
   依赖 srs.js 里的 SRS / loadSRS / freshSRS（只在函数被调用时才用到，所以加载顺序无所谓）。 */

const PROF_KEY = "abc_profiles_v1";
const LEGACY_KEY = "abc_srs_v1";
const PROF_MAX = 6;
const NAME_MAX = 12;
const srsKeyOf = id => "abc_srs_v1__" + id;
// 传送链接（account.js）和云同步链接（sync.js）都用的 base64url 编码
const b64enc = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64dec = c => { c = c.replace(/-/g, "+").replace(/_/g, "/"); while(c.length % 4) c += "="; return decodeURIComponent(escape(atob(c))); };

// 名字：去掉控制字符和首尾空格，最多 12 个字。显示时仍要转义（见 account.js 的 escName）
function cleanName(s){
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}
const sameName = (a, b) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

function readProfiles(){
  const empty = () => ({v: 1, cur: "", list: []});
  try{
    const o = JSON.parse(localStorage.getItem(PROF_KEY));
    if(!o || !Array.isArray(o.list)) return empty();
    const seen = new Set(), list = [];
    o.list.forEach(p => {
      if(!p || typeof p.id !== "string" || !/^[\w-]{1,40}$/.test(p.id) || seen.has(p.id)) return;
      const name = cleanName(p.name);
      if(!name) return;
      seen.add(p.id);
      list.push({id: p.id, name, created: +p.created || 0, exported: +p.exported || 0});
    });
    const cur = list.some(p => p.id === o.cur) ? o.cur : (list[0] ? list[0].id : "");
    return {v: 1, cur, list: list.slice(0, PROF_MAX)};
  }catch(e){ return empty(); }
}
let PROFS = readProfiles();
function saveProfs(){ try{ localStorage.setItem(PROF_KEY, JSON.stringify(PROFS)); }catch(e){} }

const curProfile = () => PROFS.list.find(p => p.id === PROFS.cur) || null;
const profById = id => PROFS.list.find(p => p.id === id) || null;
const curKey = () => { const p = curProfile(); return p ? srsKeyOf(p.id) : null; };
const newProfId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 这台手机上有没有旧版（还没有账户时）的学习记录
function legacyRaw(){
  try{
    const raw = localStorage.getItem(LEGACY_KEY);
    const o = raw && JSON.parse(raw);
    return (o && typeof o.words === "object") ? raw : null;
  }catch(e){ return null; }
}
// 把旧记录原样复制到新账户下，读回来核对一致后才删旧的；任何一步失败都保留旧记录不动
function adoptLegacy(p){
  const raw = legacyRaw();
  if(!raw) return false;
  try{
    const key = srsKeyOf(p.id);
    localStorage.setItem(key, raw);
    if(localStorage.getItem(key) !== raw) return false;
    localStorage.removeItem(LEGACY_KEY);
    return true;
  }catch(e){ return false; }
}

// 新增账户并设为当前。返回 {ok: 账户, adopted} 或 {err: 给家长看的原因}
function createProfile(name, opts){
  opts = opts || {};
  name = cleanName(name);
  if(!name) return {err: "请先输入名字"};
  if(PROFS.list.length >= PROF_MAX) return {err: `最多 ${PROF_MAX} 个小朋友，请先在家长页删除一个`};
  if(PROFS.list.some(p => sameName(p.name, name))) return {err: "已经有这个名字啦，换一个吧"};
  const first = PROFS.list.length === 0;
  const p = {id: newProfId(), name, created: Date.now(), exported: 0};
  PROFS.list.push(p); PROFS.cur = p.id; saveProfs();
  const adopted = first && opts.adopt !== false && adoptLegacy(p);
  SRS = loadSRS();
  return {ok: p, adopted};
}
// 没有账户却要保存时（理论上不会发生）自动建一个，保证记录不丢
function ensureProfile(){
  if(curProfile()) return;
  if(PROFS.list.length){ PROFS.cur = PROFS.list[0].id; saveProfs(); return; }
  const p = {id: newProfId(), name: "小朋友", created: Date.now(), exported: 0};
  PROFS.list.push(p); PROFS.cur = p.id; saveProfs();
}
function switchProfile(id){
  if(!profById(id)) return false;
  PROFS.cur = id; saveProfs();
  SRS = loadSRS();
  try{ Q = null; S = null; }catch(e){}
  return true;
}
function renameProfile(id, name){
  const p = profById(id); name = cleanName(name);
  if(!p) return {err: "找不到这个账户"};
  if(!name) return {err: "名字不能是空的"};
  if(PROFS.list.some(x => x.id !== id && sameName(x.name, name))) return {err: "已经有这个名字啦"};
  p.name = name; saveProfs();
  if(typeof syncTouch === "function") syncTouch(id);      // 改名也要同步到云端
  return {ok: p};
}
// quiet=true：这次删除是因为云端已经删了（不要再告诉云端）
function deleteProfile(id, quiet){
  const p = profById(id);
  if(!p) return false;
  if(!quiet && typeof syncForget === "function") syncForget(id);
  PROFS.list = PROFS.list.filter(x => x.id !== id);
  try{ localStorage.removeItem(srsKeyOf(id)); }catch(e){}
  if(PROFS.cur === id){
    PROFS.cur = PROFS.list[0] ? PROFS.list[0].id : "";
    saveProfs();
    SRS = loadSRS();
    try{ Q = null; S = null; }catch(e){}
  }else saveProfs();
  return true;
}
// 云同步用：把本机的账户 id 换成云端的 id（同名的小朋友在两台设备上各建了一份时，认成同一个人）
function rekeyProfile(oldId, newId){
  const p = profById(oldId);
  if(!p || profById(newId) || !/^[\w-]{1,40}$/.test(newId)) return false;
  try{
    const raw = localStorage.getItem(srsKeyOf(oldId));
    if(raw != null){ localStorage.setItem(srsKeyOf(newId), raw); localStorage.removeItem(srsKeyOf(oldId)); }
  }catch(e){ return false; }
  p.id = newId;
  if(PROFS.cur === oldId) PROFS.cur = newId;
  saveProfs();
  return true;
}
// 云同步用：云端有、本机没有的小朋友，按云端的 id 建一个账户（不切换当前账户，除非本机还没有账户）
function adoptProfile(id, name, srs){
  if(profById(id) || !/^[\w-]{1,40}$/.test(id) || PROFS.list.length >= PROF_MAX) return null;
  const base = cleanName(name) || "小朋友";
  let nm = base, i = 2;
  while(PROFS.list.some(p => sameName(p.name, nm))) nm = cleanName(base.slice(0, NAME_MAX - 2) + i++);
  const p = {id, name: nm, created: Date.now(), exported: 0};
  PROFS.list.push(p);
  try{ localStorage.setItem(srsKeyOf(id), JSON.stringify(srs)); }catch(e){}
  if(!PROFS.cur){ PROFS.cur = id; SRS = loadSRS(); }
  saveProfs();
  return p;
}
// 读某个账户保存的学习记录（当前账户直接用内存里最新的）
function srsOf(id){
  if(id === PROFS.cur) return SRS;
  try{
    const s = JSON.parse(localStorage.getItem(srsKeyOf(id)));
    if(s && typeof s.words === "object") return normSRS(s);
  }catch(e){}
  return freshSRS();
}
