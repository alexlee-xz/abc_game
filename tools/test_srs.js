// Offline test for srs.js (no browser needed):  node tools/test_srs.js
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const ctx = vm.createContext({console, setTimeout, setImmediate});

const store = {};
let clickHandler = null, inputHandler = null, changeHandler = null;
const prelude = `
  globalThis.localStorage = {getItem:k=>(k in __store?__store[k]:null), setItem:(k,v)=>{__store[k]=String(v)}};
  globalThis.alert = ()=>{}; globalThis.confirm = ()=>true;
  const els = {};
  globalThis.document = {
    addEventListener:(t,f)=>{ if(t==='click') __setHandler(f); else __setHandler2(t,f); },
    getElementById:id=>els[id]||(els[id]={value:'',textContent:'',select(){},setSelectionRange(){}}),
    execCommand:()=>true
  };
  let NOW = Date.UTC(2026,9,19,12);
  const RD = Date;
  globalThis.Date = class extends RD{ constructor(...a){ a.length?super(...a):super(NOW);} static now(){return NOW;} };
  globalThis.__advanceDay = n => { NOW += n*86400000; };
  globalThis.__advanceMs = n => { NOW += n; };
  const app = {innerHTML:''};
  let session = 0, token = 0;
  const player = {pause(){}};
  const played = [];
  const playSeq = async list => { played.push(list.filter(Boolean).map(c=>c.url)); return true; };
  const shuffle = a => a.slice().sort(()=>Math.random()-0.5);
  const clip = (kind,id,text,lang)=>({url:'audio/'+kind+'/'+id+'.mp3',text,lang});
  const enClip=it=>clip('en',it.id,it.en,'en'), zhClip=it=>clip('zh',it.id,it.zh,'zh');
  const senClip=it=>clip('sen',it.id,it.sen,'en'), senZhClip=it=>clip('senzh',it.id,it.senZh,'zh');
  const fx = id => { const f = FX.find(x=>x.id===id); return f ? clip('fx',id,f.text,f.lang) : null; };
  const promptClips = it => [it.sen ? senClip(it) : enClip(it)];
`;
ctx.__store = store;
ctx.__setHandler = f => { clickHandler = f; };
ctx.__setHandler2 = (t, f) => { if(t === "input") inputHandler = f; if(t === "change") changeHandler = f; };

vm.runInContext(fs.readFileSync(path.join(root, "data.js"), "utf8"), ctx);
vm.runInContext(prelude, ctx);
// speak.js provides ipaHtml/recHtml used by the new-word page (its click listener is harmless here)
vm.runInContext("globalThis.window = globalThis; globalThis.navigator = {};", ctx);
vm.runInContext(fs.readFileSync(path.join(root, "speak.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "srs.js"), "utf8"), ctx);
const ev = code => vm.runInContext(code, ctx);
// values coming out of the vm have another realm's prototypes; JSON round-trip for deep comparisons
const J = x => JSON.parse(JSON.stringify(x));

// every audio file referenced must exist
const missing = [];
ev(`LESSONS`).forEach(l => l.items.forEach(it => {
  const files = [`en/${it.id}`, `zh/${it.id}`].concat(it.sen ? [`sen/${it.id}`, `senzh/${it.id}`] : []);
  files.forEach(f => { if(!fs.existsSync(path.join(root, "audio", f + ".mp3"))) missing.push(f); });
}));
ev(`FX`).forEach(f => { if(!fs.existsSync(path.join(root, "audio", "fx", f.id + ".mp3"))) missing.push("fx/" + f.id); });
assert.strictEqual(missing.length, 0, "missing audio: " + missing.join(","));

const tick = () => new Promise(r => setImmediate(r));
async function click(act, i = 0){
  const t = {dataset: {act, i: String(i)}, classList: {add(){}, remove(){}}};
  clickHandler({target: {closest: () => t}});
  await tick(); await tick();
}

/* Run one whole quest.
   o.wrongFor : Set of word keys answered wrongly first (every time they appear)
   o.wrong(step, key) : return true to tap a wrong card first
   o.slow(step, key)  : return true to wait 12 s (after the prompt ends) before the first tap */
async function runQuest(o = {}){
  ev(`app.innerHTML=''`);
  await click("quest");
  await drive(o);
}
async function drive(o = {}){
  let guard = 0;
  while(ev(`Q.i < Q.steps.length`)){
    if(++guard > 120) throw new Error("quest does not terminate");
    const step = ev(`Q.steps[Q.i]`);
    if(step.type === "teach"){ await click("q-next"); continue; }
    const cur = ev(`Q.cur`), choices = ev(`Q.choices`);
    const key = cur.en.toLowerCase();
    const right = choices.findIndex(c => c.en.toLowerCase() === key);
    const box = (ev(`SRS.words[${JSON.stringify(key)}]`) || {box: 0}).box;
    const n = box >= 2 ? 4 : 3;       // level 2 (🌿) and up: 4 choices
    assert(right >= 0 && choices.length === n, `bad choices for ${key} box ${box}: ${choices.length}`);
    assert.strictEqual(new Set(choices.map(c => c.en)).size, n, "duplicate choices");
    if(o.slow && o.slow(step, key)) ev(`__advanceMs(12000)`);
    const wantWrong = (o.wrongFor && o.wrongFor.has(key)) || (o.wrong && o.wrong(step, key));
    if(wantWrong){
      const wrong = choices.findIndex((c, k) => k !== right);
      await click("q-choose", wrong);
    }
    await click("q-choose", right);
  }
  assert(/任务完成/.test(ev(`app.innerHTML`)), "finish screen not shown");
}
const reset = () => ev(`SRS = freshSRS(); saveSRS(); Q = null;`);
const W = k => J(ev(`SRS.words[${JSON.stringify(k)}]`));
const logOf = () => J(ev(`SRS.log`));
const today = () => ev(`todayNum()`);
const seed = (k, o) => ev(`SRS.words[${JSON.stringify(k)}] = Object.assign(newWord(todayNum()), ${JSON.stringify(o)});`);
const capNew = () => ev(`SRS.daily = {day: todayNum(), newCount: 99, done: false};`);   // no new words today

(async () => {
  const pool = ev(`questPool()`);
  assert.strictEqual(pool.length, 19, "pool size " + pool.length);
  assert.strictEqual(new Set(pool.map(p => p.en)).size, 19);
  assert(pool.find(p => p.en === "firefighter").sen, "firefighter should keep sentence version");

  /* ---------- Day 0 (standard level): 3 new words, each confirmed twice ---------- */
  reset();
  await runQuest();
  let steps = J(ev(`Q.steps`));
  assert.strictEqual(steps.filter(s => s.type === "teach").length, 3);
  assert.strictEqual(steps.filter(s => s.type === "quiz").length, 6, "new words get 2 probes each");
  steps.forEach((s, i) => {      // the two probes of one word are never back-to-back
    if(i && s.type === "quiz" && steps[i - 1].type === "quiz") assert.notStrictEqual(s.it.en, steps[i - 1].it.en);
  });
  let w = J(ev(`SRS.words`));
  assert.strictEqual(Object.keys(w).length, 3);
  Object.values(w).forEach(x => {
    assert.strictEqual(x.box, 1); assert.strictEqual(x.due, today() + 1);
    assert.strictEqual(x.lastGood, today()); assert.strictEqual(x.rc, 0); assert.strictEqual(x.fg, 0); assert.strictEqual(x.lw, 0);
  });
  let lg = logOf();
  assert.strictEqual(lg.length, 6);
  lg.forEach(e => { assert.strictEqual(e.c, "l"); assert.strictEqual(e.ok, 1); assert.strictEqual(e.n, 1); assert.strictEqual(e.ms, 0); });
  assert.strictEqual(lg.filter(e => e.p === 1).length, 3); assert.strictEqual(lg.filter(e => e.p === 2).length, 3);
  assert.strictEqual(ev(`SRS.streak`), 1);
  // finish page: parent tips for the 3 new words
  const fin = ev(`app.innerHTML`);
  assert(/家长小任务/.test(fin) && (fin.match(/class="tip"/g) || []).length === 3, "finish page lists the 3 new words with tips");
  assert.strictEqual(ev(`SRS.daily.news.length`), 3);

  /* ---------- guess protection: wrong on the 2nd confirmation => not learned ---------- */
  reset();
  await runQuest({wrong: (s, k) => s.probe === 2 && k === "fire station"});
  w = W("fire station");
  assert.strictEqual(w.box, 0); assert.strictEqual(w.lastGood, null); assert.strictEqual(w.due, today() + 1);
  assert.strictEqual(w.wrong, 1); assert.strictEqual(w.lw, 0, "2nd-probe miss is not double counted");
  assert.strictEqual(W("alarm bell").box, 1);

  /* ---------- slow (hesitant) answer => not promoted, same interval ---------- */
  reset();
  await runQuest({slow: (s, k) => s.probe === 2 && k === "alarm bell"});
  w = W("alarm bell");
  assert.strictEqual(w.box, 0, "slow answer must not level up"); assert.strictEqual(w.lastGood, null);
  assert.strictEqual(w.due, today() + 1);
  assert.strictEqual(W("fire station").box, 1);
  const slowEntry = logOf().find(e => e.k === "alarm bell" && e.p === 2);
  assert(slowEntry.ms >= 12000 && slowEntry.ok === 1, "slow entry logged: " + JSON.stringify(slowEntry));

  /* ---------- forgetting vs not-yet-learned ---------- */
  reset(); capNew();
  const t = today();
  seed("fire station", {box: 3, due: t, right: 3, last: t - 5, lastGood: t - 5, rc: 2});
  seed("alarm bell",   {box: 0, due: t, last: t - 1});          // never confirmed
  await runQuest({wrongFor: new Set(["fire station", "alarm bell"])});
  let fs1 = W("fire station"), ab = W("alarm bell");
  assert.strictEqual(fs1.fg, 1); assert.strictEqual(fs1.rc, 3); assert.strictEqual(fs1.lw, 0);
  assert.strictEqual(fs1.box, 1); assert.strictEqual(fs1.due, t + 1); assert.strictEqual(fs1.lastGood, t - 5);
  assert.strictEqual(ab.fg, 0, "a new word answered wrong is NOT forgetting"); assert.strictEqual(ab.rc, 0);
  assert.strictEqual(ab.lw, 1, "counted once, not for each confirmation"); assert.strictEqual(ab.box, 0); assert.strictEqual(ab.due, t + 1);
  lg = logOf();
  assert.strictEqual(lg.find(e => e.k === "fire station").c, "r");
  assert(lg.filter(e => e.k === "alarm bell" && e.c !== "x").every(e => e.c === "l"));
  assert.strictEqual(lg.find(e => e.k === "fire station").ok, 0);
  assert.strictEqual(lg.find(e => e.k === "fire station").n, 2);
  assert(lg.some(e => e.k === "fire station" && e.c === "x"), "missed word was re-asked as practice");
  // parent page lists today's missed words with a tip
  ev(`parentPage()`);
  {
    const h = ev(`app.innerHTML`);
    assert(/今天答错过/.test(h) && /Fire station!/.test(h) && /Alarm bell!/.test(h), "parent tips for missed words");
  }

  /* ---------- slow answer on a review word: hold ---------- */
  reset(); capNew();
  seed("hose", {box: 2, due: today(), right: 2, last: today() - 1, lastGood: today() - 1});
  await runQuest({slow: () => true});
  w = W("hose");
  assert.strictEqual(w.box, 2); assert.strictEqual(w.due, today() + 1);          // INTERVALS[2] = 1
  assert.strictEqual(w.lastGood, today() - 1); assert.strictEqual(w.rc, 1); assert.strictEqual(w.fg, 0);

  /* ---------- practice questions top up the session without touching the schedule ---------- */
  reset(); capNew();
  pool.forEach(p => seed(p.en.toLowerCase(), {box: 2, due: today() + 9, right: 2, last: today() - 1, lastGood: today() - 1}));
  seed("hose", {box: 2, due: today(), right: 2, last: today() - 1, lastGood: today() - 1});
  const before = J(ev(`SRS.words`));
  await runQuest();
  steps = J(ev(`Q.steps`));
  assert.strictEqual(steps.filter(s => s.type === "quiz").length, 10, "standard level tops up to 10 questions");
  assert.strictEqual(steps.filter(s => s.extra).length, 9);
  const after = J(ev(`SRS.words`));
  Object.keys(before).forEach(k => {
    if(k === "hose") return;
    assert.strictEqual(JSON.stringify(after[k]), JSON.stringify(before[k]), "extra practice changed " + k);
  });
  assert.strictEqual(after["hose"].box, 3);
  assert.strictEqual(logOf().filter(e => e.c === "x").length, 9);

  /* ---------- harder choices, sentence prompts, wrong-answer handling, parent tips ---------- */
  {
    const keys = new Set(pool.map(p => p.en.toLowerCase()));
    Object.entries(J(ev(`CONFUSE`))).forEach(([k, v]) => [k, ...v].forEach(x => assert(keys.has(x), "CONFUSE unknown word " + x)));
    const tips = J(ev(`TIPS`));
    keys.forEach(k => assert(tips[k], "missing tip for " + k));
    const pick = k => J(ev(`pickChoices(questPool().find(p => p.en === ${JSON.stringify(k)}))`)).map(x => x.en);

    reset();
    seed("doctor", {box: 1});
    for(let n = 0; n < 30; n++) assert.strictEqual(pick("doctor").length, 3, "low level: 3 choices");
    seed("doctor", {box: 2}); seed("vet", {box: 4}); seed("hose", {box: 2});
    for(let n = 0; n < 40; n++){
      const c = pick("doctor");
      assert(c.length === 4 && new Set(c).size === 4 && c.includes("doctor") && c.includes("nurse") && c.includes("vet"), "confusable choices: " + c);
      const v = pick("vet");
      assert(v.length === 4 && v.includes("doctor") && v.includes("nurse"), "reverse lookup: " + v);
      const h = pick("hose");
      assert(h.length === 4 && h.filter(x => ["pole", "fire station", "firefighter"].includes(x)).length >= 2, "hose choices: " + h);
    }
    // a word without a confusable list still gets 4 distinct choices
    seed("astronaut", {box: 3});
    for(let n = 0; n < 20; n++){ const c = pick("astronaut"); assert(c.length === 4 && new Set(c).size === 4); }

    // sentence prompt: only from level 3, only for words that have a sentence
    const sen = k => ev(`useSen(questPool().find(p => p.en === ${JSON.stringify(k)}))`);
    seed("teacher", {box: 2}); assert.strictEqual(sen("teacher"), false);
    seed("teacher", {box: 3}); assert.strictEqual(sen("teacher"), true);
    seed("hose", {box: 5});    assert.strictEqual(sen("hose"), false, "no sentence for hose");
    for(const [box, url] of [[2, "audio/en/teacher.mp3"], [3, "audio/sen/teacher.mp3"]]){
      reset(); capNew();
      seed("teacher", {box, due: today(), right: 2, last: today() - 1, lastGood: today() - 1});
      ev(`played.length = 0`);
      await click("quest");
      assert.strictEqual(ev(`Q.cur.en`), "teacher");
      assert.strictEqual(ev(`Q.sent`), box >= 3);
      assert(J(ev(`played`)).flat().includes(url), "prompt clip for box " + box);
      ev(`played.length = 0`); await click("q-repeat");
      assert.strictEqual(JSON.stringify(J(ev(`played`))), JSON.stringify([[url]]), "repeat uses the same clip");
      await drive();
    }

    // wrong answers: 1st wrong = try again; 2nd wrong = show the answer; missed word comes back later as practice only
    reset(); capNew();
    ["teacher", "vet"].forEach(k => seed(k, {box: 3, due: today(), right: 3, last: today() - 2, lastGood: today() - 2}));
    await click("quest");
    const k0 = ev(`Q.cur.en`), chs = J(ev(`Q.choices`));
    const ridx = chs.findIndex(c => c.en === k0), widx = chs.findIndex((c, i) => i !== ridx);
    ev(`played.length = 0`); await click("q-choose", widx);
    assert(J(ev(`played`)).flat().includes("audio/fx/fx_try_en.mp3"), "1st wrong: try again");
    ev(`played.length = 0`); await click("q-choose", widx);
    assert(J(ev(`played`)).flat().includes("audio/fx/fx_look_zh.mp3"), "2nd wrong: show and read the answer");
    await click("q-choose", ridx);
    assert.strictEqual(ev(`Q.steps.filter(s => s.retry).length`), 1, "missed word re-queued once");
    assert.strictEqual(ev(`Q.steps.length`), 3);
    await drive();
    const other = k0 === "teacher" ? "vet" : "teacher";
    w = W(k0);
    assert.strictEqual(w.box, 1); assert.strictEqual(w.due, today() + 1, "retry must not change the schedule");
    assert.strictEqual(W(other).box, 4);
    assert(logOf().some(e => e.k === k0 && e.c === "x" && e.ok === 1), "retry logged as practice");
    assert(/1 \/ 2 个/.test(ev(`app.innerHTML`)), "retry is not counted in the question total");
    // answering the retry wrong again does not loop forever
    reset(); capNew();
    ["teacher", "vet"].forEach(k => seed(k, {box: 3, due: today(), right: 3, last: today() - 2, lastGood: today() - 2}));
    await runQuest({wrongFor: new Set(["teacher", "vet"])});
    assert.strictEqual(ev(`Q.steps.length`), 4, "each miss is re-asked at most once");
    assert.strictEqual(ev(`Q.steps.filter(s => s.retry).length`), 2);
    reset();
    ev(`parentPage()`);
    assert(/今天还没有新学的词/.test(ev(`app.innerHTML`)), "empty tip message");
  }

  /* ---------- forgetting curve: buckets, aggregation, chart ---------- */
  [[1, 0], [2, 1], [3, 2], [4, 2], [5, 3], [7, 3], [8, 4], [14, 4], [15, 5], [29, 5], [30, 6], [400, 6], [0, -1]].forEach(([g, b]) =>
    assert.strictEqual(ev(`gapBucket(${g})`), b, "gap " + g));
  reset();
  assert(/还没有数据/.test((ev(`parentPage()`), ev(`app.innerHTML`))), "empty curve message");
  assert(!/<svg/.test(ev(`app.innerHTML`)), "no chart without data");
  capNew();
  seed("hose", {box: 2, due: today(), right: 2, last: today() - 3, lastGood: today() - 3});
  seed("pole", {box: 2, due: today(), right: 2, last: today() - 1, lastGood: today() - 1});
  await runQuest();
  assert.strictEqual(JSON.stringify(ev(`SRS.curve`)), JSON.stringify([[1, 1], [0, 0], [1, 1], [0, 0], [0, 0], [0, 0], [0, 0]]), "gap 1 and gap 3 recorded");
  await runQuest();     // same day again: gap 0 -> not counted
  assert.strictEqual(ev(`SRS.curve.reduce((a, c) => a + c[0], 0)`), 2, "same-day repeat is not a recall test");
  ev(`__advanceDay(1)`);
  ev(`SRS.words["hose"].due = todayNum()`);
  await runQuest({wrongFor: new Set(["hose"])});
  assert.strictEqual(JSON.stringify(ev(`SRS.curve[0]`)), JSON.stringify([2, 1]), "forgotten word counts as a miss at gap 1");
  ev(`parentPage()`);
  const chart = ev(`app.innerHTML`);
  assert(/<svg[^>]*aria-label="遗忘曲线"/.test(chart) && /<polyline/.test(chart) && /<circle/.test(chart) && /n=2/.test(chart), "curve chart rendered");
  assert(/#fff/.test(chart), "few-sample points are hollow");
  const bk2 = JSON.parse(ev(`backupText()`));
  assert(Array.isArray(bk2.curve) && bk2.curve.length === 7, "backup keeps the curve");
  ev(`SRS = normSRS(${JSON.stringify(bk2)})`);
  assert.strictEqual(JSON.stringify(ev(`SRS.curve[0]`)), JSON.stringify([2, 1]), "curve survives import");
  ev(`SRS = normSRS({words: {}, curve: [[5, 9], "x", null]})`);                 // garbage -> fresh
  assert.strictEqual(ev(`SRS.curve.length`), 7); assert.strictEqual(ev(`SRS.curve.reduce((a, c) => a + c[0], 0)`), 0);
  ev(`SRS = normSRS({words: {}, curve: [[5, 9],[1,1],[0,0],[0,0],[0,0],[0,0],[0,0]]})`);   // ok can't exceed n
  assert.strictEqual(JSON.stringify(ev(`SRS.curve[0]`)), JSON.stringify([5, 5]));
  reset();

  /* ---------- new words per day 1..20: exactly that many new words, capped per day, nothing starves ---------- */
  for(let n = 1; n <= 20; n++){
    reset(); ev(`SRS.cfg.newPerDay = ${n}`);
    let taught = 0;
    for(let day = 0; day < 8; day++){
      if(day) ev(`__advanceDay(1)`);
      const learned = Object.keys(ev(`SRS.words`)).length;
      await runQuest();
      const teach = ev(`Q.steps.filter(s => s.type === "teach").length`);
      const qs = ev(`Q.steps.filter(s => s.type === "quiz").length`);
      taught += teach;
      assert.strictEqual(teach, Math.min(n, 19 - (taught - teach)), `n=${n} day ${day}: new words taught`);
      assert(qs >= Math.min(10, 2 * teach + learned), `n=${n} day ${day}: only ${qs} questions`);
      assert(ev(`SRS.daily`).newCount <= n, "new words over cap");
    }
    assert.strictEqual(taught, Math.min(19, n * 8), `n=${n}: total taught`);
  }
  // after today's new words are used up, "another round" only reviews (no extra new words)
  reset(); ev(`SRS.cfg.newPerDay = 2`);
  await runQuest(); await runQuest();
  assert.strictEqual(Object.keys(ev(`SRS.words`)).length, 2, "second round same day adds no new words");
  reset();
  assert.strictEqual(ev(`newPerDay()`), 3);
  // sliders: out-of-range values are clamped, labels update, settings persist
  const slider = (k, v) => inputHandler({target: {dataset: {set: k}, value: String(v)}});
  slider("newPerDay", 99); assert.strictEqual(ev(`newPerDay()`), 20);
  slider("newPerDay", 0);  assert.strictEqual(ev(`newPerDay()`), 3);   // 0 / garbage -> default
  slider("newPerDay", 1);  assert.strictEqual(ev(`newPerDay()`), 1);
  slider("newPerDay", 7);
  assert.strictEqual(ev(`document.getElementById("v-new").textContent`), 7);
  assert.strictEqual(ev(`document.getElementById("v-newq").textContent`), 14);
  slider("promptRate", 8); slider("enRate", 13);
  assert.strictEqual(ev(`SRS.cfg.promptRate`), 0.8); assert.strictEqual(ev(`SRS.cfg.enRate`), 1.3);
  slider("enRate", 99); assert.strictEqual(ev(`SRS.cfg.enRate`), 2);
  slider("enRate", 20); assert.strictEqual(ev(`SRS.cfg.enRate`), 2);
  slider("enRate", 2);  assert.strictEqual(ev(`SRS.cfg.enRate`), 0.5);
  slider("enRate", 5);  assert.strictEqual(ev(`SRS.cfg.enRate`), 0.5);
  slider("promptRate", 15); assert.strictEqual(ev(`SRS.cfg.promptRate`), 1.5);
  assert.strictEqual(JSON.parse(store.abc_srs_v1).cfg.newPerDay, 7, "saved");
  // rate chosen per clip type
  slider("promptRate", 8); slider("enRate", 7);
  assert.strictEqual(ev(`rateFor(enClip(LESSONS[0].items[0]))`), 0.7);
  assert.strictEqual(ev(`rateFor(zhClip(LESSONS[0].items[0]))`), 0.8);
  assert.strictEqual(ev(`rateFor(fx("fx_good_en"))`), 0.8);
  assert.strictEqual(ev(`rateFor({url: "blob:xyz"})`), 1);
  // parent page shows the settings and the preview buttons play something
  await click("parent");
  const ph = ev(`app.innerHTML`);
  assert(/data-set="newPerDay"/.test(ph) && /data-set="enRate"/.test(ph) && /data-set="promptRate"/.test(ph));
  assert(/value="7" data-set="newPerDay"/.test(ph) && /value="8" data-set="promptRate"/.test(ph));
  assert(/min="5" max="20"/.test(ph), "speed sliders cover x0.5 - x2.0");
  ev(`played.length = 0`); await click("p-try-prompt"); await click("p-try-en");
  assert.strictEqual(ev(`played.length`), 2);
  // reset keeps the settings
  await click("p-reset");
  assert.strictEqual(ev(`newPerDay()`), 7); assert.strictEqual(ev(`SRS.cfg.enRate`), 0.7);
  // old saves: three levels -> 2 / 3 / 4 words; per-session quiz count -> ~30% new words
  [["{level:0}", 2], ["{level:1}", 3], ["{level:2}", 4], ["{level:99}", 3], ["{quiz:6}", 2], ["{quiz:10}", 3], ["{quiz:14}", 4], ["{quiz:20}", 6], ["{}", 3]].forEach(([c, n]) => {
    ev(`SRS = normSRS({words: {}, cfg: ${c}})`); assert.strictEqual(ev(`newPerDay()`), n, "legacy cfg " + c);
  });
  // out-of-range speeds in an imported backup are clamped
  ev(`SRS = normSRS({words: {}, cfg: {newPerDay: 500, enRate: 9, promptRate: 0.1}})`);
  assert.strictEqual(ev(`newPerDay()`), 20); assert.strictEqual(ev(`SRS.cfg.enRate`), 2); assert.strictEqual(ev(`SRS.cfg.promptRate`), 0.5);
  reset();

  /* ---------- 45 days of all-correct use: schedule, caps, streak (NEW=n to try other volumes) ---------- */
  if(process.env.NEW) ev(`SRS.cfg.newPerDay = ${+process.env.NEW}`);
  const perDay = [];
  await runQuest();
  perDay.push(ev(`Q.steps.filter(s => s.type === "quiz").length`));
  const first = "fire station", t0 = today();
  const reviewDays = [];
  for(let day = 1; day <= 45; day++){
    ev(`__advanceDay(1)`);
    const before1 = ev(`SRS.words["${first}"]`);
    const due = before1 && before1.due <= t0 + day;
    await runQuest();
    perDay.push(ev(`Q.steps.filter(s => s.type === "quiz").length`));
    if(due) reviewDays.push(day);
    assert(ev(`SRS.daily`).newCount <= ev(`newPerDay()`), "too many new words");
    ev(`homeQuestHtml()`); ev(`garden()`); ev(`parentPage()`);
  }
  assert.strictEqual(JSON.stringify(reviewDays.slice(0, 6)), JSON.stringify([1, 2, 4, 7, 15, 30]), "schedule: " + reviewDays);
  assert.strictEqual(ev(`SRS.words["${first}"].box`), 5);
  assert.strictEqual(ev(`SRS.streak`), 46);
  assert.strictEqual(Object.keys(ev(`SRS.words`)).length, 19, "all words introduced");
  assert(ev(`SRS.log.length`) <= 400 && ev(`SRS.log.length`) > 100, "log capped: " + ev(`SRS.log.length`));
  // all-correct, fast play never counts as forgetting
  assert.strictEqual(ev(`questPool().reduce((n, it) => n + SRS.words[wkey(it)].fg, 0)`), 0);

  // a wrong answer on a confirmed word (tested a day after it was confirmed): drops level, due tomorrow, counts as forgotten
  ev(`__advanceDay(1)`);
  ev(`SRS.words["${first}"].due = todayNum()`);
  const rcBefore = ev(`SRS.words["${first}"].rc`);
  await runQuest({wrongFor: new Set([first])});
  w = W(first);
  assert.strictEqual(w.box, 3); assert.strictEqual(w.wrong, 1); assert.strictEqual(w.fg, 1); assert.strictEqual(w.rc, rcBefore + 1);
  assert.strictEqual(w.due, today() + 1);

  // nothing due: free practice, schedule untouched
  ev(`Object.values(SRS.words).forEach(x=>x.due=todayNum()+5)`);
  const snap = JSON.stringify(ev(`SRS.words`));
  await runQuest();
  assert.strictEqual(ev(`Q.mode`), "practice");
  assert.strictEqual(JSON.stringify(ev(`SRS.words`)), snap, "practice must not change schedule");

  /* ---------- parent page: forgetting section, backup, import of old data ---------- */
  ev(`parentPage()`);
  let html = ev(`app.innerHTML`);
  assert(/遗忘情况/.test(html) && /最容易忘的词/.test(html) && /还没学会的词/.test(html) && /每天新词数/.test(html) && /语速/.test(html));
  assert(/忘 1 \/ 复习 \d+ 次/.test(html), "weak word listed");
  // check-in calendar: Monday-first weekday header, 7 cells per row, 30 real days, today is last real cell
  {
    const hs = html.match(/<div class="hist">([\s\S]*?)<\/div><\/div>/)[1];
    const heads = (hs.match(/class="hw"/g) || []).length;
    const days = (hs.match(/class="hd(?: today)?"/g) || []).length;
    const blanks = (hs.match(/class="hd off"/g) || []).length;
    assert.strictEqual(heads, 7, "7 weekday headers");
    assert.strictEqual(days, 30, "30 real days");
    assert.strictEqual((days + blanks) % 7, 0, "whole weeks");
    assert.strictEqual((hs.match(/hd today/g) || []).length, 1, "one today cell");
    const wd = (ev(`new Date(todayNum() * 86400000).getUTCDay()`) + 6) % 7;
    assert.strictEqual(blanks - (6 - wd) >= 0 && blanks - (6 - wd) <= 6, true, "leading blanks within a week");
  }
  const bk = JSON.parse(ev(`backupText()`));
  assert(!("log" in bk) && bk.words && bk.cfg, "backup has no log but keeps stats");
  // legacy save (no cfg/log, words without new counters) must load and render
  ev(`SRS = normSRS({words: {"hose": {box: 2, due: todayNum(), seen: 1, right: 2, wrong: 1, last: todayNum() - 1}},
                      daily: {day: 0, newCount: 0, done: false}, doneDays: [], streak: 0, lastDone: 0})`);
  assert.strictEqual(ev(`newPerDay()`), 3); assert.strictEqual(ev(`SRS.log.length`), 0);
  ev(`parentPage()`); ev(`homeQuestHtml()`); ev(`garden()`);
  await runQuest();
  assert.strictEqual(W("hose").rc, 1, "legacy word counted as recall test");
  // reset button
  ev(`parentPage()`);
  await click("p-reset");
  assert.strictEqual(Object.keys(ev(`SRS.words`)).length, 0);
  assert.strictEqual(ev(`newPerDay()`), 3);
  // log cap
  ev(`for(let n = 0; n < 450; n++) logAnswer(1, "x", true, 1, 0, "l", 1);`);
  assert.strictEqual(ev(`SRS.log.length`), 400);

  console.log("ALL OK; review days for first word:", reviewDays.slice(0, 6).join(","));
  const firstWeek = perDay.slice(0, 7), steady = perDay.slice(7);
  console.log("questions/day  first 7 days:", firstWeek.join(" "), " | after that min/avg/max:",
    Math.min(...steady), (steady.reduce((a, b) => a + b, 0) / steady.length).toFixed(1), Math.max(...steady));
})().catch(e => { console.error("FAIL:", e.stack || e); process.exit(1); });
