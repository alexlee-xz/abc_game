/* ============ 间隔复习（艾宾浩斯）的核心：存档、设置、调度、每个词的记录 ============
   不碰页面（页面在 js/pages/ 里）。依赖：profile.js（小朋友账户和存储）、speak.js（normRec 等录音设置）、
   data.js（词库）。进度保存在 localStorage（同一台手机、同一个浏览器内有效），每个小朋友一份。 */


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
  cfg: {newPerDay: NEW_DEFAULT, enRate: 1, promptRate: 1, zh: "new", say: true, act: true,
        recWord: [REC_KINDS.word.min, REC_KINDS.word.max], recSen: [REC_KINDS.sen.min, REC_KINDS.sen.max]},
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
          say: c.say !== false, act: c.act !== false,   // “说一说”、“动一动”开关，默认开
          recWord: normRec(c.recWord, "word"), recSen: normRec(c.recSen, "sen")};   // 跟读录音时长 [最短, 最长] 秒（speak.js）
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
// 跟读录音时长（毫秒）：句子和单词分开设置。speak.js 的 doRec 用
function recRange(isSen){
  const c = normCfg(SRS.cfg), r = isSen ? c.recSen : c.recWord;
  return {min: r[0] * 1000, max: r[1] * 1000};
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
