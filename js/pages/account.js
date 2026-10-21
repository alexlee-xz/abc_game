/* ============ 小朋友账户页面 + 记录导入导出 + 每周小结 ============
   依赖 srs.js / profile.js 的全局，以及 app.js 里的 app, session, token, player, home。
   本文件有自己的 click / change / keydown 监听，只处理自己的 data-act。 */

const escName = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
let accWhere = "";        // 当前在哪个页面：welcome / parent（导入文件后决定回到哪里）
let accBack = "";         // 新增小朋友页面的“返回”去哪里：prof-chooser / parent
const IMPORT_INPUT = `<input type="file" id="imp" accept=".json,.txt,application/json,text/plain" style="display:none">`;
// 微信内置浏览器：不能下载文件，也和手机自带浏览器各用各的存储
const inWeChat = () => /MicroMessenger/i.test((typeof navigator !== "undefined" && navigator.userAgent) || "");

/* ---------- 首次打开 / 新增小朋友 ---------- */
function welcomePage(opts){
  opts = opts || {};
  session++; token++; try{ player.pause(); }catch(e){}
  accWhere = "welcome";
  accBack = opts.from === "parent" ? "parent" : "prof-chooser";
  const legacy = !PROFS.list.length && !!legacyRaw();
  app.innerHTML = `
    ${opts.add ? `<div class="top"><button class="back" data-act="${accBack}">← 返回</button><span></span></div>` : ""}
    <h1>${opts.add ? "🧒 新增小朋友" : "🔤 ABC 英语小游戏"}</h1>
    <div class="sub">${opts.add ? "每个小朋友有自己的学习记录" : "先认识一下吧"}</div>
    <div class="sec" style="text-align:center">
      <div style="font-size:17px; margin-bottom:8px">小朋友叫什么名字？</div>
      <input id="nm" class="nm" type="text" maxlength="${NAME_MAX}" placeholder="输入名字" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="fb err" id="nmerr"></div>
      <button class="big green" data-act="prof-create" style="margin:6px 0 0">开始学习</button>
    </div>
    <div class="note-c">${legacy ? "这台手机上已有的学习记录，会保存在这个名字下面。<br>" : ""}学习记录会自动保存在这个手机里，每个名字一份，不用手动备份。</div>
    <div class="sec" style="text-align:center">
      <div class="note">已经有记录了（比如换了手机，或在微信 / 浏览器之间换了地方）？</div>
      <button class="small-btn ghost" data-act="p-pick">📂 导入记录文件</button>
      <details${inWeChat() ? " open" : ""} style="margin-top:10px">
        <summary class="note" style="cursor:pointer">粘贴“传送链接”或记录文字</summary>
        <textarea id="bk" placeholder="把复制来的链接或文字粘贴到这里"></textarea>
        <button class="small-btn" data-act="p-import">导入</button>
      </details>
    </div>
    ${IMPORT_INPUT}`;
  setTimeout(() => { const e = document.getElementById("nm"); if(e && e.focus) try{ e.focus(); }catch(err){} }, 60);
}
function createFromInput(){
  const el = document.getElementById("nm"), er = document.getElementById("nmerr");
  const r = createProfile(el ? el.value : "");
  if(r.err){ if(er) er.textContent = r.err; return null; }
  home();
  return r;
}

/* ---------- 谁在玩 ---------- */
function nameChip(){
  const p = curProfile();
  return p ? ` <span class="chip" data-act="prof-chooser" style="cursor:pointer">🧒 ${escName(p.name)} ▾</span>` : "";
}
function chooserPage(){
  session++; token++; try{ player.pause(); }catch(e){}
  accWhere = "chooser";
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    <h2>谁在玩？</h2>
    ${PROFS.list.map(p => `<button class="big ${p.id === PROFS.cur ? "green" : "blue"}" data-act="prof-pick" data-id="${p.id}">🧒 ${escName(p.name)}</button>`).join("")}
    ${PROFS.list.length < PROF_MAX ? `<button class="big" data-act="prof-add">➕ 新增小朋友</button>` : ""}`;
}

/* ---------- 启动 ---------- */
function boot(){
  const code = incomingCode();
  if(code && transferPage(code)) return;       // 打开的是“传送链接”：先问要不要导入
  if(!PROFS.list.length){ welcomePage(); return; }
  if(!curProfile()){ PROFS.cur = PROFS.list[0].id; saveProfs(); SRS = loadSRS(); }
  home();
}

/* ---------- 导出 / 导入 ---------- */
// 记录文件格式：{app, format, name, exportedAt, data}。withLog=true 时带逐题记录（下载的文件用）；复制文字时不带（太长）
function recordText(id, withLog){
  const p = profById(id || PROFS.cur);
  if(!p) return "";
  const d = Object.assign({}, srsOf(p.id));
  if(!withLog) delete d.log;
  return JSON.stringify({app: "abc_game", format: 1, name: p.name, exportedAt: new Date().toISOString(), data: d});
}
function recordFileName(p){
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  const safe = p.name.replace(/[\\\/:*?"<>|\s]+/g, "_");
  return `abc_${safe}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
}
function downloadRecord(id){
  const p = profById(id);
  if(!p) return false;
  try{
    const blob = new Blob([recordText(id, true)], {type: "application/json"});
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = recordFileName(p); a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { try{ URL.revokeObjectURL(url); }catch(e){} }, 3000);
    p.exported = Date.now(); saveProfs();
    return true;
  }catch(e){ return false; }
}
function parseRecord(text){
  const s = String(text).trim();
  // 传送链接（整条网址，或只有 #r=... 那一段）
  const m = s.charAt(0) !== "{" && s.match(/[#&?]r=([A-Za-z0-9_-]{8,})/);
  if(m){
    const o = decodeTransfer(m[1]);
    if(!o) return {err: "传送链接不完整（可能被截断了），请重新复制整条链接"};
    return {wrapped: true, name: cleanName(o.name), data: o.data, at: o.at};
  }
  let o;
  try{ o = JSON.parse(s); }catch(e){ return {err: "内容格式不对：这不是有效的记录"}; }
  if(!o || typeof o !== "object") return {err: "内容格式不对：这不是有效的记录"};
  if(o.app === "abc_game" && o.data && typeof o.data === "object" && o.data.words && typeof o.data.words === "object")
    return {wrapped: true, name: cleanName(o.name), data: o.data};
  if(o.words && typeof o.words === "object") return {wrapped: false, name: "", data: o};     // 旧版“备份文字”
  return {err: "这不是本游戏的记录文件"};
}
// 导入：记录里有名字 → 按名字找账户（没有就新建，同名则确认后覆盖）；旧版备份没有名字 → 覆盖当前账户（没有账户就新建“小朋友”）
// opts.yes：已经在确认页上确认过了，不再弹窗询问
function importRecord(text, opts){
  const r = parseRecord(text), yes = !!(opts && opts.yes);
  if(r.err) return r;
  const data = normSRS(r.data), words = Object.keys(data.words).length;
  if(r.wrapped){
    const name = r.name || "小朋友", ex = PROFS.list.find(p => sameName(p.name, name));
    if(ex){
      if(!yes && !confirm(`已经有“${ex.name}”的记录了。导入会用文件里的记录（已学 ${words} 个词）覆盖它，确定吗？`)) return {cancel: true};
      PROFS.cur = ex.id; saveProfs(); SRS = data; saveSRS();
      return {ok: ex, mode: "overwrite", words};
    }
    const c = createProfile(name, {adopt: false});
    if(c.err) return c;
    SRS = data; saveSRS();
    return {ok: c.ok, mode: "new", words};
  }
  let p = curProfile();
  if(p){
    if(!confirm(`这份记录没有名字，导入会覆盖“${p.name}”现在的学习记录（已学 ${words} 个词），确定吗？`)) return {cancel: true};
  }else{
    const c = createProfile("小朋友", {adopt: false});
    if(c.err) return c;
    p = c.ok;
  }
  SRS = data; saveSRS();
  return {ok: p, mode: "current", words};
}
function importAndShow(text, opts){
  const r = importRecord(text, opts);
  if(r.cancel) return r;
  if(r.err){ alert("导入失败：" + r.err); return r; }
  alert(`导入成功：${r.ok.name}（已学 ${r.words} 个词）`);
  if(accWhere === "parent") parentPage(); else home();
  return r;
}
function importFileChosen(el){
  const f = el && el.files && el.files[0];
  if(!f) return;
  if(f.size > 3 * 1024 * 1024){ alert("这个文件太大了，不像是本游戏的记录"); try{ el.value = ""; }catch(e){} return; }
  const fr = new FileReader();
  fr.onload = () => { try{ el.value = ""; }catch(e){} importAndShow(String(fr.result || "")); };
  fr.onerror = () => alert("读取文件失败，请换一个文件，或用“复制文字”的办法");
  fr.readAsText(f);
}

/* ---------- 传送链接 ----------
   微信里的页面和手机自带浏览器里的页面，各有各的存储，互相看不到（静态网站也没有服务器可以同步）。
   所以做成“一键搬过去”：把某个小朋友的进度压缩进一条链接（网址 # 后面的部分，不会发给任何服务器），
   发到另一边（文件传输助手、备忘录都行），在那边打开或粘贴到地址栏，确认后导入。
   为了短，词的记录用数组存，不带逐题明细；打开时仍走 normSRS 清洗，坏数据进不来。 */
const LINK_DEFAULT = "https://alexlee-xz.github.io/abc_game/";
const WFIELDS = ["box", "due", "seen", "right", "wrong", "last", "lastGood", "rc", "fg", "lw", "born"];
const b64enc = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64dec = c => { c = c.replace(/-/g, "+").replace(/_/g, "/"); while(c.length % 4) c += "="; return decodeURIComponent(escape(atob(c))); };
function packTransfer(id){
  const p = profById(id || PROFS.cur);
  if(!p) return "";
  const d = srsOf(p.id), w = d.words || {};
  const x = {}; ["daily", "doneDays", "streak", "lastDone", "cfg", "curve", "story"].forEach(k => { if(d[k] != null) x[k] = d[k]; });
  return b64enc(JSON.stringify({v: 1, n: p.name, t: Date.now(), x, w: Object.keys(w).map(k => [k].concat(WFIELDS.map(f => w[k][f] == null ? null : w[k][f])))}));
}
// 返回 {name, at, data}；内容不对就返回 null
function decodeTransfer(code){
  try{
    const o = JSON.parse(b64dec(String(code)));
    if(!o || o.v !== 1 || !Array.isArray(o.w) || typeof o.n !== "string") return null;
    const words = {};
    o.w.slice(0, 500).forEach(r => {
      if(!Array.isArray(r) || typeof r[0] !== "string") return;
      const w = {}; WFIELDS.forEach((f, i) => { if(r[i + 1] != null) w[f] = r[i + 1]; });
      words[r[0]] = w;
    });
    const x = (o.x && typeof o.x === "object") ? o.x : {};
    return {name: o.n, at: +o.t || 0, data: Object.assign({}, x, {words})};
  }catch(e){ return null; }
}
function linkBase(){
  try{ if(typeof location !== "undefined" && /^https?:/.test(location.href)) return location.href.split("#")[0].split("?")[0]; }catch(e){}
  return LINK_DEFAULT;
}
const transferLink = id => { const c = packTransfer(id); return c ? linkBase() + "#r=" + c : ""; };

let hashHandled = false, pendingLink = "";
function incomingCode(){
  if(hashHandled) return "";
  try{ const m = typeof location !== "undefined" && /[#&]r=([A-Za-z0-9_-]+)/.exec(location.hash || ""); return m ? m[1] : ""; }catch(e){ return ""; }
}
function clearHash(){
  hashHandled = true;
  try{ history.replaceState(null, "", location.pathname + location.search); }catch(e){}
}
// 打开的是传送链接：显示确认页（返回 true）；链接坏了就提示并回到正常启动（返回 false）
function transferPage(code){
  const r = parseRecord("#r=" + code);
  clearHash();
  if(r.err){ alert(r.err); return false; }
  session++; token++; try{ player.pause(); }catch(e){}
  accWhere = "welcome";
  pendingLink = "#r=" + code;
  const d = normSRS(r.data), name = r.name || "小朋友", words = Object.keys(d.words).length;
  const ex = PROFS.list.find(p => sameName(p.name, name));
  const exWords = ex ? Object.keys(srsOf(ex.id).words).length : 0;
  const at = r.at ? new Date(r.at) : null;
  app.innerHTML = `
    <h1>📥 收到学习记录</h1>
    <div class="sec" style="text-align:center">
      <div style="font-size:22px"><b>🧒 ${escName(name)}</b></div>
      <div class="note">已学 ${words} 个词${d.streak ? `，连续打卡 ${d.streak} 天` : ""}${at ? `<br>记录生成于 ${at.getMonth() + 1} 月 ${at.getDate()} 日` : ""}</div>
      ${ex ? `<div class="note warn">这里已经有“${escName(ex.name)}”的记录（已学 ${exWords} 个词）。导入后，会被链接里的记录<b>覆盖</b>。如果这里的记录更新，请先不要导入。</div>`
           : `<div class="note">这里还没有这个名字，导入后会新建一份。</div>`}
      <button class="big green" data-act="p-hash-import">导入这份记录</button>
      <button class="big" data-act="p-hash-cancel">先不导入</button>
    </div>`;
  return true;
}

/* ---------- 复制到剪贴板（微信里 navigator.clipboard 常常不可用，所以先用 execCommand） ---------- */
async function copyFrom(id, okMsg){
  const ta = document.getElementById(id);
  if(!ta) return false;
  let ok = false;
  try{ ta.select(); ta.setSelectionRange(0, 999999); ok = document.execCommand("copy"); }catch(e){}
  if(!ok){
    try{ if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(ta.value); ok = true; } }catch(e){}
  }
  alert(ok ? okMsg : "没有自动复制成功，请长按文本框，全选后手动复制");
  return ok;
}

/* ---------- 家长页：小朋友账户 ---------- */
function exportedLabel(p){
  if(!p.exported) return "还没有导出过记录";
  const n = Math.floor((Date.now() - p.exported) / 86400000);
  return n <= 0 ? "今天导出过记录" : `上次导出记录：${n} 天前`;
}
function accountSection(){
  const cur = curProfile();
  const wx = inWeChat();
  const stale = cur && (Object.keys(SRS.words).length > 0) && (!cur.exported || Date.now() - cur.exported > 14 * 86400000);
  const rows = PROFS.list.map(p => {
    const me = p.id === PROFS.cur;
    return `<div class="prof"><div><b>🧒 ${escName(p.name)}</b>${me ? ` <span class="tag">正在使用</span>` : ""}</div>
      <div class="note">${exportedLabel(p)}</div>
      <div>${me ? "" : `<button class="small-btn" data-act="prof-switch" data-id="${p.id}">切换</button>`}
        <button class="small-btn" data-act="prof-link" data-id="${p.id}">🔗 传送链接</button>
        ${wx ? "" : `<button class="small-btn" data-act="prof-download" data-id="${p.id}">下载记录</button>`}
        <button class="small-btn ghost" data-act="prof-rename" data-id="${p.id}">改名</button>
        <button class="small-btn ghost" data-act="prof-delete" data-id="${p.id}">删除</button></div></div>`;
  }).join("");
  return `<div class="sec"><h3>小朋友账户</h3>
      <div class="note">学习记录按名字分开，<b>自动保存在这个手机的这个浏览器里</b>。注意：微信里打开的和手机自带浏览器里打开的，记录是<b>分开的</b>，不会自动同步。建议平时只用一个入口；要换入口、换手机或清理缓存前，点“传送链接”把记录搬过去。</div>
      ${wx ? `<div class="note warn">你现在是在微信里打开的：微信不支持下载文件，请用“传送链接”。</div>` : ""}
      ${stale ? `<div class="note warn">${cur.exported ? `已经超过 14 天没有导出“${escName(cur.name)}”的记录了` : `还没有导出过“${escName(cur.name)}”的记录`}，建议现在下载一份存起来。</div>` : ""}
      ${rows}
      <div class="note" style="margin-top:12px"><b>传送链接</b>：点上面某个小朋友的“传送链接”，链接会出现在下面并自动复制。把它发到另一边（比如微信的“文件传输助手”），在那边打开，或粘贴到手机浏览器的网址栏，确认后就导入了。</div>
      <textarea id="lk" readonly placeholder="点“传送链接”后，链接显示在这里"></textarea>
      <div>
        ${PROFS.list.length < PROF_MAX ? `<button class="small-btn" data-act="prof-add" data-from="parent">➕ 新增小朋友</button>` : ""}
        <button class="small-btn" data-act="p-pick">📂 导入记录文件</button>
      </div>
      <details${wx ? " open" : ""} style="margin-top:12px">
        <summary class="note" style="cursor:pointer">微信里下载不了文件？用文字也可以</summary>
        <div class="note">“复制文字”后发给自己（文件传输助手、备忘录都行）；在新设备粘贴到下面的框里，点“导入文字”（传送链接也可以直接粘贴到这里）。文字里不含逐题明细，其余进度都在。</div>
        <textarea id="bk"></textarea>
        <button class="small-btn" data-act="p-copy">复制文字</button>
        <button class="small-btn" data-act="p-import">导入文字</button>
      </details>
      <div style="margin-top:12px"><button class="small-btn ghost" data-act="p-reset">清空${cur ? "“" + escName(cur.name) + "”的" : ""}进度</button></div>
      ${IMPORT_INPUT}
    </div>`;
}
function afterParentRender(){
  accWhere = "parent";
  const bk = document.getElementById("bk"), wk = document.getElementById("wk"), lk = document.getElementById("lk");
  if(bk) bk.value = recordText(PROFS.cur, false);
  if(lk) lk.value = "";
  if(wk) wk.value = weeklyText();
}
function rerenderParent(){
  const y = (typeof window !== "undefined" && window.scrollY) || 0;
  parentPage();
  try{ window.scrollTo(0, y); }catch(e){}
}

/* ---------- 每周小结 ---------- */
// 最近 7 天（含今天）。只用已有记录算出来；旧存档没有“第一次学习日期”的词不算进“本周新认识”
function weeklyData(){
  const t = todayNum(), from = t - 6, pool = questPool(), s = srsStats();
  const checkins = new Set(SRS.doneDays.filter(d => d >= from && d <= t)).size;
  const news = pool.filter(it => { const w = SRS.words[wkey(it)]; return w && w.born != null && w.born >= from && w.born <= t; });
  const log = SRS.log.filter(r => r.d >= from && r.d <= t);
  const ok = log.filter(r => r.ok).length;
  const miss = {};
  log.filter(r => !r.ok).forEach(r => { miss[r.k] = (miss[r.k] || 0) + 1; });
  const weak = Object.keys(miss).map(k => ({it: pool.find(p => wkey(p) === k), n: miss[k]}))
    .filter(x => x.it).sort((a, b) => b.n - a.n).slice(0, 3);
  const story = Object.values(SRS.story).reduce((a, b) => a + b, 0);
  return {t, from, s, checkins, news, answers: log.length, ok, acc: log.length ? Math.round(ok / log.length * 100) : null, weak, streak: currentStreak(), story};
}
function weeklyText(){
  const w = weeklyData(), p = curProfile(), name = p ? p.name : "小朋友";
  const L = [`【${name} 的英语小结】${dayLabel(w.from)} ～ ${dayLabel(w.t)}`];
  L.push(`📅 打卡 ${w.checkins}/7 天` + (w.streak ? `，已连续 ${w.streak} 天` : ""));
  L.push(w.news.length ? `🌱 本周新认识 ${w.news.length} 个词：` + w.news.map(it => `${it.en} ${it.zh}`).join("、") : "🌱 本周没有学新词");
  L.push(`🌳 小花园：种下 ${w.s.planted}/${w.s.total} 棵，其中 🍎 ${w.s.mastered} 棵` + (w.s.thirsty ? `，${w.s.thirsty} 棵渴了（该复习）` : ""));
  L.push(w.answers ? `🎯 答题 ${w.answers} 题，一次就对 ${w.ok} 题（${w.acc}%）` : "🎯 本周还没有答题记录");
  if(w.weak.length) L.push("🔁 容易错的词：" + w.weak.map(x => `${x.it.en} ${x.it.zh}（错 ${x.n} 次）`).join("、"));
  else if(w.answers) L.push("🔁 本周没有反复答错的词，很棒！");
  if(w.story) L.push(`📖 听故事排顺序：累计完成 ${w.story} 次`);
  const tipIts = [];
  w.weak.forEach(x => tipIts.push(x.it));
  w.news.forEach(it => { if(!tipIts.includes(it)) tipIts.push(it); });
  if(tipIts.length) L.push("💡 周末在生活里用一用：\n" + tipIts.slice(0, 3).map(it => `• ${it.en}：${tipOf(it)}`).join("\n"));
  const adv = [];
  if(w.checkins < 4) adv.push(`本周打卡 ${w.checkins} 天，每天几分钟比周末集中学更管用，可以固定在饭后或睡前。`);
  if(w.answers >= 20 && w.acc < 70) adv.push("一次就对的比例偏低，可以在家长页把“每天新词数”调少一点，先把学过的词巩固住。");
  if(w.answers >= 20 && w.acc >= 95 && w.news.length) adv.push("正确率很高，孩子有余力的话，可以把“每天新词数”调多一点。");
  if(w.s.thirsty >= 5) adv.push(`有 ${w.s.thirsty} 棵小树渴了，先复习浇水再学新词，记得更牢。`);
  L.push("📌 " + (adv.length ? adv.slice(0, 2).join("") : "继续保持，每天一点点就很好！"));
  return L.join("\n");
}
function weeklySection(){
  return `<div class="sec"><h3>每周小结</h3>
      <div class="note" style="margin-top:0">最近 7 天的学习情况，点下面的按钮复制，再打开微信粘贴发送（发给家人或老师都行）。</div>
      <textarea id="wk" readonly style="height:210px; font-size:13px"></textarea>
      <button class="small-btn" data-act="p-copy-wk">复制，发到微信</button>
    </div>`;
}

/* ---------- 事件 ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if(!t) return;
  const id = t.dataset.id;
  switch(t.dataset.act){
    case "prof-create":   createFromInput(); break;
    case "prof-chooser":  chooserPage(); break;
    case "prof-add":      welcomePage({add: true, from: t.dataset.from}); break;
    case "prof-pick":     if(switchProfile(id)) home(); break;
    case "prof-switch":   if(switchProfile(id)) rerenderParent(); break;
    case "prof-download": {
      const ok = downloadRecord(id);
      alert(ok ? "已开始下载记录文件。如果没有反应（微信里常见），请展开下面的“微信里下载不了文件？”，复制文字发给自己，或用手机自带的浏览器打开本页再下载。"
               : "生成文件失败，请改用下面的“复制文字”。");
      rerenderParent();
      break;
    }
    case "prof-rename": {
      const p = profById(id);
      if(!p) break;
      const v = prompt("新名字（最多 " + NAME_MAX + " 个字）：", p.name);
      if(v === null) break;
      const r = renameProfile(id, v);
      if(r.err) alert(r.err);
      rerenderParent();
      break;
    }
    case "prof-delete": {
      const p = profById(id);
      if(!p) break;
      if(!confirm(`确定删除“${p.name}”的全部学习记录吗？建议先“下载记录”。此操作不能撤销。`)) break;
      deleteProfile(id);
      if(!PROFS.list.length) boot(); else rerenderParent();
      break;
    }
    case "prof-link": {
      const p = profById(id), lk = document.getElementById("lk");
      if(!p || !lk) break;
      lk.value = transferLink(id);
      p.exported = Date.now(); saveProfs();
      copyFrom("lk", `已复制“${p.name}”的传送链接。发到另一边打开就能导入。`);
      break;
    }
    case "p-hash-import": {
      const r = importAndShow(pendingLink, {yes: true});
      if(r && r.ok) pendingLink = "";
      break;
    }
    case "p-hash-cancel": pendingLink = ""; boot(); break;
    case "p-pick":        { const f = document.getElementById("imp"); if(f && f.click) f.click(); break; }
    case "p-copy":        copyFrom("bk", "已复制，可以发给自己保存"); break;
    case "p-copy-wk":     copyFrom("wk", "已复制，打开微信粘贴发送就行"); break;
    case "p-import": {
      const ta = document.getElementById("bk");
      importAndShow(ta ? ta.value : "");
      break;
    }
  }
});
document.addEventListener("change", e => {
  const el = e.target;
  if(el && el.id === "imp") importFileChosen(el);
});
document.addEventListener("keydown", e => {
  if(e && e.key === "Enter" && e.target && e.target.id === "nm") createFromInput();
});
