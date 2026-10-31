/* ============ 英标：44 个音，一步一步学 ============
   内容在 content/phonetics.js（IPA、IPA_GROUPS）。依赖 app.js 里的 app, panel, detail, session, shuffle, clip, fx, showZh，
   play.js 里的 playSeq, playSeqCapped, token, player, warmAudio，speak.js 里的 esc，
   profile.js 里的 curProfile, ipaKeyOf，pages/alphabet.js 里的 bitsCount, starsHtml。

   学一个音分 4～5 步：听一听 → 嘴巴怎么动 → 例词 → 比一比（有容易混的音才有）→ 小测。
   进度只记“星星”，存在本机（每个小朋友一份，键见 profile.js 的 ipaKeyOf），不进复习算法，也不上传云端：
   每个音最多 3 颗星：1 = 学到了小测这一步   2 = 小测一次答对   4 = “听音找音标”答对过
   声音文件：audio/ph/<id>.mp3 单个音（tools/gen_phonemes.py 用 eSpeak 生成）、
            audio/phw/<词的 slug>.mp3 例词、audio/phz/<id>.mp3 口型说明（tools/gen_audio.py） */

const PH_BIT = {learned: 1, quiz: 2, game: 4};
const PH_IDS = new Set(IPA.map(s => s.id));
let PHD = {pid: null, m: {}};            // 当前小朋友的星星缓存：{音: 位}
let PH = {cur: 0, step: 0, steps: [], quizWord: 0, choices: [], missed: false, locked: false,
          rounds: [], ri: 0, stars: 0};

const phPlain = w => w.replace(/[\[\]]/g, "");
const phSlug = w => phPlain(w).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const phSnd = s => clip("ph", s.id, s.ipa, "en");                       // 单个音
const phTipClip = s => clip("phz", s.id, s.tip, "zh");                  // 口型说明
const phWordClip = w => clip("phw", phSlug(w), phPlain(w), "en");       // 例词（也用于对比词）
// 例词里把 [ ] 括起来的字母标红：p[i]g → p<红 i>g
const phWordHtml = w => w.split(/(\[[^\]]*\])/).map(p => p.charAt(0) === "[" ? `<b class="hl">${esc(p.slice(1, -1))}</b>` : esc(p)).join("");
const phById = id => IPA.find(s => s.id === id);
const phSym = s => `/${s.ipa}/`;

/* ---------- 星星的读写 ---------- */
function phData(){
  const p = typeof curProfile === "function" ? curProfile() : null, pid = p ? p.id : "";
  if(PHD.pid !== pid){
    const m = {};
    try{
      const o = JSON.parse(localStorage.getItem(ipaKeyOf(pid)));
      if(o && o.m && typeof o.m === "object") Object.keys(o.m).forEach(k => { if(PH_IDS.has(k)) m[k] = (+o.m[k] | 0) & 7; });
    }catch(e){}
    PHD = {pid, m};
  }
  return PHD.m;
}
function phMark(id, bit){
  const m = phData(), v = (m[id] || 0) | bit;
  if(!PHD.pid || v === m[id]) return;
  m[id] = v;
  try{ localStorage.setItem(ipaKeyOf(PHD.pid), JSON.stringify({v: 1, m})); }catch(e){}
}
function phTotals(){
  const m = phData();
  let learned = 0, stars = 0;
  IPA.forEach(s => { const b = m[s.id] || 0; if(b & PH_BIT.learned) learned++; stars += bitsCount(b); });
  return {learned, stars, max: IPA.length * 3};
}

/* ---------- 首页入口（alphabet.js 的 basicsHtml 里调用） ---------- */
function ipaEntryHtml(){
  const t = phTotals();
  return `
    <button class="big base" data-act="ipa">🗣️ 英标 /ɪ/ /æ/<small>学 ${IPA.length} 个音 · 学过 ${t.learned}/${IPA.length} · ⭐ ${t.stars}/${t.max}</small></button>`;
}

/* ---------- 英标表 ---------- */
function ipaPage(){
  session++; token++; player.pause();
  detail.classList.remove("show");
  const m = phData(), t = phTotals();
  const firstTodo = IPA.findIndex(s => !((m[s.id] || 0) & PH_BIT.learned));
  const go = firstTodo < 0 ? 0 : firstTodo;
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    <h2>🗣️ 英标 · 44 个音</h2>
    <div class="sub">每个音：听 → 嘴巴 → 例词 → 小测<br>学过 ${t.learned}/${IPA.length} · ⭐ ${t.stars}/${t.max}</div>
    <button class="big green" data-act="ph-open" data-i="${go}" style="margin:4px 0 8px;padding:14px">${firstTodo < 0 ? "🔁 从头再学" : (t.learned ? "▶ 接着学" : "▶ 开始学")}<small>${esc(phSym(IPA[go]))} ${esc(IPA[go].words[0][1])}</small></button>
    <button class="big blue" data-act="ph-game" style="margin:0 0 6px;padding:14px">🎮 听音找音标<small>听一个音，点出对应的音标</small></button>
    ${IPA_GROUPS.map(g => `
      <div class="sec-title">${esc(g.title)} <span class="phgz">${esc(g.zh)}</span></div>
      <div class="agrid">${IPA.map((s, i) => s.g !== g.id ? "" : `
        <div class="acard pcard ${m[s.id] ? "seen" : ""}" data-act="ph-open" data-i="${i}">
          <div class="psym">${esc(s.ipa)}</div>
          <div class="pex">${esc(phPlain(s.words[0][0]))}</div>
          <div class="astars">${starsHtml(m[s.id])}</div>
        </div>`).join("")}
      </div>`).join("")}
    <div class="footer">★ 学到小测 · ★★ 小测一次答对 · ★★★ 听音找音标答对<br>点一个音就开始学它</div>`;
  if(typeof warmAudio === "function") warmAudio(IPA.map(s => phSnd(s).url));
}

/* ---------- 学一个音 ---------- */
function phOpen(i, step){
  session++; token++; player.pause();
  detail.classList.remove("show");
  PH.cur = i;
  const s = IPA[i];
  PH.steps = ["listen", "mouth", "words"].concat(s.pair ? ["pair"] : [], ["quiz"]);
  PH.step = Math.max(0, Math.min(step | 0, PH.steps.length - 1));
  if(typeof warmAudio === "function") warmAudio([phSnd(s).url, phTipClip(s).url, ...s.words.map(w => phWordClip(w[0]).url),
    ...(s.pair ? [phWordClip(s.pair[0]).url, phWordClip(s.pair[1]).url] : [])]);
  phRender();
}
const phTop = () => `
    <div class="top"><button class="back" data-act="ipa">← 英标表</button><span></span></div>
    <div class="dots">${PH.steps.map((_, k) => k < PH.step ? "⭐" : (k === PH.step ? "🔹" : "⚪")).join("")}</div>`;
const phNextBtn = label => `<button class="big green" data-act="ph-next" style="margin-top:14px">${label || "下一步 ▶"}</button>`;

function phRender(){
  const s = IPA[PH.cur], st = PH.steps[PH.step];
  PH.missed = false; PH.locked = false;
  const head = phTop();
  if(st === "listen"){
    app.innerHTML = `${head}
      <h2>👂 听一听</h2>
      <div class="phbig">${esc(s.ipa)}</div>
      <button class="speaker" data-act="ph-snd">🔊</button>
      <div class="sub">点喇叭，多听几遍<br>先别急着学，听清楚它的声音</div>
      ${phNextBtn()}`;
    playSeq([phSnd(s)]);
  }else if(st === "mouth"){
    app.innerHTML = `${head}
      <h2>👄 嘴巴怎么动</h2>
      <div class="phbig sm">${esc(s.ipa)}</div>
      <div class="phtip">${esc(s.tip)}</div>
      <div class="row"><button data-act="ph-snd">🔊 听音</button><button data-act="ph-tip">🔊 听说明</button></div>
      <div class="sub">对着镜子，跟着学一学</div>
      ${phNextBtn()}`;
    playSeq([phSnd(s), ...(showZh() ? [phTipClip(s)] : [])]);
  }else if(st === "words"){
    app.innerHTML = `${head}
      <h2>📖 例词</h2>
      <div class="phbig sm">${esc(s.ipa)}</div>
      <div class="sub">红色的字母，就是发这个音<br>点一点，听一听</div>
      <div class="grid3">${s.words.map((w, k) => `
        <div class="card phw" data-act="ph-word" data-k="${k}">
          <div class="phword${phPlain(w[0]).length > 7 ? " lg" : ""}">${phWordHtml(w[0])}</div>
          <div class="zh">${esc(w[1])}</div>
        </div>`).join("")}
      </div>
      ${phNextBtn()}`;
    playSeq([phSnd(s), ...s.words.map(w => phWordClip(w[0]))]);
  }else if(st === "pair"){
    const o = phById(s.pair[2]);
    app.innerHTML = `${head}
      <h2>👂 比一比</h2>
      <div class="sub">这两个音听起来不一样哦<br>点一点，听一听</div>
      <div class="choices w4">
        <div class="card phw" data-act="ph-pair" data-k="0">
          <div class="phsym">${esc(s.ipa)}</div>
          <div class="phword">${esc(s.pair[0])}</div>
        </div>
        <div class="card phw" data-act="ph-pair" data-k="1">
          <div class="phsym o">${esc(o.ipa)}</div>
          <div class="phword">${esc(s.pair[1])}</div>
        </div>
      </div>
      ${phNextBtn()}`;
    playSeq([phWordClip(s.pair[0]), phWordClip(s.pair[1])]);
  }else{
    phQuiz();
  }
}

/* ---------- 小测：听单词，选出红色字母的音 ---------- */
// 3 个选项：先放“容易混的音”，再放同一组的，最后才放别的组
function phChoices(s, n){
  const pool = IPA.filter(x => x.id !== s.id);
  const first = s.pair ? pool.filter(x => x.id === s.pair[2]) : [];
  const same = shuffle(pool.filter(x => x.g === s.g && !first.includes(x)));
  const rest = shuffle(pool.filter(x => x.g !== s.g));
  return shuffle([s, ...[...first, ...same, ...rest].slice(0, n - 1)]);
}
function phQuiz(){
  const s = IPA[PH.cur];
  phMark(s.id, PH_BIT.learned);
  PH.quizWord = Math.floor(Math.random() * s.words.length);
  PH.choices = phChoices(s, 3);
  const w = s.words[PH.quizWord];
  app.innerHTML = `${phTop()}
    <h2>🎧 小测</h2>
    <div class="sub">听单词，红色字母读哪个音？</div>
    <div class="phword big">${phWordHtml(w[0])}</div>
    <button class="speaker" data-act="ph-repeat">🔊</button>
    <div class="choices w">
      ${PH.choices.map((c, k) => `<div class="card letter" data-act="ph-pick" data-k="${k}"><div class="phsym">${esc(c.ipa)}</div></div>`).join("")}
    </div>`;
  playSeq([phWordClip(w[0])]);
}
async function phPick(k, el){
  if(PH.locked) return;
  const s = IPA[PH.cur], c = PH.choices[k];
  if(c.id === s.id){
    PH.locked = true;
    el.classList.add("correct");
    if(!PH.missed) phMark(s.id, PH_BIT.quiz);
    const sess = session, once = !PH.missed;
    await playSeqCapped([fx("fx_good_en"), phSnd(s)]);
    if(sess !== session) return;
    phDone(once);
  }else{
    PH.missed = true;
    el.classList.add("wrong");
    setTimeout(() => el.classList.remove("wrong"), 500);
    playSeq([fx("fx_try_en"), phWordClip(s.words[PH.quizWord][0])]);
  }
}
function phDone(once){
  const s = IPA[PH.cur], b = phData()[s.id] || 0, t = phTotals();
  const nxt = PH.cur + 1 < IPA.length ? IPA[PH.cur + 1] : null;
  app.innerHTML = `
    <div class="top"><span></span><span></span></div>
    <h1>🎉 学会啦！</h1>
    <div class="phbig sm">${esc(s.ipa)}</div>
    <div class="stars">${"⭐".repeat(bitsCount(b)) || "🌟"}</div>
    <div class="sub">${once ? "小测一次就答对了！" : "再听几遍，下次一次答对就有更多星星"}<br>学过 ${t.learned}/${IPA.length} · ⭐ ${t.stars}/${t.max}</div>
    ${nxt ? `<button class="big blue" data-act="ph-open" data-i="${PH.cur + 1}">下一个音 ${esc(phSym(nxt))} ▶</button>` : ""}
    <button class="big green" data-act="ph-open" data-i="${PH.cur}">🔁 再学一遍</button>
    <button class="big" data-act="ipa">📋 英标表</button>`;
  playSeq([fx("fx_done_zh")]);
}

/* ---------- 听音找音标（8 题：先考还没得这颗星的音） ---------- */
function phGame(){
  session++; token++; player.pause();
  detail.classList.remove("show");
  const m = phData();
  const order = shuffle(IPA.map((_, i) => i)).sort((a, b) => ((m[IPA[a].id] || 0) & PH_BIT.game ? 1 : 0) - ((m[IPA[b].id] || 0) & PH_BIT.game ? 1 : 0));
  PH.rounds = shuffle(order.slice(0, 8));
  PH.ri = 0; PH.stars = 0;
  if(typeof warmAudio === "function") warmAudio(PH.rounds.map(i => phSnd(IPA[i]).url));
  phRound();
}
function phRound(){
  const s = IPA[PH.rounds[PH.ri]];
  PH.choices = phChoices(s, 3);
  PH.missed = false; PH.locked = false;
  const dots = PH.rounds.map((_, i) => i < PH.ri ? "⭐" : (i === PH.ri ? "🔹" : "⚪")).join("");
  app.innerHTML = `
    <div class="top"><button class="back" data-act="ipa">← 返回</button><span></span></div>
    <div class="dots">${dots}</div>
    <h2>🎧 听音，找音标</h2>
    <button class="speaker" data-act="ph-gsnd">🔊</button>
    <div class="choices w">
      ${PH.choices.map((c, k) => `<div class="card letter" data-act="ph-gpick" data-k="${k}"><div class="phsym">${esc(c.ipa)}</div></div>`).join("")}
    </div>`;
  playSeq([...(PH.ri < 2 ? [fx("fx_find_zh")] : []), phSnd(s)]);
}
async function phGamePick(k, el){
  if(PH.locked) return;
  const s = IPA[PH.rounds[PH.ri]], c = PH.choices[k];
  if(c.id === s.id){
    PH.locked = true;
    el.classList.add("correct");
    if(!PH.missed){ PH.stars++; phMark(s.id, PH_BIT.game); }
    const sess = session;
    await playSeqCapped([fx("fx_good_en"), phSnd(s), phWordClip(s.words[0][0])]);
    if(sess !== session) return;
    PH.ri++;
    PH.ri < PH.rounds.length ? phRound() : phGameFinish();
  }else{
    PH.missed = true;
    el.classList.add("wrong");
    setTimeout(() => el.classList.remove("wrong"), 500);
    playSeq([fx("fx_try_en"), phSnd(s)]);
  }
}
function phGameFinish(){
  const t = phTotals();
  app.innerHTML = `
    <div class="top"><span></span><span></span></div>
    <h1>🎉 太棒了！</h1>
    <div class="stars">${"⭐".repeat(PH.stars) || "🌟"}</div>
    <div class="sub">一次就答对 ${PH.stars} / ${PH.rounds.length} 个<br>学过 ${t.learned}/${IPA.length} · ⭐ ${t.stars}/${t.max}</div>
    <button class="big blue" data-act="ph-game">🔁 再玩一次</button>
    <button class="big base" data-act="ipa">📋 英标表</button>
    <button class="big" data-act="home">🏠 回到首页</button>`;
  playSeq([fx("fx_done_zh")]);
}

/* ---------- 事件 ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if(!t) return;
  const a = t.dataset.act;
  if(a !== "ipa" && a.indexOf("ph-") !== 0) return;
  const i = +t.dataset.i, k = +t.dataset.k, s = IPA[PH.cur];
  switch(a){
    case "ipa":      ipaPage(); break;
    case "ph-open":  phOpen(i, 0); break;
    case "ph-next":  PH.step + 1 < PH.steps.length ? (PH.step++, phRender()) : phDone(true); break;
    case "ph-snd":   playSeq([phSnd(s)]); break;
    case "ph-tip":   playSeq([phTipClip(s)]); break;
    case "ph-word":  playSeq([phWordClip(s.words[k][0])]); break;
    case "ph-pair":  playSeq([phWordClip(s.pair[k])]); break;
    case "ph-repeat": if(!PH.locked) playSeq([phWordClip(s.words[PH.quizWord][0])]); break;
    case "ph-pick":  phPick(k, t); break;
    case "ph-game":  phGame(); break;
    case "ph-gsnd":  if(!PH.locked) playSeq([phSnd(IPA[PH.rounds[PH.ri]])]); break;
    case "ph-gpick": phGamePick(k, t); break;
  }
});
