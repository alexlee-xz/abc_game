/* ============ 魔法任务：今天的学习流程（新词页 → 选择题 → 说一说 → 动一动 → 完成页） ============
   依赖 core/srs.js（调度和记录）、audio/play.js（播放）、app.js 里的 app, session, home, 各种 clip 函数。 */

/* ---------- 首页入口 ---------- */
function homeQuestHtml(){
  const d = dailyState(), q = buildQueue(), s = srsStats();
  const n = q.due.length, m = q.news.length;
  let sub;
  if(n + m === 0) sub = d.done ? "今天的任务完成啦 ✅ 可以自由练习" : "今天没有要复习的，自由练习一下";
  else sub = `复习 ${n} 个 · 新朋友 ${m} 个` + (d.done ? "（再来一组）" : "");
  const extra = (s.mastered ? ` · 🍎 ${s.mastered} 个` : "") + (s.thirsty ? ` · 💧 ${s.thirsty} 棵渴了` : "");
  return `
    <button class="big quest" data-act="quest">🌈 今日魔法任务<small>${sub}</small></button>
    <button class="big green" data-act="garden">🌳 我的小花园<small>种下 ${s.planted}/${s.total} 棵${extra}</small></button>
    ${storyHtml()}
    <div class="chips"><span class="chip">🔥 连续 ${currentStreak()} 天</span>${typeof nameChip === "function" ? nameChip() : ""}</div>
    ${typeof basicsHtml === "function" ? basicsHtml() : ""}
    <div class="sec-title">📚 单元练习</div>`;
}

/* ---------- 魔法任务 ---------- */
let Q = null;
// 后台把这一组要用的语音下载好（play.js 的 warmAudio），网络不稳时不会中途断绣。缺少这些函数（测试环境、旧缓存）就跳过
function warmFor(items){
  if(typeof warmAudio !== "function" || typeof clipUrls !== "function") return;
  try{
    const urls = [];
    items.forEach(it => { if(it) urls.push(...clipUrls(it)); });
    FX.forEach(f => urls.push("audio/fx/" + f.id + ".mp3"));
    warmAudio(urls);
  }catch(e){}
}
function startQuest(){
  session++;
  const {due, news} = buildQueue();
  const need = needOf;                 // 没确认学会的词当天要答对 2 题
  const quiz = (it, review, probe, n) => ({type: "quiz", it, review, probe, need: n});
  const steps = [];
  const later = [];                    // later：同一天的第二次确认，放在最后
  shuffle(due).forEach(it => {
    const n = need(it);
    steps.push(quiz(it, true, 1, n));
    if(n === 2) later.push(quiz(it, true, 2, n));
  });
  news.forEach(it => {
    steps.push({type: "teach", it});
    steps.push(quiz(it, false, 1, 2));
    later.push(quiz(it, false, 2, 2));
  });
  const mode = (due.length + news.length) ? "quest" : "practice";
  // 题量不够 MIN_Q 时用“巩固题”补齐：选已学过、今天没有出现的词（等级低、久没练的优先），只记录不改复习计划
  const inSession = new Set(due.concat(news).map(wkey));
  const have = steps.filter(s => s.type === "quiz").length + later.length;
  const want = Math.max(0, MIN_Q - have);
  let extras = shuffle(questPool().filter(it => SRS.words[wkey(it)] && !inSession.has(wkey(it))))
    .sort((a, b) => SRS.words[wkey(a)].box - SRS.words[wkey(b)].box || SRS.words[wkey(a)].last - SRS.words[wkey(b)].last)
    .slice(0, want);
  if(!extras.length && mode === "practice") extras = shuffle(questPool()).slice(0, MIN_Q);   // 兜底
  shuffle(extras).forEach(it => { const s = quiz(it, false, 1, 1); s.extra = true; steps.push(s); });
  shuffle(later).forEach(s => steps.push(s));
  // 同一个词的两次确认不要紧挨着
  for(let i = 1; i < steps.length; i++){
    const a = steps[i - 1], b = steps[i];
    if(a.type === "quiz" && b.type === "quiz" && wkey(a.it) === wkey(b.it)){
      const j = steps.findIndex((s, x) => x > i && s.type === "quiz" && wkey(s.it) !== wkey(a.it));
      if(j > 0){ const tmp = steps[i]; steps[i] = steps[j]; steps[j] = tmp; }
    }
  }
  addSayAndActSteps(steps, due, news);
  warmFor(steps.map(s => s.it));
  Q = {steps, i: 0, mode, stars: 0, intro: true, cur: null, step: null, choices: [], locked: false,
       review: false, conf: {}, qid: 0, tries: 0, ms: 0, t0: null, nq: 0, voice: 1, sent: false, wrongs: 0};
  questStep();
}
// “说一说”：偶尔把一个已经很熟（等级≥ SAY_BOX）的复习词的选择题换成“看图说英语”
// “动一动”：任务最后听英语指令做动作（优先今天的新词、到期词），不影响复习计划
function addSayAndActSteps(steps, due, news){
  const cfg = normCfg(SRS.cfg);
  if(cfg.say && Math.random() < SAY_CHANCE){
    const cand = steps.filter(s => s.type === "quiz" && s.review && !s.extra && s.need === 1 && boxOf(s.it) >= SAY_BOX);
    if(cand.length){
      const s = cand[Math.floor(Math.random() * cand.length)];
      steps[steps.indexOf(s)] = {type: "say", it: s.it, review: true, probe: 1, need: 1};
    }
  }
  if(cfg.act){
    const seen = new Set(), picked = [];
    const add = it => { if(it && actsOf(it) && !seen.has(wkey(it)) && picked.length < ACT_MAX){ seen.add(wkey(it)); picked.push(it); } };
    news.forEach(add);
    shuffle(due).forEach(add);
    shuffle(questPool().filter(it => SRS.words[wkey(it)])).forEach(add);
    picked.forEach(it => steps.push({type: "act", it}));
  }
}
const isDot = s => s.type === "quiz" || s.type === "say";     // 进度小点里算的题
function qDots(){
  const quizzes = Q.steps.filter(isDot);
  const cur = Q.steps.slice(0, Q.i).filter(isDot).length;
  return `<div class="dots${quizzes.length > 12 ? " tiny" : ""}">` +
    quizzes.map((_, k) => k < cur ? "⭐" : (k === cur ? "🔹" : "⚪")).join("") + `</div>`;
}
function questStep(){
  if(Q.i >= Q.steps.length) return questFinish();
  const s = Q.steps[Q.i];
  const pre = Q.intro ? [fx("fx_quest_zh")] : [];
  Q.intro = false;
  if(s.type === "teach") questTeach(s.it, pre);
  else if(s.type === "say") questSay(s, pre);
  else if(s.type === "act") questAct(s, pre);
  else questQuiz(s, pre);
}
const teachClips = it => [enClip(it), zhClip(it), ...(it.sen ? [senClip(it), senZhClip(it)] : [])];

function questTeach(it, pre){
  const d = dailyState(), k = wkey(it);
  if(!SRS.words[k]){
    SRS.words[k] = newWord(todayNum());
    d.newCount++; d.news.push(k); saveSRS();
  }
  Q.cur = it;
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    ${qDots()}
    <h2>🌰 认识新朋友</h2>
    <div class="card teach" data-act="q-say">
      <div class="emoji">${it.emoji}</div>
      <div class="en">${it.en}</div>
      ${ipaHtml(it)}
      <div class="zh">${it.zh}</div>
      ${it.sen ? `<div class="sen">${it.sen}</div>` : ""}
    </div>
    ${recHtml(it)}
    <button class="big green" data-act="q-next">👍 记住啦</button>`;
  playSeq([...pre, fx("fx_new_zh"), ...teachClips(it)]);
}

// 播放题目语音，并把“听完”的时刻记为反应计时起点（被打断或已经点过就不记）
function promptThen(list){
  const my = ++Q.qid;
  Q.t0 = null;
  return playSeq(list).then(ok => {
    if(ok && Q && Q.qid === my && Q.tries === 0) Q.t0 = Date.now();
    return ok;
  });
}

function questQuiz(s, pre){
  const it = s.it;
  Q.cur = it; Q.step = s; Q.choices = pickChoices(it); Q.sent = useSen(it);
  Q.locked = false; Q.review = !!s.review; Q.tries = 0; Q.ms = 0; Q.wrongs = 0;
  // 复习题随机换第二个英文声音（同一个词听不同的人说）；新词一直用第一个
  Q.voice = (s.review || s.extra) && Math.random() < ALT_VOICE_P ? 2 : 1;
  if(!s.retry) Q.nq++;
  const zhPrompt = zhAll() || Q.nq <= ZH_FIRST_QS;
  const hint = s.retry ? "🔁 刚才答错的，再来一次" : s.fb ? "🔁 再听一听，找一找" : s.extra ? "" : s.probe === 2 ? "🔁 再考一次，加油！"
    : (s.review && Q.mode === "quest" ? "💧 小树渴了，答对就浇水" : "");
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    ${qDots()}
    <h2>🎧 听一听，找一找</h2>
    <button class="speaker" data-act="q-repeat">🔊</button>
    <div class="fb" id="fb">${hint}</div>
    <div class="choices w${Q.choices.length > 3 ? " w4" : ""}">
      ${Q.choices.map((c, i) => `
        <div class="card" data-act="q-choose" data-i="${i}"><div class="emoji">${c.emoji}</div></div>`).join("")}
    </div>`;
  promptThen([...pre, s.retry ? fx("fx_again_zh") : (zhPrompt ? fx("fx_find_zh") : null), ...qPrompt()]);
}

// 把一题插到队列里：隔 gap 题之后、“动一动”之前，不跟同一个词紧挨着
function insertStep(step, gap){
  const k = wkey(step.it), st = Q.steps;
  const same = x => x && x.type === "quiz" && wkey(x.it) === k;
  const lim = st.findIndex(x => x.type === "act"), end = lim < 0 ? st.length : lim;
  let at = Math.min(end, Q.i + 1 + gap);
  while(at < end && (same(st[at - 1]) || same(st[at]))) at++;
  st.splice(at, 0, step);
}
// 答错的词：隔 RETRY_GAP 题后再考一次。这次只算练习（extra），不改复习计划、不计入遗忘统计
function requeueMiss(it){
  insertStep({type: "quiz", it, review: false, probe: 0, need: 0, extra: true, retry: true}, RETRY_GAP);
}

async function qChoose(i, el){
  if(!Q || Q.locked) return;
  const it = Q.cur, c = Q.choices[i];
  Q.tries++;
  if(Q.tries === 1) Q.ms = Q.t0 ? Math.min(60000, Date.now() - Q.t0) : 0;   // 第一次点的反应时间
  if(wkey(c) !== wkey(it)){
    el.classList.add("wrong");
    setTimeout(() => el.classList.remove("wrong"), 500);
    Q.wrongs++;
    if(Q.wrongs >= 2){
      // 连续点错 2 次：把正确的图亮出来，带孩子读一遍，免得乱点泄气
      const ci = Q.choices.findIndex(x => wkey(x) === wkey(it));
      const right = app.querySelector && app.querySelector(`[data-act="q-choose"][data-i="${ci}"]`);
      if(right) right.classList.add("hint");
      playSeq([fx("fx_look_zh"), enClip(it, Q.voice), enClip(it, Q.voice)]);
    }else{
      playSeq([fx("fx_try_en"), ...qPrompt()]);
    }
    return;
  }
  Q.locked = true;
  el.classList.remove("hint");
  el.classList.add("correct");
  const first = Q.tries === 1, retry = !!Q.step.retry;
  if(first && !retry && !Q.step.fb) Q.stars++;     // fb：“说一说”没说出来后的补考，星星已在那一题里算过了
  const r = applyResult(Q.step, first, Q.ms, Q.tries);
  if(!first && !retry) requeueMiss(it);
  const fb = document.getElementById("fb");
  if(fb) fb.textContent = retry ? (first ? "这次答对啦 👍" : "") : feedbackText(r);
  const list = [fx("fx_good_en"), enClip(it, Q.voice)];
  if(zhAll()) list.push(zhClip(it));       // 中文翻译默认只在新词页播
  if(r.kind === "up" && Q.review) list.push(fx("fx_water_zh"));
  const s = session;
  await playSeqCapped(list);
  if(s !== session) return;      // 中途已离开
  Q.i++;
  questStep();
}

function questFinish(){
  const t = todayNum(), d = dailyState();
  d.done = true;
  if(SRS.lastDone !== t){
    SRS.streak = (SRS.lastDone === t - 1) ? SRS.streak + 1 : 1;
    SRS.lastDone = t;
    if(!SRS.doneDays.includes(t)) SRS.doneDays.push(t);
    SRS.doneDays = SRS.doneDays.slice(-60);
  }
  saveSRS();
  const total = Q.steps.filter(s => (s.type === "quiz" && !s.retry && !s.fb) || s.type === "say").length;     // “再考一次”“补考”不算在题数里
  app.innerHTML = `
    <div class="top"><span></span><span></span></div>
    <h1>🎉 今天的任务完成啦！</h1>
    <div class="stars">${"⭐".repeat(Q.stars) || "🌟"}</div>
    <div class="sub">一次就答对 ${Q.stars} / ${total} 个 · 🔥 连续 ${currentStreak()} 天</div>
    ${tipSection("👨‍👩‍👧 家长小任务")}
    <button class="big green" data-act="garden">🌳 看小花园</button>
    <button class="big blue" data-act="quest">➕ 再练一组</button>
    <button class="big" data-act="home">🏠 回到首页</button>`;
  playSeq([fx("fx_done_zh")]);
}

/* ---------- 说一说：只给图，孩子用英语说，家长判断 ----------
   说对：算一次“第一次就答对”，按复习计划升级（主动说出比认出更难）。
   没说出来：不热分、不算遗忘，带孩子读两遍，然后稍后补考一道正常的选择题（那道题影响复习计划）。 */
function questSay(s, pre){
  const it = s.it;
  Q.cur = it; Q.step = s; Q.locked = false;
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    ${qDots()}
    <h2>🗣 说一说</h2>
    <div class="card teach">
      <div class="emoji">${it.emoji}</div>
      <div class="en" id="say-en" style="visibility:hidden">${it.en}</div>
    </div>
    <div class="fb" id="fb">让孩子用英语说说看，说完家长点下面的按钮</div>
    <div class="row">
      <button class="ok" data-act="s-ok">👍 说对了</button>
      <button class="ghost" data-act="s-no">🔁 没说出来</button>
    </div>
    <div class="footer">家长来判断：说对了就点“说对了”。没说出来也没关系，会带孩子读一读，等一下再考一次。</div>`;
  playSeq([...pre, fx("fx_say_zh")]);
}
async function sayDone(ok){
  if(!Q || Q.locked || !Q.step || Q.step.type !== "say") return;
  Q.locked = true;
  const it = Q.cur, s = Q.step, sn = session;
  const en = document.getElementById("say-en");
  if(en && en.style) en.style.visibility = "visible";
  const fb = document.getElementById("fb");
  if(ok){
    Q.stars++;
    const r = applyResult(s, true, 0, 1);
    if(fb) fb.textContent = feedbackText(r) || "说得真好！";
    await playSeqCapped([fx("fx_good_en"), enClip(it), ...(zhAll() ? [zhClip(it)] : [])]);
  }else{
    insertStep({type: "quiz", it, review: true, probe: 1, need: 1, fb: true}, RETRY_GAP);
    if(fb) fb.textContent = "没关系，跟我读！等一下再考考你 🙂";
    await playSeqCapped([fx("fx_look_zh"), enClip(it), enClip(it)]);
  }
  if(sn !== session) return;
  Q.i++;
  questStep();
}

/* ---------- 动一动：听英语指令做动作（不计分、不影响复习计划） ---------- */
function questAct(s, pre){
  const it = s.it, a = actsOf(it);
  Q.cur = it; Q.step = s; Q.locked = false;
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    <h2>🕺 动一动</h2>
    <div class="card teach" data-act="a-say">
      <div class="emoji">${it.emoji}</div>
      <div class="en" style="font-size:26px">${a.en}</div>
      <div class="zh">${a.zh}</div>
    </div>
    <div class="fb" id="fb">听指令，做动作！</div>
    <div class="row">
      <button class="ok" data-act="a-done">👍 做完啦</button>
      <button class="ghost" data-act="a-say">🔊 再听一遍</button>
    </div>
    <div class="row"><button class="ghost" data-act="a-skip">跳过</button></div>`;
  playSeq([...pre, fx("fx_act_zh"), actClip(it)]);
}
async function actDone(ok){
  if(!Q || Q.locked || !Q.step || Q.step.type !== "act") return;
  Q.locked = true;
  const sn = session;
  if(ok) await playSeqCapped([fx("fx_good_en")]);
  if(sn !== session) return;
  Q.i++;
  questStep();
}

/* ---------- 事件 ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if(!t) return;
  const i = +t.dataset.i;
  switch(t.dataset.act){
    case "quest":    startQuest(); break;
    case "q-next":   Q.i++; questStep(); break;
    case "q-say":    if(Q && Q.cur) playSeq(teachClips(Q.cur)); break;
    case "q-repeat": if(Q && !Q.locked && Q.step && Q.step.type === "quiz") promptThen(qPrompt()); break;
    case "q-choose": qChoose(i, t); break;
    case "s-ok":     sayDone(true); break;
    case "s-no":     sayDone(false); break;
    case "a-say":    if(Q && Q.step && Q.step.type === "act") playSeq([actClip(Q.cur)]); break;
    case "a-done":   actDone(true); break;
    case "a-skip":   actDone(false); break;
  }
});
