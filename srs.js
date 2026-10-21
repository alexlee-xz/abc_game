/* ============ 间隔复习（艾宾浩斯） + 魔法任务 + 小花园 + 家长页 ============
   依赖 index.html 里的全局：app, session, token, player, shuffle, playSeq, fx,
   enClip, zhClip, senClip, senZhClip, actClip。
   进度保存在 localStorage（同一台手机、同一个浏览器内有效），每个小朋友一份（见 profile.js）。 */

// 新等级 -> 下次复习间隔（天）。学会后累计在第 1、2、4、7、15 天复习。
const INTERVALS = [1, 1, 1, 2, 3, 8];
const REPEAT_GAP = 15;            // 已长成苹果树后的复习间隔
// 家长页可设置：每天学几个新词（1–20）、提示语速、英语播放语速（×0.5 – ×2.0）
const NEW_MIN = 1, NEW_MAX = 20, NEW_DEFAULT = 3;
const RATE_MIN = 0.5, RATE_MAX = 2.0;
const MAX_DUE = 10;        // 每组最多复习几个旧词（多出来的留到下一组/明天，最久没复习的优先）
const MIN_Q = 10;         // 每组至少几题（不够时用“巩固题”补齐）
const HARD_BOX = 2;       // 等级到 🌿 以后改成 4 选 1，并优先放容易混淆的干扰项（减少猜对）
const SEN_BOX = 3;        // 等级到 🪴 以后，有句子的词改听整句 “I can be a ___.”，低等级只听单词
const RETRY_GAP = 3;      // 答错的词，隔几题后再考一次（只练习，不改复习计划）
const SAY_BOX = 4;        // 等级到 🌳 以后，偏尔出“说一说”（只给图，孩子用英语说，家长判断）
const ACT_MAX = 2;        // 每组任务最后最多几个“动一动”
const ZH_FIRST_QS = 2;    // “听一听，找一找！”这句中文提示只在每组前几题播（设置为“总是”时每题都播）
// 下面两个用 let：正常使用时当常量，测试里需要确定性时才改
let SAY_CHANCE = 0.5;    // 每组任务里出现一题“说一说”的概率（没有等级≥ SAY_BOX 的到期词就不出）
let ALT_VOICE_P = 0.5;   // 复习题用第二个英文声音的概率（新词一直用第一个声音）
const LEGACY_NEW = [2, 3, 4];     // 旧版“少/标准/多”三档对应的每天新词数
const SLOW_MS = 9000;     // 听完题目后超过 9 秒才点，算“犹豫”（不稳）
const LOG_MAX = 400;      // 逐题记录最多保留最近 400 条
const STAGES = ["🌰", "🌱", "🌿", "🪴", "🌳", "🍎"];
// 遗忘曲线的横坐标：“上次见到这个词”隔了几天。每档 [下限, 上限, 标签]
const GAP_BUCKETS = [[1, 1, "1天"], [2, 2, "2天"], [3, 4, "3-4天"], [5, 7, "5-7天"], [8, 14, "8-14天"], [15, 29, "15-29天"], [30, 9999, "30天+"]];
function gapBucket(g){ return GAP_BUCKETS.findIndex(b => g >= b[0] && g <= b[1]); }
function normStory(o){
  const r = {};
  if(o && typeof o === "object") Object.keys(o).forEach(k => { const n = Math.max(0, Math.floor(+o[k] || 0)); if(n) r[k] = n; });
  return r;
}
function freshCurve(){ return GAP_BUCKETS.map(() => [0, 0]); }
function normCurve(c){
  if(!Array.isArray(c) || c.length !== GAP_BUCKETS.length) return freshCurve();
  return c.map(p => {
    const n = Math.max(0, Math.floor(+(p && p[0]) || 0)), ok = Math.max(0, Math.floor(+(p && p[1]) || 0));
    return [n, Math.min(n, ok)];
  });
}

const freshSRS = () => ({
  words: {}, daily: {day: 0, newCount: 0, done: false, news: []},   // news：今天新学的词
  doneDays: [], streak: 0, lastDone: 0,
  cfg: {newPerDay: NEW_DEFAULT, enRate: 1, promptRate: 1, zh: "new", say: true, act: true},
  curve: freshCurve(),   // 遗忘曲线汇总：每个“隔了几天”档 [测试次数, 第一次就点对次数]
  story: {},             // 听故事排顺序：故事 id -> 完成次数
  log: []     // 逐题记录 {d:日期, k:词, ok:一次对, n:点几次, ms:反应毫秒, c:l学习/r遗忘测试/x巩固, p:第几次确认}
});
const clampNum = (v, lo, hi, def) => { v = +v; return isFinite(v) && v !== 0 ? Math.min(hi, Math.max(lo, v)) : def; };
function normCfg(c){
  c = (c && typeof c === "object") ? c : {};
  // 旧存档：曾经用过 level（少/标准/多）或 quiz（每组题数，约三成是新词）
  const n = c.newPerDay != null ? c.newPerDay : (c.quiz != null ? Math.round(c.quiz * 0.3) : LEGACY_NEW[c.level]);
  const rate = v => Math.round(clampNum(v, RATE_MIN, RATE_MAX, 1) * 10) / 10;
  return {newPerDay: Math.round(clampNum(n, NEW_MIN, NEW_MAX, NEW_DEFAULT)), enRate: rate(c.enRate), promptRate: rate(c.promptRate),
          zh: c.zh === "all" ? "all" : "new",      // 中文翻译：只在新词页 / 总是播
          say: c.say !== false, act: c.act !== false};   // “说一说”、“动一动”开关，默认开
}
// 兼容旧版本存档、也防止导入的文件里有乱七八糟的内容：缺的字段补默认值，不合理的值收回到合理范围
const intOr = (v, d) => { if(typeof v !== "number" && typeof v !== "string") return d; if(v === "") return d; v = Math.floor(+v); return isFinite(v) ? v : d; };
function normWords(w){
  const r = {};
  if(!w || typeof w !== "object" || Array.isArray(w)) return r;
  Object.keys(w).slice(0, 500).forEach(k => {
    const x = w[k];
    if(!x || typeof x !== "object" || Array.isArray(x)) return;
    const o = {box: Math.min(5, Math.max(0, intOr(x.box, 0))), due: intOr(x.due, 0), seen: Math.max(0, intOr(x.seen, 1)),
      right: Math.max(0, intOr(x.right, 0)), wrong: Math.max(0, intOr(x.wrong, 0)), last: x.last == null ? null : intOr(x.last, null),
      lastGood: x.lastGood == null ? null : intOr(x.lastGood, null),
      rc: Math.max(0, intOr(x.rc, 0)), fg: Math.max(0, intOr(x.fg, 0)), lw: Math.max(0, intOr(x.lw, 0))};
    if(x.born != null && isFinite(+x.born)) o.born = intOr(x.born, 0);
    r[k] = o;
  });
  return r;
}
function normLog(l){
  if(!Array.isArray(l)) return [];
  return l.filter(r => r && typeof r === "object" && typeof r.k === "string" && isFinite(+r.d))
    .map(r => ({d: intOr(r.d, 0), k: r.k, ok: r.ok ? 1 : 0, n: Math.max(0, intOr(r.n, 1)), ms: Math.max(0, intOr(r.ms, 0)), c: ["l", "r", "x"].includes(r.c) ? r.c : "l", p: intOr(r.p, 0)}))
    .slice(-LOG_MAX);
}
function normSRS(o){
  o = (o && typeof o === "object") ? o : {};
  const s = Object.assign(freshSRS(), o);
  s.words = normWords(o.words);
  const dd = o.daily && typeof o.daily === "object" ? o.daily : {};
  s.daily = {day: intOr(dd.day, 0), newCount: Math.max(0, intOr(dd.newCount, 0)), done: !!dd.done,
    news: Array.isArray(dd.news) ? dd.news.filter(x => typeof x === "string").slice(0, 50) : []};
  s.doneDays = Array.isArray(o.doneDays) ? [...new Set(o.doneDays.map(x => intOr(x, NaN)).filter(isFinite))].slice(-400) : [];
  s.streak = Math.max(0, intOr(o.streak, 0));
  s.lastDone = intOr(o.lastDone, 0);
  s.log = normLog(o.log);
  s.cfg = normCfg(o.cfg);
  s.curve = normCurve(o.curve);
  s.story = normStory(o.story);
  return s;
}
function loadSRS(){
  const key = curKey();
  if(!key) return freshSRS();
  try{
    const s = JSON.parse(localStorage.getItem(key));
    if(s && typeof s.words === "object") return normSRS(s);
  }catch(e){}
  return freshSRS();
}
let SRS = loadSRS();
SRS.cfg = normCfg(SRS.cfg);
const newPerDay = () => normCfg(SRS.cfg).newPerDay;     // 每天最多新词数
const zhAll = () => normCfg(SRS.cfg).zh === "all";      // true：每题都带中文提示和翻译；false：中文只留在新词页
// data.js 里可能缺少新增的表（手机缓存了旧文件）：找不到就当作没有，不影响其他功能
const actsOf = it => (typeof ACTS !== "undefined" && ACTS[it.id]) || null;
const storyList = () => (typeof STORIES !== "undefined" ? STORIES : []);
// 某段语音的播放速度：英语单词/句子用“英语播放语速”，其余（中文、提示、夸奖）用“提示语速”
function rateFor(c){
  const u = (c && c.url) || "", cfg = normCfg(SRS.cfg);
  if(/^audio\/(en|en2|sen|sen2|act)\//.test(u)) return cfg.enRate;
  if(/^audio\/(zh|senzh|fx)\//.test(u)) return cfg.promptRate;
  return 1;
}
// 不含逐题记录的纯进度文字（词的统计计数仍会保留）。家长页的“复制文字”用 account.js 里带名字的外壳
function backupText(){ const o = Object.assign({}, SRS); delete o.log; return JSON.stringify(o); }
function saveSRS(){
  ensureProfile();
  try{ localStorage.setItem(curKey(), JSON.stringify(SRS)); }catch(e){}
}

/* ---------- 日期 / 词库 ---------- */
function todayNum(){
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
function dayLabel(n){ const d = new Date(n * 86400000); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate(); }
function dailyState(){
  const t = todayNum();
  if(SRS.daily.day !== t) SRS.daily = {day: t, newCount: 0, done: false, news: []};
  if(!Array.isArray(SRS.daily.news)) SRS.daily.news = [];
  return SRS.daily;
}
const wkey = it => it.en.toLowerCase();

// 所有单词（跳过句子和抽象词），同名词只留一个（优先带 "I can be..." 句子的）
function questPool(){
  const map = new Map();
  LESSONS.forEach(l => l.items.forEach(it => {
    if(it.game === false || it.sentence) return;
    const k = wkey(it), old = map.get(k);
    if(!old || (!old.sen && it.sen)) map.set(k, it);
  }));
  return [...map.values()];
}
function currentStreak(){
  const t = todayNum();
  return (SRS.lastDone === t || SRS.lastDone === t - 1) ? SRS.streak : 0;
}
function srsStats(){
  const t = todayNum(), pool = questPool();
  const r = {total: pool.length, planted: 0, mastered: 0, thirsty: 0, byStage: [0, 0, 0, 0, 0, 0]};
  pool.forEach(it => {
    const w = SRS.words[wkey(it)];
    if(!w) return;
    r.planted++; r.byStage[w.box]++;
    if(w.box >= 5) r.mastered++;
    if(w.due <= t) r.thirsty++;
  });
  return r;
}

/* ---------- 今日队列 ---------- */
// 没确认学会的词当天要答对 2 题，其余 1 题
const needOf = it => lastGoodDay(SRS.words[wkey(it)]) !== null ? 1 : 2;
// 旧词：最久没复习的先来，每组最多 MAX_DUE 个；新词：每天最多 newPerDay() 个（当天已学的不重复算）
function buildQueue(){
  const t = todayNum(), d = dailyState(), pool = questPool();
  const due = pool
    .filter(it => { const w = SRS.words[wkey(it)]; return w && w.due <= t; })
    .sort((a, b) => SRS.words[wkey(a)].due - SRS.words[wkey(b)].due)
    .slice(0, MAX_DUE);
  const news = pool.filter(it => !SRS.words[wkey(it)]).slice(0, Math.max(0, newPerDay() - d.newCount));
  return {due, news};
}

/* ---------- 选项和提示：难度随等级提高 ----------
   新词、低等级词：3 选 1、只听单词。
   等级≥ HARD_BOX：4 选 1，其中最多 2 个是容易混的词（data.js 的 CONFUSE），仍留随机项。
   等级≥ SEN_BOX：有句子的词改听整句。 */
function confusables(k){
  const set = new Set();
  if(typeof CONFUSE === "undefined") return set;
  (CONFUSE[k] || []).forEach(x => set.add(x));
  Object.keys(CONFUSE).forEach(j => { if(CONFUSE[j].includes(k)) set.add(j); });
  return set;
}
const boxOf = it => { const w = SRS.words[wkey(it)]; return w ? w.box : 0; };
function pickChoices(it){
  const k = wkey(it), n = boxOf(it) >= HARD_BOX ? 4 : 3;
  const rest = questPool().filter(p => wkey(p) !== k);
  let others;
  if(n === 4){
    const like = confusables(k);
    const near = shuffle(rest.filter(p => like.has(wkey(p)))).slice(0, 2);
    others = near.concat(shuffle(rest.filter(p => !near.includes(p)))).slice(0, n - 1);
  }else others = shuffle(rest).slice(0, n - 1);
  return shuffle([it, ...others]);
}
const useSen = it => !!it.sen && boxOf(it) >= SEN_BOX;
const qPrompt = () => [Q.sent ? senClip(Q.cur, Q.voice) : enClip(Q.cur, Q.voice)];

/* ---------- 家长小任务：今天新学的词 + 今天答错过的词，附生活里怎么用 ---------- */
const tipOf = it => (typeof TIPS !== "undefined" && TIPS[wkey(it)]) || `在生活里找一找“${it.zh}”，问孩子：What is it?`;
function todayTipItems(max){
  const t = todayNum(), d = dailyState(), pool = questPool(), out = [];
  const add = (k, tag) => {
    const it = pool.find(p => wkey(p) === k);
    if(it && !out.some(o => o.it === it)) out.push({it, tag});
  };
  d.news.forEach(k => add(k, "新词"));
  SRS.log.filter(r => r.d === t && !r.ok).forEach(r => add(r.k, "今天答错过"));
  return out.slice(0, max);
}
function tipSection(title, empty){
  const items = todayTipItems(4);
  if(!items.length) return empty ? `<div class="sec"><h3>${title}</h3><div class="note">${empty}</div></div>` : "";
  return `<div class="sec"><h3>${title}</h3>` +
    `<div class="note" style="margin-bottom:4px">在生活里用一用，比多做几道题更管用：</div>` +
    items.map(o => `<div class="tip"><b><span class="temo">${o.it.emoji}</span> ${o.it.en}　${o.it.zh}</b> <span class="tag">${o.tag}</span>` +
      `<div class="note">${tipOf(o.it)}</div></div>`).join("") + `</div>`;
}

/* ---------- 每个词的记录 ---------- */
// box 等级；due 下次复习日；lastGood 最近一次“确认学会”的日期；
// rc 隔天复习测试次数；fg 其中答错（遗忘）次数；lw 还没学会时的答错次数
// born：第一次学这个词的日期（每周小结里“本周新认识”用；旧存档没有，就不算进去）
const newWord = t => ({box: 0, due: t, seen: 1, right: 0, wrong: 0, last: t, lastGood: null, rc: 0, fg: 0, lw: 0, born: t});
function fillW(w){ w.rc = w.rc || 0; w.fg = w.fg || 0; w.lw = w.lw || 0; return w; }
// 最近一次确认学会的日期；从没学会返回 null。旧版存档没有 lastGood，等级≥ 1 就用上次作答日近似
function lastGoodDay(w){
  if(!w) return null;
  if(w.lastGood != null) return w.lastGood;
  return w.box >= 1 ? w.last : null;
}
function logAnswer(d, k, first, tries, ms, c, p){
  SRS.log.push({d, k, ok: first ? 1 : 0, n: tries, ms: Math.round(ms / 100) * 100, c, p});
  if(SRS.log.length > LOG_MAX) SRS.log.splice(0, SRS.log.length - LOG_MAX);
}

/* 记录一次作答（孩子点对的那一下）。
   • 从没确认学会的词（新词）当天要“一次就对且不犹豫”连续答对 2 题（need=2）才升级，减少猜对的误判；
     已确认学会的词进入复习，1 题（need=1）。
   • 反应太慢（超过 SLOW_MS）的正确答案算“不稳”：等级不升，按当前级的间隔再复习。
   • 答错：降级，明天再练。只有“之前确认学会过、隔了至少 1 天、这次第一次就答错”才算遗忘（fg）；
     新词答错只算“还没学会”（lw）。
   • 巩固题（extra）只记录，不改复习计划，也不计入遗忘统计。 */
function applyResult(step, first, ms, tries){
  const it = step.it, t = todayNum(), k = wkey(it);
  if(step.extra){
    logAnswer(t, k, first, tries, ms, "x", 0);
    saveSRS();
    return {kind: "extra", from: 0, to: 0};
  }
  const w = fillW(SRS.words[k] || (SRS.words[k] = newWord(t)));
  const from = w.box, slow = ms > SLOW_MS;
  const gd = lastGoodDay(w);
  const c = (gd !== null && gd < t) ? "r" : "l";
  const gap = t - (w.last == null ? t : w.last);   // 上次见到这个词隔了几天（统计遗忘曲线用）
  const cf = Q.conf[k] || (Q.conf[k] = {failed: false, slow: false});
  if(step.probe === 1){            // 同一天的第二次确认不再重复计数
    if(c === "r"){
      w.rc++; if(!first) w.fg++;
      const b = gapBucket(gap);
      if(b >= 0){ SRS.curve[b][0]++; if(first) SRS.curve[b][1]++; }
    }
    else if(!first) w.lw++;
  }
  first ? w.right++ : w.wrong++;
  w.last = t;
  logAnswer(t, k, first, tries, ms, c, step.probe);
  let res;
  if(cf.failed){
    res = {kind: "retry", from, to: from};     // 前面已经按“答错”处理过，这次只当练习
  }else if(!first){
    cf.failed = true;
    w.box = from === 0 ? 0 : Math.max(1, from - 2);
    w.due = t + 1;
    res = {kind: "fail", from, to: w.box};
  }else{
    if(slow) cf.slow = true;
    if(step.probe < step.need){
      res = {kind: "pending", from, to: from};  // 等待同一天的第二次确认
    }else if(cf.slow){
      w.due = t + INTERVALS[from];
      res = {kind: "hold", from, to: from};
    }else{
      const to = Math.min(5, from + 1);
      w.box = to;
      w.due = t + (from >= 5 ? REPEAT_GAP : INTERVALS[to]);
      w.lastGood = t;
      res = {kind: "up", from, to};
    }
  }
  saveSRS();
  return res;
}
function feedbackText(r){
  switch(r.kind){
    case "up":      return `${STAGES[r.from]} ➜ ${STAGES[r.to]} 长大啦！`;
    case "pending": return "答对啦！等一下再考考你 😉";
    case "hold":    return "答对啦！再熟悉一点就长大 🌱";
    case "fail":    return "再练练，明天再来 🌱";
    case "retry":   return "这次对啦，明天再来 🌱";
    default:        return "";
  }
}

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

/* ---------- 听故事，排顺序 ----------
   学会一个单元的词（等级≥ 1）后解锁：播一遍由几句话组成的小故事，孩子把图片按故事的顺序一张一张点出来。
   不计入复习计划，只记完成次数。 */
const itemById = id => { for(const l of LESSONS){ const it = l.items.find(x => x.id === id); if(it) return it; } return null; };
function storyProgress(st){
  const lesson = LESSONS.find(x => x.id === st.unit);
  const keys = [...new Set((lesson ? lesson.items : []).filter(i => !i.sentence && i.game !== false).map(wkey))];
  const got = keys.filter(k => SRS.words[k] && SRS.words[k].box >= 1).length;
  return {got, need: keys.length, open: keys.length > 0 && got >= keys.length, lesson};
}
function storyHtml(){
  return storyList().map((st, i) => {
    const p = storyProgress(st), n = SRS.story[st.id] || 0;
    return p.open
      ? `<button class="big blue" data-act="story" data-i="${i}">📖 听故事，排顺序<small>${st.title}${n ? ` · 已完成 ${n} 次` : ""}</small></button>`
      : `<div class="big locked">🔒 听故事，排顺序<small>学会“${p.lesson ? p.lesson.zh : ""}”单元的词后解锁 · ${p.got}/${p.need}</small></div>`;
  }).join("");
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
    <div class="choices w story">
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

/* ---------- 小花园 ---------- */
function garden(){
  session++;
  const pool = questPool(), t = todayNum(), s = srsStats();
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    <h2>🌳 我的小花园</h2>
    <div class="sub">种下 ${s.planted}/${s.total} 棵<br>${STAGES.map((g, i) => g + s.byStage[i]).join("　")}</div>
    ${s.thirsty ? `<button class="big quest" data-act="quest" style="margin:4px 0 10px;padding:14px">💧 小树渴了，去浇水</button>` : ""}
    <div class="grid3">
      ${pool.map((it, i) => {
        const w = SRS.words[wkey(it)];
        const stage = w ? STAGES[w.box] : "❓";
        const thirsty = w && w.due <= t;
        return `
        <div class="card mini ${w ? "" : "locked"}" data-act="g-say" data-i="${i}">
          <div class="stage">${stage}${thirsty ? `<span class="drop">💧</span>` : ""}</div>
          <div class="emoji">${it.emoji}</div>
          <div class="en">${it.en}</div>
        </div>`;
      }).join("")}
    </div>
    <div class="footer">点一点图片听发音 · 💧 表示该复习啦<br>答对越多，种子越长越大：🌰→🌱→🌿→🪴→🌳→🍎</div>`;
  playSeq([fx("fx_garden_zh")]);
}

/* ---------- 遗忘曲线（手写 SVG，不依赖任何库） ----------
   横坐标：上次见到这个词隔了几天；纵坐标：隔了这么久后「第一次就点对」的比例。
   每个点下面写测试次数 n；n<3 的点画成空心（样本太少，仅供参考）。 */
function curveSvg(curve){
  const W = 320, H = 178, L = 36, R = 10, T = 16, B = 44, pw = W - L - R, ph = H - T - B;
  const m = GAP_BUCKETS.length;
  const X = i => L + (i + 0.5) * pw / m, Y = p => T + (1 - p) * ph;
  const color = p => p >= 0.8 ? "#43a047" : p >= 0.6 ? "#fb8c00" : "#e53935";
  let g = "";
  [0, 0.5, 1].forEach(p => {
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(p)}" y2="${Y(p)}" stroke="#e0e0e0"/>` +
         `<text x="${L - 4}" y="${Y(p) + 3}" font-size="9" fill="#999" text-anchor="end">${p * 100}%</text>`;
  });
  g += `<line x1="${L}" x2="${W - R}" y1="${Y(0.8)}" y2="${Y(0.8)}" stroke="#a5d6a7" stroke-dasharray="4 3"/>` +
       `<text x="${W - R}" y="${Y(0.8) - 2}" font-size="8" fill="#66bb6a" text-anchor="end">目标 80%</text>`;
  const pts = [];
  curve.forEach((c, i) => {
    const n = c[0], x = X(i);
    g += `<text x="${x}" y="${H - B + 13}" font-size="9" fill="#666" text-anchor="middle">${GAP_BUCKETS[i][2]}</text>` +
         `<text x="${x}" y="${H - B + 25}" font-size="8" fill="#aaa" text-anchor="middle">${n ? "n=" + n : "-"}</text>`;
    if(n) pts.push({x, p: c[1] / n, n});
  });
  if(pts.length > 1) g += `<polyline fill="none" stroke="#ffab91" stroke-width="2" points="${pts.map(q => q.x.toFixed(1) + "," + Y(q.p).toFixed(1)).join(" ")}"/>`;
  pts.forEach(q => {
    const col = color(q.p), few = q.n < 3;
    g += `<circle cx="${q.x.toFixed(1)}" cy="${Y(q.p).toFixed(1)}" r="5" fill="${few ? "#fff" : col}" stroke="${col}" stroke-width="2"/>` +
         `<text x="${q.x.toFixed(1)}" y="${(Y(q.p) - 8).toFixed(1)}" font-size="9" fill="${col}" text-anchor="middle">${Math.round(q.p * 100)}%</text>`;
  });
  g += `<text x="${L + pw / 2}" y="${H - 2}" font-size="9" fill="#999" text-anchor="middle">隔了几天再测</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="遗忘曲线">${g}</svg>`;
}
function curveSection(){
  const total = SRS.curve.reduce((a, c) => a + c[0], 0);
  return `<div class="sec"><h3>遗忘曲线</h3>` +
    (total ? curveSvg(SRS.curve) : `<div class="note">还没有数据。孩子隔天复习过的词多了，这里才会画出曲线。</div>`) +
    `<div class="note">每个点：隔了这么多天再测时，第一次就点对的比例（下面的 n 是测试次数）。曲线慢慢往下掉是正常的，掉得越慢说明记得越牢。空心点表示测试不到 3 次，不要当真。` +
    `这张图从这个版本开始统计，之前的作答没有计入。</div></div>`;
}

/* ---------- 家长页 ---------- */
function parentPage(){
  session++; token++; try{ player.pause(); }catch(e){}
  const t = todayNum(), d = dailyState(), q = buildQueue(), s = srsStats(), pool = questPool();
  const buckets = new Array(8).fill(0);
  pool.forEach(it => { const w = SRS.words[wkey(it)]; if(w) buckets[Math.min(7, Math.max(0, w.due - t))]++; });
  const bl = i => i === 0 ? "今天（含已到期）" : i === 1 ? "明天" : i === 7 ? "7 天以后" : i + " 天后";
  const line = (a, b) => `<div class="line"><span>${a}</span><b>${b}</b></div>`;
  const upcoming = buckets.map((n, i) => n ? line(bl(i), n + " 个") : "").join("") || line("暂无", "");
  const weak = pool.map(it => ({it, w: SRS.words[wkey(it)]}))
    .filter(x => x.w && x.w.fg > 0)
    .sort((a, b) => b.w.fg - a.w.fg || (b.w.fg / (b.w.rc || 1)) - (a.w.fg / (a.w.rc || 1))).slice(0, 5);
  const weakHtml = weak.map(x => line(`${x.it.en} ${x.it.zh}`, `忘 ${x.w.fg} / 复习 ${x.w.rc} 次`)).join("") || line("暂时没有", "");
  const learning = pool.map(it => ({it, w: SRS.words[wkey(it)]}))
    .filter(x => x.w && x.w.box === 0 && x.w.wrong > 0)
    .sort((a, b) => b.w.wrong - a.w.wrong).slice(0, 6);
  const learningHtml = learning.map(x => line(`${x.it.en} ${x.it.zh}`, `答错 ${x.w.wrong} 次`)).join("") || line("暂时没有", "");
  let rc = 0, fg = 0;
  pool.forEach(it => { const w = SRS.words[wkey(it)]; if(w){ rc += w.rc || 0; fg += w.fg || 0; } });
  const rate = rc ? Math.round(fg / rc * 100) + "%" : "—";
  const cfg = normCfg(SRS.cfg);
  const rv = v => Math.round(v * 10), rl = v => "×" + v.toFixed(1);
  const tg = (k, v, label, on) => `<button class="small-btn${on ? " on" : " ghost"}" data-act="p-set" data-k="${k}" data-v="${v}">${label}</button>`;
  const storyDone = Object.values(SRS.story).reduce((a, b) => a + b, 0);
  let hist = "", histN = 0;
  const wdOf = n => (new Date(n * 86400000).getUTCDay() + 6) % 7;   // 周一=0 … 周日=6
  const first = t - 29, startCell = first - wdOf(first), endCell = t + (6 - wdOf(t));
  hist += ["一", "二", "三", "四", "五", "六", "日"].map(w => `<span class="hw">${w}</span>`).join("");
  for(let day = startCell; day <= endCell; day++){
    if(day < first || day > t){ hist += `<span class="hd off"></span>`; continue; }
    const on = SRS.doneDays.includes(day);
    if(on) histN++;
    hist += `<span class="hd${day === t ? " today" : ""}">${on ? "✅" : "▫️"}<i>${dayLabel(day)}</i></span>`;
  }
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    <h2>👨‍👩‍👧 家长页</h2>
    ${typeof weeklySection === "function" ? weeklySection() : ""}
    <div class="sec"><h3>今天</h3>
      ${line("今日任务", d.done ? "已完成 ✅" : "未完成")}
      ${line("待复习的词", q.due.length + " 个")}
      ${line("今天还可学新词", q.news.length + " 个")}
      ${line("连续打卡", currentStreak() + " 天")}
    </div>
    ${tipSection("今日家长小任务", "今天还没有新学的词，也没有答错过的词。完成魔法任务后这里会列出今天该在生活里用一用的词。")}
    <div class="sec"><h3>学习进度</h3>
      ${line("已学 / 总词数", s.planted + " / " + s.total)}
      ${line("已长成苹果树 🍎", s.mastered + " 个")}
      ${line("已记录作答", SRS.log.length + " 次")}
      ${storyList().length ? line("听故事排顺序", "完成 " + storyDone + " 次") : ""}
      <div class="line"><span>${STAGES.map((g, i) => g + s.byStage[i]).join("　")}</span></div>
    </div>
    <div class="sec"><h3>未来 7 天要复习</h3>${upcoming}</div>
    <div class="sec"><h3>遗忘情况</h3>
      ${line("隔天复习测试", rc + " 次")}
      ${line("其中答错（遗忘）", fg + " 次 · " + rate)}
      ${rc < 10 ? `<div class="note">测试次数还少，先别下结论。</div>` : ""}
      <div class="note">只有“之前确实学会过、隔了至少一天、第一次就点错”才算遗忘。分析仅供参考。</div>
    </div>
    ${curveSection()}
    <div class="sec"><h3>最容易忘的词</h3>${weakHtml}</div>
    <div class="sec"><h3>还没学会的词</h3>${learningHtml}</div>
    <div class="sec"><h3>学习方式</h3>
      <div class="note"><b>中文翻译</b>：“只在新词页”是认识新词时才告诉孩子中文，答题时只听英文（每组只在前 2 题用中文提示），英语输入更多，推荐。“总是播放”是每题都带中文提示和翻译，适合刚接触英语的孩子。</div>
      ${tg("zh", "new", "只在新词页", cfg.zh === "new")}${tg("zh", "all", "总是播放", cfg.zh === "all")}
      <div class="note" style="margin-top:12px"><b>说一说</b>：偶尔（约一半的任务）挑一个已经很熟的词（🌳 以上），只给图、让孩子用英语说，由家长点“说对了”或“没说出来”。说对算一次复习答对；没说出来不扣分，会带读并补考一道选择题。</div>
      ${tg("say", "1", "开", cfg.say)}${tg("say", "0", "关", !cfg.say)}
      <div class="note" style="margin-top:12px"><b>动一动</b>：每组任务最后，按1–2 个词播英语指令（如 “Show me a dancer!”），让孩子做动作，家长点“做完啦”。不计分、不影响复习日程。</div>
      ${tg("act", "1", "开", cfg.act)}${tg("act", "0", "关", !cfg.act)}
    </div>
    <div class="sec"><h3>每天新词数</h3>
      <div class="note">每天最多学 <b id="v-new">${cfg.newPerDay}</b> 个新词（可设 ${NEW_MIN}～${NEW_MAX}）。每个新词先教一遍，当天再考 2 次，所以新词约占 <b id="v-newq">${cfg.newPerDay * 2}</b> 题；再加上当天到期的复习题（每组最多 ${MAX_DUE} 个旧词），不足 ${MIN_Q} 题时用已学过的词补满。孩子觉得太简单就调多，注意力不够就调少。当天已学的新词达到上限后，“再练一组”只会复习。</div>
      <input type="range" class="rng" min="${NEW_MIN}" max="${NEW_MAX}" step="1" value="${cfg.newPerDay}" data-set="newPerDay">
      <div class="rngrow"><span>${NEW_MIN}</span><span>${NEW_MAX}</span></div>
    </div>
    <div class="sec"><h3>语速</h3>
      <div class="note">提示语速：中文提示、夸奖（“听一听，找一找”等）。<b id="v-promptRate">${rl(cfg.promptRate)}</b></div>
      <input type="range" class="rng" min="${rv(RATE_MIN)}" max="${rv(RATE_MAX)}" step="1" value="${rv(cfg.promptRate)}" data-set="promptRate">
      <div class="rngrow"><span>×${RATE_MIN.toFixed(1)} 慢</span><span>×${RATE_MAX.toFixed(1)} 快</span></div>
      <div class="note" style="margin-top:10px">英语播放语速：英文单词和句子。<b id="v-enRate">${rl(cfg.enRate)}</b></div>
      <input type="range" class="rng" min="${rv(RATE_MIN)}" max="${rv(RATE_MAX)}" step="1" value="${rv(cfg.enRate)}" data-set="enRate">
      <div class="rngrow"><span>×${RATE_MIN.toFixed(1)} 慢</span><span>×${RATE_MAX.toFixed(1)} 快</span></div>
      <button class="small-btn" data-act="p-try-prompt">🔊 试听提示</button>
      <button class="small-btn" data-act="p-try-en">🔊 试听英语</button>
      <div class="note" style="margin-top:6px">×1.0 是原速（英语本来就已经放慢了一点）。超过 ×1.5 或低于 ×0.7 时声音可能有点变调。个别手机浏览器（比如部分安卓微信）可能不支持变速，听起来没变化时请用系统浏览器打开。</div>
    </div>
    <div class="sec"><h3>最近 30 天打卡</h3><div class="note" style="margin-top:0">最近 30 天里打卡了 <b>${histN}</b> 天</div><div class="hist">${hist}</div></div>
    ${typeof accountSection === "function" ? accountSection() : ""}
    <div class="sec"><h3>复习规则</h3>
      <div class="note">学会后在第 1、2、4、7、15 天各复习一次。新词要在同一天连续两次第一次就点对，而且没有犹豫太久（听完后 9 秒内），才算学会、小树长大；犹豫的算不稳，不升级；点错会降级，明天再练。词长到 🌿 以后改成 4 选 1，到 🪴 以后有句子的词改听整句，复习题会随机换一个英文声音。答错的词隔几题后会再考一次（只算练习，不影响复习日程和统计）；连点错 2 次会把正确的图亮出来带孩子读。每天新词数和语速可在上面调整。</div>
    </div>`;
  if(typeof afterParentRender === "function") afterParentRender();
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
    case "story":    storyStart(i); break;
    case "st-pick":  storyPick(i, t); break;
    case "st-play":  if(S && !S.locked) playSeq(storyClips()); break;
    case "st-again": if(S) storyStart(S.idx); break;
    case "p-set": {
      const k = t.dataset.k, v = t.dataset.v, c = normCfg(SRS.cfg);
      if(k === "zh") c.zh = v === "all" ? "all" : "new";
      else if(k === "say" || k === "act") c[k] = v === "1";
      else break;
      SRS.cfg = c; saveSRS();
      const y = (typeof window !== "undefined" && window.scrollY) || 0;
      parentPage();                                  // 重新画一遍，再回到原来的滚动位置
      try{ window.scrollTo(0, y); }catch(err){}
      break;
    }
    case "garden":   garden(); break;
    case "g-say": {
      const it = questPool()[i];
      if(it) playSeq([enClip(it), zhClip(it)]);
      break;
    }
    case "parent":   parentPage(); break;
    case "p-try-prompt": playSeq([fx("fx_find_zh"), fx("fx_good_zh")]); break;
    case "p-try-en": {
      const it = questPool().find(p => p.sen) || questPool()[0];
      playSeq([enClip(it), ...(it.sen ? [senClip(it)] : [])]);
      break;
    }
    case "p-reset":
      if(confirm("确定清空所有学习进度吗？此操作不能撤销。每天新词数和语速设置会保留。")){
        const keep = normCfg(SRS.cfg);
        SRS = freshSRS(); SRS.cfg = keep; saveSRS(); parentPage();
      }
      break;
  }
});

// 家长页的滑动条：拖动时实时保存并更新数字，语速条松手后试听一句
function applySetting(key, raw){
  const cfg = normCfg(SRS.cfg);
  if(key === "newPerDay") cfg.newPerDay = Math.round(clampNum(raw, NEW_MIN, NEW_MAX, NEW_DEFAULT));
  else if(key === "enRate" || key === "promptRate") cfg[key] = Math.round(clampNum(raw / 10, RATE_MIN, RATE_MAX, 1) * 10) / 10;
  else return null;
  SRS.cfg = cfg; saveSRS();
  const set = (id, text) => { const e = document.getElementById(id); if(e) e.textContent = text; };
  if(key === "newPerDay"){ set("v-new", cfg.newPerDay); set("v-newq", cfg.newPerDay * 2); }
  else set("v-" + key, "×" + cfg[key].toFixed(1));
  return cfg;
}
document.addEventListener("input", e => {
  const el = e.target;
  if(el && el.dataset && el.dataset.set) applySetting(el.dataset.set, el.value);
});
document.addEventListener("change", e => {
  const el = e.target;
  if(!el || !el.dataset || !el.dataset.set || el.dataset.set === "newPerDay") return;
  applySetting(el.dataset.set, el.value);
  const t = el.dataset.set === "enRate" ? "p-try-en" : "p-try-prompt";
  const btn = document.querySelector(`[data-act="${t}"]`);
  if(btn) btn.click();
});
