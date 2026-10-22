/* ============ 字母 A–Z：认字母、听名字、找一找 ============
   内容在 content/alphabet.js（ALPHABET）。依赖 app.js 里的 app, panel, detail, session, shuffle, clip, fx, showZh，
   play.js 里的 playSeq, token, player, warmAudio，speak.js 里的 esc，profile.js 里的 curProfile, alphaKeyOf。

   进度只记“星星”，存在本机（每个小朋友一份，键见 profile.js 的 alphaKeyOf），不进复习算法，也不上传云端：
   每个字母最多 3 颗星，用 3 个二进制位表示：
     1 = 认过（点开看过）   2 = “听名字找字母”答对过   4 = “听单词找开头字母”答对过 */

const ALPHA_BIT = {seen: 1, name: 2, word: 4};
const ALPHA_IDS = new Set(ALPHABET.map(L => L.id));
let ALPHA = {pid: null, m: {}};          // 当前小朋友的星星缓存：{字母: 位}
let AL = {cur: 0, rounds: [], ri: 0, stars: 0, missed: false, locked: false, choices: []};

const bitsCount = b => ((b & 1) ? 1 : 0) + ((b & 2) ? 1 : 0) + ((b & 4) ? 1 : 0);
const letClip = L => clip("let", L.id, L.say, "en");        // 字母名
const letWordClip = L => clip("letw", L.id, L.word, "en");  // 例词（英文）
const letZhClip = L => clip("letz", L.id, L.zh, "zh");      // 例词（中文）

/* ---------- 星星的读写 ---------- */
function alphaData(){
  const p = typeof curProfile === "function" ? curProfile() : null, pid = p ? p.id : "";
  if(ALPHA.pid !== pid){
    const m = {};
    try{
      const o = JSON.parse(localStorage.getItem(alphaKeyOf(pid)));
      if(o && o.m && typeof o.m === "object") Object.keys(o.m).forEach(k => { if(ALPHA_IDS.has(k)) m[k] = (+o.m[k] | 0) & 7; });
    }catch(e){}
    ALPHA = {pid, m};
  }
  return ALPHA.m;
}
function alphaMark(id, bit){
  const m = alphaData(), v = (m[id] || 0) | bit;
  if(!ALPHA.pid || v === m[id]) return;
  m[id] = v;
  try{ localStorage.setItem(alphaKeyOf(ALPHA.pid), JSON.stringify({v: 1, m})); }catch(e){}
}
function alphaTotals(){
  const m = alphaData();
  let letters = 0, stars = 0;
  ALPHABET.forEach(L => { const b = m[L.id] || 0; if(b) letters++; stars += bitsCount(b); });
  return {letters, stars, max: ALPHABET.length * 3};
}
const starsHtml = b => `${"★".repeat(bitsCount(b))}<i>${"★".repeat(3 - bitsCount(b))}</i>`;
const letterHtml = L => `<div class="ab"><span class="up">${L.id.toUpperCase()}</span><span class="lo">${L.id}</span></div>`;
// 例词里高亮开头的字母（apple → 红色的 a + pple）
const wordHtml = L => `<b class="hl">${esc(L.word.charAt(0))}</b>${esc(L.word.slice(1))}`;

/* ---------- 首页入口（quest.js 的 homeQuestHtml 里调用） ---------- */
function basicsHtml(){
  const t = alphaTotals();
  return `
    <div class="sec-title">🔤 打基础</div>
    <button class="big blue" data-act="alpha">🔤 字母 A–Z<small>认识 ${t.letters}/${ALPHABET.length} 个 · ⭐ ${t.stars}/${t.max}</small></button>${typeof ipaEntryHtml === "function" ? ipaEntryHtml() : ""}`;
}

/* ---------- 字母表 ---------- */
function alphaPage(){
  session++; token++; player.pause();
  detail.classList.remove("show");
  const m = alphaData(), t = alphaTotals();
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    <h2>🔤 字母 A–Z</h2>
    <div class="sub">点一个字母，听名字，看例词<br>认识 ${t.letters}/${ALPHABET.length} 个 · ⭐ ${t.stars}/${t.max}</div>
    <button class="big green" data-act="al-game" style="margin:4px 0 10px;padding:14px">🎮 找字母<small>听一听，点出对应的字母</small></button>
    <div class="agrid">${ALPHABET.map((L, i) => `
      <div class="acard ${m[L.id] ? "seen" : ""}" data-act="al-open" data-i="${i}">
        ${letterHtml(L)}
        <div class="astars">${starsHtml(m[L.id])}</div>
      </div>`).join("")}
    </div>
    <div class="footer">★ 认过 · ★★ 听名字找对 · ★★★ 听单词找对开头字母</div>`;
  if(typeof warmAudio === "function") warmAudio(ALPHABET.map(L => letClip(L).url));
}

/* ---------- 一个字母的详情 ---------- */
function alphaOpen(i){
  AL.cur = i;
  const L = ALPHABET[i];
  alphaMark(L.id, ALPHA_BIT.seen);
  const tile = document.querySelector(`.acard[data-i="${i}"]`);       // 底下的字母表原地更新星星
  if(tile){ tile.classList.add("seen"); const s = tile.querySelector(".astars"); if(s) s.innerHTML = starsHtml(alphaData()[L.id]); }
  panel.innerHTML = `
    <div class="alp">${letterHtml(L)}</div>
    <div class="emoji">${L.emoji}</div>
    <div class="en">${wordHtml(L)}</div>
    <div class="zh">${esc(L.zh)}</div>
    <div class="row">
      <button class="ghost" data-act="al-prev">◀</button>
      <button data-act="al-name">🔊 字母</button>
      <button data-act="al-word">🔊 单词</button>
      <button class="ghost" data-act="al-next">▶</button>
    </div>
    <div class="row"><button class="ghost" data-act="al-close">关闭</button></div>`;
  detail.classList.add("show");
  alphaSay();
}
function alphaSay(){
  const L = ALPHABET[AL.cur];
  playSeq([letClip(L), letWordClip(L), ...(showZh() ? [letZhClip(L)] : [])]);
}

/* ---------- 找字母（8 题：先考还没得星的字母） ---------- */
function alphaGame(){
  session++;
  detail.classList.remove("show");
  const m = alphaData();
  const order = shuffle(ALPHABET.map((_, i) => i)).sort((a, b) => bitsCount(m[ALPHABET[a].id] || 0) - bitsCount(m[ALPHABET[b].id] || 0));
  AL.rounds = shuffle(order.slice(0, 8)).map(i => {
    const b = m[ALPHABET[i].id] || 0;
    return {i, type: !(b & ALPHA_BIT.name) ? "n" : (!(b & ALPHA_BIT.word) ? "w" : (Math.random() < 0.5 ? "n" : "w"))};
  });
  AL.ri = 0; AL.stars = 0;
  if(typeof warmAudio === "function") warmAudio(AL.rounds.flatMap(r => [letClip(ALPHABET[r.i]).url, letWordClip(ALPHABET[r.i]).url]));
  alphaRound();
}
const alphaPrompt = r => r.type === "n" ? [letClip(ALPHABET[r.i])] : [letWordClip(ALPHABET[r.i])];
function alphaRound(){
  const r = AL.rounds[AL.ri], L = ALPHABET[r.i];
  AL.choices = shuffle([L, ...shuffle(ALPHABET.filter(x => x.id !== L.id)).slice(0, 2)]);
  AL.missed = false; AL.locked = false;
  const dots = AL.rounds.map((_, i) => i < AL.ri ? "⭐" : (i === AL.ri ? "🔹" : "⚪")).join("");
  app.innerHTML = `
    <div class="top"><button class="back" data-act="alpha">← 返回</button><span></span></div>
    <div class="dots">${dots}</div>
    <h2>${r.type === "n" ? "🎧 听名字，找字母" : "🎧 听单词，找开头字母"}</h2>
    ${r.type === "w" ? `<div class="emoji" style="font-size:80px">${L.emoji}</div>` : ""}
    <button class="speaker" data-act="al-repeat">🔊</button>
    <div class="choices w">
      ${AL.choices.map((c, i) => `<div class="card letter" data-act="al-choose" data-i="${i}">${letterHtml(c)}</div>`).join("")}
    </div>`;
  playSeq([...(AL.ri < 2 ? [fx("fx_find_zh")] : []), ...alphaPrompt(r)]);
}
async function alphaChoose(i, el){
  if(AL.locked) return;
  const r = AL.rounds[AL.ri], L = ALPHABET[r.i], c = AL.choices[i];
  if(c.id === L.id){
    AL.locked = true;
    el.classList.add("correct");
    if(!AL.missed){ AL.stars++; alphaMark(L.id, r.type === "n" ? ALPHA_BIT.name : ALPHA_BIT.word); }
    const s = session;
    await playSeqCapped([fx("fx_good_en"), letClip(L), letWordClip(L)]);
    if(s !== session) return;
    AL.ri++;
    AL.ri < AL.rounds.length ? alphaRound() : alphaFinish();
  }else{
    AL.missed = true;
    el.classList.add("wrong");
    setTimeout(() => el.classList.remove("wrong"), 500);
    playSeq([fx("fx_try_en"), ...alphaPrompt(r)]);
  }
}
function alphaFinish(){
  const t = alphaTotals();
  app.innerHTML = `
    <div class="top"><span></span><span></span></div>
    <h1>🎉 太棒了！</h1>
    <div class="stars">${"⭐".repeat(AL.stars) || "🌟"}</div>
    <div class="sub">一次就答对 ${AL.stars} / ${AL.rounds.length} 个<br>认识 ${t.letters}/${ALPHABET.length} 个字母 · ⭐ ${t.stars}/${t.max}</div>
    <button class="big blue" data-act="al-game">🔁 再玩一次</button>
    <button class="big green" data-act="alpha">🔤 看字母表</button>
    <button class="big" data-act="home">🏠 回到首页</button>`;
  playSeq([fx("fx_done_zh")]);
}

/* ---------- 事件 ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if(!t) return;
  const i = +t.dataset.i, n = ALPHABET.length;
  switch(t.dataset.act){
    case "alpha":     alphaPage(); break;
    case "al-open":   alphaOpen(i); break;
    case "al-prev":   alphaOpen((AL.cur - 1 + n) % n); break;
    case "al-next":   alphaOpen((AL.cur + 1) % n); break;
    case "al-name":   playSeq([letClip(ALPHABET[AL.cur])]); break;
    case "al-word":   { const L = ALPHABET[AL.cur]; playSeq([letWordClip(L), ...(showZh() ? [letZhClip(L)] : [])]); break; }
    case "al-close":  detail.classList.remove("show"); token++; player.pause(); break;
    case "al-game":   alphaGame(); break;
    case "al-repeat": if(!AL.locked) playSeq(alphaPrompt(AL.rounds[AL.ri])); break;
    case "al-choose": alphaChoose(i, t); break;
  }
});
