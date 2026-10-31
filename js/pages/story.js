/* ============ 听故事，排顺序 ============
   依赖 core/srs.js、audio/play.js、app.js 里的 app, session。 */

/* ---------- 听故事，排顺序 ----------
   学会一个故事要用的词（等级≥ 1）后解锁：播一遍由几句话组成的小故事，孩子把图片按故事的顺序一张一张点出来。
   每个故事只看自己要用的那几个词（data.js 的 STORIES[].need；没写就看整个单元），所以每学会几个词就会有新故事解锁。
   不计入复习计划，只记完成次数。 */
const itemById = id => {
  for(const l of LESSONS){ const it = l.items.find(x => x.id === id); if(it) return it; }
  return (typeof STORY_LINES !== "undefined" ? STORY_LINES : []).find(x => x.id === id) || null;
};
function storyProgress(st){
  const lesson = LESSONS.find(x => x.id === st.unit);
  const src = st.need ? st.need.map(itemById) : (lesson ? lesson.items : []);
  const words = src.filter(i => i && !i.sentence && i.game !== false);
  const keys = [...new Set(words.map(wkey))];
  const got = keys.filter(k => SRS.words[k] && SRS.words[k].box >= 1).length;
  return {got, need: keys.length, open: keys.length > 0 && got >= keys.length, lesson, names: [...new Set(words.map(w => w.en))]};
}
// 首页最多摆几个能玩的故事：完成次数少的排前面，所以新解锁的故事总在最上面，玩过的往后排
const STORY_SHOW = 3;
function storyHtml(){
  const all = storyList().map((st, i) => ({st, i, p: storyProgress(st), n: SRS.story[st.id] || 0}));
  const open = all.filter(x => x.p.open).sort((a, b) => a.n - b.n || a.i - b.i);
  // 还没解锁的只露出最快能解锁的那一个（差的词最少），免得首页被一排锁占满
  const lock = all.filter(x => !x.p.open && x.p.need > 0).sort((a, b) => (a.p.need - a.p.got) - (b.p.need - b.p.got) || a.i - b.i)[0];
  const btn = x => `<button class="big blue" data-act="story" data-i="${x.i}">📖 听故事，排顺序<small>${x.st.title}${x.n ? ` · 已完成 ${x.n} 次` : ""}</small></button>`;
  let h = open.slice(0, STORY_SHOW).map(btn).join("");
  if(open.length > STORY_SHOW) h += `<div class="chips"><span class="chip">📖 还有 ${open.length - STORY_SHOW} 个故事，玩过的会往后排</span></div>`;
  if(lock){
    const need = lock.p.lesson && !lock.st.need ? `学会“${lock.p.lesson.zh}”单元的词后解锁` : `学会 ${lock.p.names.join("、")} 后解锁`;
    h += `<div class="big locked">🔒 听故事，排顺序<small>${need} · ${lock.p.got}/${lock.p.need}</small></div>`;
  }
  return h;
}
let S = null;
const NUMS = ["①", "②", "③", "④", "⑤", "⑥"];
const storyClips = () => S.lines.map(it => enClip(it));
function storyStart(idx){
  const st = storyList()[idx];
  if(!st || !storyProgress(st).open) return;
  const lines = st.lines.map(itemById);
  if(lines.length < 2 || lines.some(x => !x)) return;
  session++;
  let order;
  do{ order = shuffle(lines.map((_, i) => i)); }while(order.every((v, i) => v === i));   // 不能一开始就是对的顺序
  S = {st, idx, lines, order, next: 0, miss: 0, locked: false, done: new Set()};
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    <h2>📖 ${st.title}</h2>
    <button class="speaker" data-act="st-play">🔊</button>
    <div class="fb" id="fb">按故事的顺序，一张一张点图片</div>
    <div class="choices ${lines.length === 4 ? "w4" : "w"} story">
      ${order.map(i => `
        <div class="card" data-act="st-pick" data-i="${i}"><div class="badge"></div><div class="emoji">${lines[i].emoji}</div></div>`).join("")}
    </div>`;
  playSeq([fx("fx_story_zh"), ...storyClips()]);
}
async function storyPick(i, el){
  if(!S || S.locked) return;
  const it = S.lines[i];
  if(!it) return;
  if(S.done.has(i)){ playSeq([enClip(it)]); return; }
  if(i !== S.next){
    S.miss++;
    el.classList.add("wrong");
    setTimeout(() => el.classList.remove("wrong"), 500);
    playSeq([fx("fx_try_en"), ...storyClips()]);       // 重听整个故事，不直接告诉答案
    return;
  }
  S.done.add(i); S.next++;
  el.classList.add("correct");
  const b = el.querySelector && el.querySelector(".badge");
  if(b) b.textContent = NUMS[i] || String(i + 1);
  if(S.next < S.lines.length){ playSeq([enClip(it)]); return; }
  S.locked = true;
  SRS.story[S.st.id] = (SRS.story[S.st.id] || 0) + 1;
  saveSRS();
  const sn = session;
  await playSeq([enClip(it)]);
  if(sn !== session) return;
  storyFinish();
}
function storyFinish(){
  const stars = S.miss === 0 ? 3 : S.miss <= 2 ? 2 : 1;
  app.innerHTML = `
    <div class="top"><span></span><span></span></div>
    <h1>🎉 故事讲完啦！</h1>
    <div class="stars">${"⭐".repeat(stars)}</div>
    <div class="sub">${S.miss ? `点错 ${S.miss} 次` : "一次就排对啦！"}</div>
    <button class="big blue" data-act="st-again">🔁 再听一遍，再排一次</button>
    <button class="big" data-act="home">🏠 回到首页</button>`;
  playSeq([fx("fx_good_en"), ...storyClips(), fx("fx_done_zh")]);
}

/* ---------- 事件 ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if(!t) return;
  const i = +t.dataset.i;
  switch(t.dataset.act){
    case "story":    storyStart(i); break;
    case "st-pick":  storyPick(i, t); break;
    case "st-play":  if(S && !S.locked) playSeq(storyClips()); break;
    case "st-again": if(S) storyStart(S.idx); break;
  }
});
