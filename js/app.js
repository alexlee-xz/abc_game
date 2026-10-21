/* ============ 入口：首页、学一学、玩一玩、启动 ============
   页面和流程在 js/pages/ 里，语音在 js/audio/ 里，存档和复习算法在 js/core/ 里。这个文件最后一行调用 boot()。 */
/* 语音播放（player / playSeq / 预加载）在 play.js 里。这里只放“怎么拼出一段语音”。 */
const clip = (kind, id, text, lang) => ({url:`audio/${kind}/${id}.mp3`, text, lang});
// 一个词/句子可能用到的全部语音地址（用来在后台预加载）
const clipUrls = it => {
  const u = [enClip(it).url, zhClip(it).url];
  if(!it.sentence && it.game !== false) u.push(enClip(it, 2).url);
  if(it.sen) u.push(senClip(it).url, senClip(it, 2).url, senZhClip(it).url);
  return u;
};

// v === 2 用第二个英文声音（en2 / sen2），其余用默认声音
const enClip  = (it, v) => clip(v === 2 ? "en2" : "en", it.id, it.en, "en");
const zhClip  = it => clip("zh", it.id, it.zh, "zh");
const senClip = (it, v) => clip(v === 2 ? "sen2" : "sen", it.id, it.sen, "en");
const senZhClip = it => clip("senzh", it.id, it.senZh, "zh");
// “动一动”的英语指令（data.js 的 ACTS）
const actClip = it => { const a = (typeof ACTS !== "undefined") && ACTS[it.id]; return clip("act", it.id, a ? a.en : it.en, "en"); };
// 家长页里的“中文翻译”设置（srs.js 的 zhAll）；读不到设置时保持原来的每题都播中文
const showZh = () => { try{ return zhAll(); }catch(e){ return true; } };
const fx = id => { const f = FX.find(x=>x.id===id); return f ? clip("fx", id, f.text, f.lang) : null; };  // 找不到（比如缓存了旧 data.js）就跳过，不影响游戏

/* ============ 基础 ============ */
const app = document.getElementById("app");
const detail = document.getElementById("detail");
const panel = document.getElementById("panel");
const shuffle = a => { a = a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
let lesson = null;

const itemCard = (it, idx) => `
  <div class="card ${it.sentence?"sentence":""}" data-act="pick" data-i="${idx}">
    <div class="emoji">${it.emoji}</div>
    <div class="txt"><div class="en">${it.en}</div>${ipaHtml(it)}<div class="zh">${it.zh}</div></div>
  </div>`;

/* ============ 页面 ============ */
function home(){
  session++; token++; player.pause();
  app.innerHTML = `
    <h1>🔤 ABC 英语小游戏</h1>
    <div class="sub">点一点，听一听，学英语</div>
    ${homeQuestHtml()}
    ${LESSONS.map((l,i)=>`
      <button class="big" data-act="lesson" data-i="${i}">
        ${l.icon} ${l.title}<small>${l.zh}</small>
      </button>`).join("")}
    <div class="footer">建议打开手机声音 🔊<br><span data-act="parent">👨‍👩‍👧 家长页</span></div>`;
}

function lessonMenu(i){
  session++;
  lesson = LESSONS[i];
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    <h1>${lesson.icon} ${lesson.title}</h1>
    <div class="sub">${lesson.zh}</div>
    <button class="big green" data-act="learn">📖 学一学<small>点图片，听英文和中文</small></button>
    <button class="big blue" data-act="game">🎮 玩一玩<small>听声音，找图片</small></button>`;
  playSeq([fx("fx_welcome_zh")]);
}

/* ---- 学一学 ---- */
function learn(){
  session++;
  app.innerHTML = `
    <div class="top"><button class="back" data-act="menu">← 返回</button><span></span></div>
    <h2>📖 学一学</h2>
    <div class="grid">${lesson.items.map((it,i)=>itemCard(it,i)).join("")}</div>`;
  playSeq([fx("fx_welcome_zh")]);
}
let cur = 0;
function showDetail(i){
  cur = i;
  const it = lesson.items[i];
  panel.innerHTML = `
    <div class="emoji">${it.emoji}</div>
    <div class="en">${it.en}</div>
    ${ipaHtml(it)}
    <div class="zh">${it.zh}</div>
    ${it.sen ? `<div class="sen">${it.sen}</div><div class="senzh">${it.senZh}</div>` : ""}
    ${recHtml(it)}
    <div class="row">
      <button class="ghost" data-act="prev">◀</button>
      <button data-act="say">🔊 听</button>
      <button class="ghost" data-act="next">▶</button>
    </div>
    <div class="row"><button class="ghost" data-act="close">关闭</button></div>`;
  detail.classList.add("show");
  say();
}
function say(){
  const it = lesson.items[cur];
  const list = [enClip(it), zhClip(it)];
  if(it.sen) list.push(senClip(it), senZhClip(it));
  playSeq(list);
}

/* ---- 玩一玩 ---- */
let rounds = [], ri = 0, stars = 0, missed = false, locked = false, choices = [], session = 0;
function game(){
  session++;
  const pool = lesson.items.filter(i=>i.game !== false);
  rounds = shuffle(pool).slice(0, 8);
  ri = 0; stars = 0;
  warmFor(rounds);
  round();
}
// 有句子的（如 I can be a teacher.）读句子，否则读单词
const promptClips = it => [it.sen ? senClip(it) : enClip(it)];
function round(){
  const pool = lesson.items.filter(i=>i.game !== false);
  const it = rounds[ri];
  const same = pool.filter(p => !!p.sentence === !!it.sentence && p.id !== it.id);
  choices = shuffle([it, ...shuffle(same).slice(0, 2)]);
  missed = false; locked = false;
  const dots = rounds.map((_,i)=> i<ri ? "⭐" : (i===ri ? "🔹" : "⚪")).join("");
  app.innerHTML = `
    <div class="top"><button class="back" data-act="menu">← 返回</button><span></span></div>
    <div class="dots">${dots}</div>
    <h2>🎧 听一听，找一找</h2>
    <button class="speaker" data-act="repeat">🔊</button>
    <div class="choices ${it.sentence?"":"w"}">
      ${choices.map((c,i)=>`
        <div class="card ${c.sentence?"sentence":""}" data-act="choose" data-i="${i}">
          <div class="emoji">${c.emoji}</div>
        </div>`).join("")}
    </div>`;
  playSeq([...(ri < 2 || showZh() ? [fx("fx_find_zh")] : []), ...promptClips(it)]);     // 中文提示只在前 2 题播
}
async function choose(i, el){
  if(locked) return;
  const it = rounds[ri], c = choices[i];
  if(c.id === it.id){
    locked = true;
    el.classList.add("correct");
    if(!missed) stars++;
    const s = session;
    await playSeqCapped(showZh() ? [fx("fx_good_en"), fx("fx_good_zh"), enClip(it), zhClip(it)] : [fx("fx_good_en"), enClip(it)]);
    if(s !== session) return;   // 中途已退出本局
    ri++;
    ri < rounds.length ? round() : finish();
  }else{
    missed = true;
    el.classList.add("wrong");
    setTimeout(()=>el.classList.remove("wrong"), 500);
    playSeq([fx("fx_try_en"), ...promptClips(it)]);
  }
}
function finish(){
  app.innerHTML = `
    <div class="top"><span></span><span></span></div>
    <h1>🎉 太棒了！</h1>
    <div class="stars">${"⭐".repeat(stars) || "🌟"}</div>
    <div class="sub">一次就答对 ${stars} / ${rounds.length} 个</div>
    <button class="big blue" data-act="game">🔁 再玩一次</button>
    <button class="big green" data-act="learn">📖 去学一学</button>
    <button class="big" data-act="home">🏠 回到首页</button>`;
  playSeq([fx("fx_done_zh")]);
}

/* ============ 事件 ============ */
document.addEventListener("click", e=>{
  const t = e.target.closest("[data-act]");
  if(!t) return;
  const i = +t.dataset.i;
  switch(t.dataset.act){
    case "home":   home(); break;
    case "lesson": lessonMenu(i); break;
    case "menu":   lessonMenu(LESSONS.indexOf(lesson)); break;
    case "learn":  learn(); break;
    case "game":   game(); break;
    case "pick":   showDetail(i); break;
    case "say":    say(); break;
    case "prev":   showDetail((cur-1+lesson.items.length)%lesson.items.length); break;
    case "next":   showDetail((cur+1)%lesson.items.length); break;
    case "close":  detail.classList.remove("show"); token++; player.pause(); break;
    case "repeat": if(!locked) playSeq(promptClips(rounds[ri])); break;
    case "choose": choose(i, t); break;
  }
});

boot();
