// Offline test for srs.js (no browser needed):  node tests/test_srs.js
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const ctx = vm.createContext({console, setTimeout, setImmediate});

const store = {};
const clickHandlers = [], inputHandlers = [], changeHandlers = [], keyHandlers = [];
const prelude = `
  globalThis.localStorage = {getItem:k=>(k in __store?__store[k]:null), setItem:(k,v)=>{__store[k]=String(v)}, removeItem:k=>{delete __store[k]}};
  globalThis.alert = m=>{ __alerts.push(String(m)); }; globalThis.confirm = ()=>__confirmAns; globalThis.prompt = ()=>__promptAns;
  globalThis.Blob = class{ constructor(parts,o){ this.parts=parts; this.type=o&&o.type; } };
  globalThis.URL = {createObjectURL:b=>{ __downloads.push({blob:b}); return 'blob:x'; }, revokeObjectURL(){}};
  const els = {};
  globalThis.document = {
    addEventListener:(t,f)=>{ __addHandler(t,f); },
    getElementById:id=>els[id]||(els[id]={value:'',textContent:'',select(){},setSelectionRange(){},click(){}}),
    createElement:()=>{ const a = {click(){ __downloads[__downloads.length-1].name = a.download; }, remove(){}, style:{}}; return a; },
    body:{appendChild(){}},
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
  const playSeqCapped = playSeq;
  const shuffle = a => a.slice().sort(()=>Math.random()-0.5);
  const clip = (kind,id,text,lang)=>({url:'audio/'+kind+'/'+id+'.mp3',text,lang});
  const enClip=(it,v)=>clip(v===2?'en2':'en',it.id,it.en,'en'), zhClip=it=>clip('zh',it.id,it.zh,'zh');
  const senClip=(it,v)=>clip(v===2?'sen2':'sen',it.id,it.sen,'en'), senZhClip=it=>clip('senzh',it.id,it.senZh,'zh');
  const actClip=it=>clip('act',it.id,(ACTS[it.id]||{}).en,'en');
  const fx = id => { const f = FX.find(x=>x.id===id); return f ? clip('fx',id,f.text,f.lang) : null; };
  const promptClips = it => [it.sen ? senClip(it) : enClip(it)];
  const home = () => { session++; app.innerHTML = '<h1>ABC</h1>' + homeQuestHtml(); };      // js/app.js has the real home()
`;
ctx.__store = store;
ctx.__alerts = []; ctx.__downloads = []; ctx.__confirmAns = true; ctx.__promptAns = null;
ctx.__addHandler = (t, f) => { ({click: clickHandlers, input: inputHandlers, change: changeHandlers, keydown: keyHandlers}[t] || []).push(f); };

vm.runInContext(fs.readFileSync(path.join(root, "js/content/data.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/content/art.js"), "utf8"), ctx);
vm.runInContext(prelude, ctx);
// speak.js provides ipaHtml/recHtml used by the new-word page (its click listener is harmless here)
vm.runInContext("globalThis.window = globalThis; globalThis.navigator = {};", ctx);
ctx.btoa = btoa; ctx.atob = atob;
vm.runInContext(`globalThis.location = {href: "https://alexlee-xz.github.io/abc_game/", hash: "", pathname: "/abc_game/", search: ""};
  globalThis.history = {replaceState(){ location.hash = ""; }};`, ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/audio/speak.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/core/profile.js"), "utf8"), ctx);
["core/srs.js", "pages/quest.js", "pages/story.js", "pages/garden.js", "pages/parent.js"].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, "js", f), "utf8"), ctx));
vm.runInContext(fs.readFileSync(path.join(root, "js/pages/account.js"), "utf8"), ctx);
const ev = code => vm.runInContext(code, ctx);
// values coming out of the vm have another realm's prototypes; JSON round-trip for deep comparisons
const J = x => JSON.parse(JSON.stringify(x));

// random behaviour is switched off by default so the older tests stay deterministic; the new tests turn it on explicitly
ev(`SAY_CHANCE = 0; ALT_VOICE_P = 0;`);
// the parent-page arithmetic gate is switched off here; the gate has its own tests further down
ev(`PARENT_GATE = false;`);

// every audio file referenced must exist
const missing = [];
ev(`LESSONS`).forEach(l => l.items.forEach(it => {
  const files = [`en/${it.id}`, `zh/${it.id}`].concat(it.sen ? [`sen/${it.id}`, `senzh/${it.id}`] : []);
  if(!it.sentence && it.game !== false) files.push(`en2/${it.id}`);
  if(it.sen) files.push(`sen2/${it.id}`);
  files.forEach(f => { if(!fs.existsSync(path.join(root, "audio", f + ".mp3"))) missing.push(f); });
}));
Object.keys(ev(`ACTS`)).forEach(id => { if(!fs.existsSync(path.join(root, "audio", "act", id + ".mp3"))) missing.push("act/" + id); });
ev(`FX`).forEach(f => { if(!fs.existsSync(path.join(root, "audio", "fx", f.id + ".mp3"))) missing.push("fx/" + f.id); });
assert.strictEqual(missing.length, 0, "missing audio: " + missing.join(","));

const tick = () => new Promise(r => setImmediate(r));
async function click(act, i = 0, extra = {}){
  const t = {dataset: Object.assign({act, i: String(i)}, extra), classList: {add(){}, remove(){}}};
  clickHandlers.forEach(h => h({target: {closest: () => t}}));
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
    if(o.stopAt && step.type === o.stopAt) return;          // let the caller inspect this step
    if(step.type === "teach"){ await click("q-next"); continue; }
    if(step.type === "act"){ await click(o.skipAct ? "a-skip" : "a-done"); continue; }
    if(step.type === "say"){ await click(o.sayNo ? "s-no" : "s-ok"); continue; }
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
const curStore = () => store[ev(`curKey()`)];       // raw JSON of the current child's saved record
const W = k => J(ev(`SRS.words[${JSON.stringify(k)}]`));
const logOf = () => J(ev(`SRS.log`));
const today = () => ev(`todayNum()`);
const seed = (k, o) => ev(`SRS.words[${JSON.stringify(k)}] = Object.assign(newWord(todayNum()), ${JSON.stringify(o)});`);
const capNew = () => ev(`SRS.daily = {day: todayNum(), newCount: 99, done: false};`);   // no new words today

(async () => {
  const pool = ev(`questPool()`);
  assert.strictEqual(pool.length, 27, "pool size " + pool.length);
  assert.strictEqual(new Set(pool.map(p => p.en)).size, 27);
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
    assert.strictEqual(ev(`Q.steps.filter(s => s.type === "quiz").length`), 3);
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
    assert.strictEqual(ev(`Q.steps.filter(s => s.type === "quiz").length`), 4, "each miss is re-asked at most once");
    assert.strictEqual(ev(`Q.steps.filter(s => s.retry).length`), 2);
    reset();
    ev(`parentPage()`);
    assert(/今天还没有新学的词/.test(ev(`app.innerHTML`)), "empty tip message");
  }

  /* ---------- less Chinese, second voice, say step, action step, story, learning-mode toggles ---------- */
  {
    const flatPlayed = () => J(ev(`played`)).flat();
    const seedDue = (keys, o) => keys.forEach(k => seed(k, Object.assign({box: 3, due: today(), right: 3, last: today() - 2, lastGood: today() - 2}, o || {})));
    const findLists = u => J(ev(`played`)).filter(l => l.includes(u)).length;

    // --- Chinese: by default only on the new-word page ---
    reset(); capNew(); seedDue(["teacher", "vet", "doctor", "nurse", "hose", "pole"]);
    ev(`played.length = 0`);
    await runQuest();
    assert(flatPlayed().every(u => !/^audio\/zh\//.test(u)), "no Chinese translation after answers by default");
    assert.strictEqual(findLists("audio/fx/fx_find_zh.mp3"), 2, "Chinese prompt only for the first 2 questions");
    reset(); capNew(); ev(`SRS.cfg.zh = "all"`); seedDue(["teacher", "vet", "doctor", "nurse", "hose", "pole"]);
    ev(`played.length = 0`);
    await runQuest();
    assert(flatPlayed().some(u => /^audio\/zh\//.test(u)), "'all' mode plays the translation");
    assert.strictEqual(findLists("audio/fx/fx_find_zh.mp3"), ev(`Q.steps.filter(s => s.type === "quiz").length`), "'all' mode: Chinese prompt on every question");
    reset(); ev(`played.length = 0`);
    await runQuest();
    assert(flatPlayed().some(u => /^audio\/zh\//.test(u)), "new-word page still plays the Chinese");

    // --- second voice: review questions only, new words keep the first voice, repeat uses the same clip ---
    reset(); capNew(); seedDue(["teacher", "vet", "hose"], {box: 2}); ev(`ALT_VOICE_P = 1`);
    ev(`played.length = 0`);
    await runQuest();
    let fp = flatPlayed();
    assert(fp.some(u => /^audio\/en2\//.test(u)), "review questions use the 2nd voice");
    assert(!fp.some(u => /^audio\/en\//.test(u)), "...and only the 2nd voice");
    reset(); ev(`played.length = 0`);
    await runQuest();
    fp = flatPlayed();
    assert(fp.some(u => /^audio\/en\//.test(u)) && !fp.some(u => /^audio\/(en2|sen2)\//.test(u)), "new words keep the 1st voice");
    reset(); capNew(); seedDue(["teacher"], {box: 3});
    await click("quest");
    assert.strictEqual(ev(`Q.voice`), 2);
    ev(`played.length = 0`); await click("q-repeat");
    assert.strictEqual(JSON.stringify(J(ev(`played`))), JSON.stringify([["audio/sen2/teacher.mp3"]]), "repeat keeps the voice (sentence version)");
    ev(`ALT_VOICE_P = 0`);
    ev(`SRS.cfg.enRate = 1.3; SRS.cfg.promptRate = 0.8`);
    assert.strictEqual(ev(`rateFor({url: "audio/en2/hose.mp3"})`), 1.3);
    assert.strictEqual(ev(`rateFor({url: "audio/sen2/teacher.mp3"})`), 1.3);
    assert.strictEqual(ev(`rateFor({url: "audio/act/dancer.mp3"})`), 1.3);
    assert.strictEqual(ev(`rateFor({url: "audio/fx/fx_say_zh.mp3"})`), 0.8);

    // --- say step: only for level >= 4 due words, success = review pass, failure = no penalty + make-up question ---
    ev(`SAY_CHANCE = 1`);
    const sayWord = () => J(ev(`Q.steps`)).find(s => s.type === "say").it.en.toLowerCase();
    const sayGroup = async () => { reset(); capNew(); seedDue(["teacher", "vet"], {box: 4, right: 4}); seedDue(["hose"], {box: 2}); await click("quest"); };
    await sayGroup();
    let sts = J(ev(`Q.steps`));
    assert.strictEqual(sts.filter(s => s.type === "say").length, 1, "exactly one say step");
    assert.strictEqual(sts.filter(s => s.type === "quiz").length, 2);
    assert(["teacher", "vet"].includes(sayWord()), "say step only for level >= 4");
    await drive({stopAt: "say"});
    assert(/\u8bf4\u4e00\u8bf4/.test(ev(`app.innerHTML`)) && /s-ok/.test(ev(`app.innerHTML`)) && /s-no/.test(ev(`app.innerHTML`)), "say screen with parent buttons");
    assert(!/data-act="q-choose"/.test(ev(`app.innerHTML`)), "no choices on the say screen");
    ev(`played.length = 0`); await click("s-ok");
    assert(flatPlayed().includes("audio/fx/fx_good_en.mp3"));
    await drive();
    let sw = sayWord(); w = W(sw);
    assert.strictEqual(w.box, 5); assert.strictEqual(w.due, today() + 8); assert.strictEqual(w.rc, 1); assert.strictEqual(w.fg, 0);
    assert.strictEqual(logOf().filter(e => e.k === sw).length, 1, "say success logged once");
    assert(/3 \/ 3 \u4e2a/.test(ev(`app.innerHTML`)), "say counts as a question and a star: " + ev(`app.innerHTML`).match(/\u4e00\u6b21\u5c31\u7b54\u5bf9[^<]*/));
    // can't be pressed twice / outside the step
    await click("s-ok"); await click("s-no");

    await sayGroup(); sw = sayWord();
    await drive({sayNo: true});
    w = W(sw);
    assert.strictEqual(ev(`Q.steps.filter(s => s.fb).length`), 1, "one make-up question");
    const iSay = J(ev(`Q.steps`)).findIndex(s => s.type === "say"), iFb = J(ev(`Q.steps`)).findIndex(s => s.fb);
    const iAct = J(ev(`Q.steps`)).findIndex(s => s.type === "act");
    assert(iFb > iSay && (iAct < 0 || iFb < iAct), "make-up question after the say step and before the action steps");
    assert.strictEqual(w.fg, 0, "not being able to say it is not forgetting");
    assert.strictEqual(w.box, 5, "make-up question answered right => normal review pass");
    assert.strictEqual(logOf().filter(e => e.k === sw).length, 1, "only the make-up question is logged");
    assert(/2 \/ 3 \u4e2a/.test(ev(`app.innerHTML`)), "make-up question is not counted twice");
    await sayGroup(); sw = sayWord();
    await drive({sayNo: true, wrongFor: new Set([sw])});
    w = W(sw);
    assert.strictEqual(w.box, 2); assert.strictEqual(w.due, today() + 1); assert.strictEqual(w.fg, 1, "missing the make-up question is a normal miss");
    // not offered: low level, new words, switched off
    reset(); capNew(); seedDue(["teacher", "vet"], {box: 3});
    await click("quest");
    assert.strictEqual(ev(`Q.steps.filter(s => s.type === "say").length`), 0, "no say step below level 4");
    reset(); await click("quest");
    assert.strictEqual(ev(`Q.steps.filter(s => s.type === "say").length`), 0, "no say step for new words");
    await sayGroup(); ev(`SRS.cfg.say = false`); await click("quest");
    assert.strictEqual(ev(`Q.steps.filter(s => s.type === "say").length`), 0, "say switched off");
    ev(`SAY_CHANCE = 0`);

    // --- action step: at the end, from today's words, no scoring ---
    reset();
    await runQuest();
    sts = J(ev(`Q.steps`));
    const acts = sts.filter(s => s.type === "act"), newWords = sts.filter(s => s.type === "teach").map(s => s.it.en);
    assert.strictEqual(acts.length, 2, "two action steps");
    assert(acts.every(a => newWords.includes(a.it.en)), "action words come from today's new words");
    assert(sts.slice(-2).every(s => s.type === "act"), "action steps are last");
    assert.strictEqual(logOf().length, 6, "action steps are not logged");
    assert(flatPlayed().includes("audio/act/fire_station.mp3") && flatPlayed().includes("audio/fx/fx_act_zh.mp3"));
    reset(); capNew(); seedDue(["teacher", "vet", "doctor"]);
    await click("quest");
    await drive({stopAt: "act"});
    assert(/\u52a8\u4e00\u52a8/.test(ev(`app.innerHTML`)) && /Show me a/.test(ev(`app.innerHTML`)) && /a-done/.test(ev(`app.innerHTML`)));
    const actId = ev(`Q.cur.id`);
    ev(`played.length = 0`); await click("a-say");
    assert.strictEqual(JSON.stringify(J(ev(`played`))), JSON.stringify([[`audio/act/${actId}.mp3`]]), "replay the command");
    const snapAct = JSON.stringify(ev(`SRS.words`));
    await click("a-skip");
    assert.strictEqual(JSON.stringify(ev(`SRS.words`)), snapAct, "action step does not touch the schedule");
    assert.strictEqual(ev(`Q.step.type`), "act", "second action step follows");
    await click("a-done");
    assert(/\u4efb\u52a1\u5b8c\u6210/.test(ev(`app.innerHTML`)));
    reset(); capNew(); seedDue(["teacher", "vet", "doctor"]); ev(`SRS.cfg.act = false`);
    await runQuest();
    assert.strictEqual(ev(`Q.steps.filter(s => s.type === "act").length`), 0, "action step switched off");
    // every word has a command
    pool.forEach(p => assert(ev(`ACTS[${JSON.stringify(p.id)}]`), "ACTS entry for " + p.en));

    // --- story: locked until the unit's words are learned ---
    reset(); ev(`S = null`);
    let hh = ev(`homeQuestHtml()`);
    assert(/\ud83d\udd12/.test(hh) && /0\/7/.test(hh) && !/data-act="story"/.test(hh), "story locked at first");
    await click("story", 0);
    assert.strictEqual(ev(`S`), null, "locked story does not start");
    ["fire station", "alarm bell", "firefighter", "hose", "save", "cheer"].forEach(k => seed(k, {box: 1}));
    assert(/6\/7/.test(ev(`homeQuestHtml()`)));
    seed("pole", {box: 0});
    assert(/6\/7/.test(ev(`homeQuestHtml()`)), "level 0 does not count");
    seed("pole", {box: 1});
    hh = ev(`homeQuestHtml()`);
    assert(/data-act="story" data-i="0"/.test(hh) && !/\ud83d\udd12/.test(hh), "story unlocked");
    ev(`played.length = 0`);
    await click("story", 0);
    let st0 = J(ev(`S`));
    assert.strictEqual(st0.lines.length, 3); assert(st0.order.some((v, i) => v !== i), "start order is shuffled");
    assert.strictEqual(JSON.stringify(st0.order.slice().sort()), "[0,1,2]");
    const storyUrls = flatPlayed().filter(u => /^audio\/en\/s_/.test(u));
    assert.strictEqual(storyUrls.join(), "audio/en/s_alarm.mp3,audio/en/s_reach.mp3,audio/en/s_out.mp3", "story is played in order");
    assert.strictEqual((ev(`app.innerHTML`).match(/data-act="st-pick"/g) || []).length, 3);
    ev(`played.length = 0`); await click("st-pick", 2);                       // wrong: not the first
    assert.strictEqual(ev(`S.miss`), 1); assert.strictEqual(ev(`S.next`), 0);
    assert(flatPlayed().includes("audio/fx/fx_try_en.mp3") && flatPlayed().filter(u => /^audio\/en\/s_/.test(u)).length === 3, "wrong: try again and replay the whole story");
    await click("st-pick", 0); await click("st-pick", 0);                      // second tap on a finished card does nothing
    assert.strictEqual(ev(`S.next`), 1); assert.strictEqual(ev(`S.miss`), 1);
    await click("st-pick", 1);
    assert.strictEqual(ev(`S.next`), 2); assert(!/\u6545\u4e8b\u8bb2\u5b8c\u5566/.test(ev(`app.innerHTML`)));
    await click("st-pick", 2);
    assert(/\u6545\u4e8b\u8bb2\u5b8c\u5566/.test(ev(`app.innerHTML`)), "story finished");
    assert.strictEqual(ev(`SRS.story.fire`), 1);
    assert.strictEqual((ev(`app.innerHTML`).match(/\u2b50/g) || []).length, 2, "1 miss => 2 stars");
    assert(/\u70b9\u9519 1 \u6b21/.test(ev(`app.innerHTML`)));
    await click("st-pick", 0);                                                // locked after finishing
    assert.strictEqual(ev(`SRS.story.fire`), 1);
    await click("st-again");
    st0 = J(ev(`S`)); assert.strictEqual(st0.miss, 0);
    await click("st-pick", 0); await click("st-pick", 1); await click("st-pick", 2);
    assert.strictEqual(ev(`SRS.story.fire`), 2);
    assert.strictEqual((ev(`app.innerHTML`).match(/\u2b50/g) || []).length, 3, "no miss => 3 stars");
    assert(/\u4e00\u6b21\u5c31\u6392\u5bf9/.test(ev(`app.innerHTML`)));
    assert(/\u5df2\u5b8c\u6210 2 \u6b21/.test(ev(`homeQuestHtml()`)));
    ev(`parentPage()`);
    assert(/\u542c\u6545\u4e8b\u6392\u987a\u5e8f/.test(ev(`app.innerHTML`)) && /\u5b8c\u6210 2 \u6b21/.test(ev(`app.innerHTML`)), "parent page shows story count");
    assert.strictEqual(JSON.parse(ev(`backupText()`)).story.fire, 2, "story count is in the backup");
    ev(`SRS = normSRS({words: {}, story: {fire: 3, x: -2, y: "a", z: 1.7}})`);
    assert.strictEqual(JSON.stringify(ev(`SRS.story`)), JSON.stringify({fire: 3, z: 1}), "story counts are sanitised");
    ev(`SRS = normSRS({words: {}, story: "junk"})`); assert.strictEqual(JSON.stringify(ev(`SRS.story`)), "{}");
    // story data sanity
    ev(`STORIES`).forEach(s => s.lines.forEach(id => assert(ev(`itemById(${JSON.stringify(id)})`), "story line " + id)));

    // --- learning-mode toggles on the parent page ---
    reset(); ev(`parentPage("set")`);
    let tp = ev(`app.innerHTML`);
    assert(/\u5b66\u4e60\u65b9\u5f0f/.test(tp) && /data-k="zh" data-v="all"/.test(tp) && /data-k="say" data-v="0"/.test(tp) && /data-k="act" data-v="0"/.test(tp));
    assert(/small-btn on" data-act="p-set" data-k="zh" data-v="new"/.test(tp), "defaults: Chinese only on new words");
    assert(/small-btn on" data-act="p-set" data-k="say" data-v="1"/.test(tp) && /small-btn on" data-act="p-set" data-k="act" data-v="1"/.test(tp), "defaults: say and act on");
    await click("p-set", 0, {k: "zh", v: "all"});
    assert.strictEqual(ev(`SRS.cfg.zh`), "all"); assert.strictEqual(ev(`zhAll()`), true);
    assert(/small-btn on" data-act="p-set" data-k="zh" data-v="all"/.test(ev(`app.innerHTML`)), "page re-rendered with the new state");
    await click("p-set", 0, {k: "say", v: "0"}); await click("p-set", 0, {k: "act", v: "0"});
    assert.strictEqual(ev(`SRS.cfg.say`), false); assert.strictEqual(ev(`SRS.cfg.act`), false);
    await click("p-set", 0, {k: "bogus", v: "1"}); await click("p-set", 0, {k: "zh", v: "weird"});
    assert.strictEqual(ev(`SRS.cfg.zh`), "new", "unknown values fall back to the default");
    assert.strictEqual(JSON.parse(curStore()).cfg.say, false, "saved");
    await click("p-set", 0, {k: "zh", v: "all"});
    await click("p-reset");
    assert.strictEqual(ev(`SRS.cfg.zh`), "all"); assert.strictEqual(ev(`SRS.cfg.say`), false, "reset keeps the toggles");
    ev(`SRS = normSRS(${JSON.stringify(JSON.parse(ev(`backupText()`)))})`);
    assert.strictEqual(ev(`SRS.cfg.act`), false, "toggles survive backup / import");
    ev(`SRS = normSRS({words: {}, cfg: {zh: "banana", say: false, act: false}})`);
    assert.strictEqual(ev(`SRS.cfg.zh`), "new"); assert.strictEqual(ev(`SRS.cfg.say`), false); assert.strictEqual(ev(`SRS.cfg.act`), false);
    ev(`SRS = normSRS({words: {}, cfg: {newPerDay: 3}})`);          // old save without the new keys
    assert.strictEqual(ev(`SRS.cfg.zh`), "new"); assert.strictEqual(ev(`SRS.cfg.say`), true); assert.strictEqual(ev(`SRS.cfg.act`), true);
    reset();
  }

  /* ---------- forgetting curve: buckets, aggregation, chart ---------- */
  [[1, 0], [2, 1], [3, 2], [4, 2], [5, 3], [7, 3], [8, 4], [14, 4], [15, 5], [29, 5], [30, 6], [400, 6], [0, -1]].forEach(([g, b]) =>
    assert.strictEqual(ev(`gapBucket(${g})`), b, "gap " + g));
  reset();
  assert(/还没有数据/.test((ev(`parentPage("view")`), ev(`app.innerHTML`))), "empty curve message");
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
  ev(`parentPage("view")`);
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
      assert.strictEqual(teach, Math.min(n, 27 - (taught - teach)), `n=${n} day ${day}: new words taught`);
      assert(qs >= Math.min(10, 2 * teach + learned), `n=${n} day ${day}: only ${qs} questions`);
      assert(ev(`SRS.daily`).newCount <= n, "new words over cap");
    }
    assert.strictEqual(taught, Math.min(27, n * 8), `n=${n}: total taught`);
  }
  // after today's new words are used up, "another round" only reviews (no extra new words)
  reset(); ev(`SRS.cfg.newPerDay = 2`);
  await runQuest(); await runQuest();
  assert.strictEqual(Object.keys(ev(`SRS.words`)).length, 2, "second round same day adds no new words");
  reset();
  assert.strictEqual(ev(`newPerDay()`), 3);
  // sliders: out-of-range values are clamped, labels update, settings persist
  const slider = (k, v) => inputHandlers.forEach(h => h({target: {dataset: {set: k}, value: String(v)}}));
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
  assert.strictEqual(JSON.parse(curStore()).cfg.newPerDay, 7, "saved");
  // rate chosen per clip type
  slider("promptRate", 8); slider("enRate", 7);
  assert.strictEqual(ev(`rateFor(enClip(LESSONS[0].items[0]))`), 0.7);
  assert.strictEqual(ev(`rateFor(zhClip(LESSONS[0].items[0]))`), 0.8);
  assert.strictEqual(ev(`rateFor(fx("fx_good_en"))`), 0.8);
  assert.strictEqual(ev(`rateFor({url: "blob:xyz"})`), 1);
  // parent page shows the settings and the preview buttons play something
  await click("parent", 0, {t: "set"});
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
  reset();

  // recording length (word / sentence settings): defaults, sliders keep min <= max, clamping, persistence, old saves, parent page
  assert.deepStrictEqual(J(ev(`SRS.cfg.recWord`)), [3, 6]); assert.deepStrictEqual(J(ev(`SRS.cfg.recSen`)), [4, 10]);
  assert.deepStrictEqual(J(ev(`recRange(false)`)), {min: 3000, max: 6000}); assert.deepStrictEqual(J(ev(`recRange(true)`)), {min: 4000, max: 10000});
  slider("recWordMax", 9);  assert.deepStrictEqual(J(ev(`SRS.cfg.recWord`)), [3, 9]);
  slider("recWordMin", 5);  assert.deepStrictEqual(J(ev(`SRS.cfg.recWord`)), [5, 9]);
  slider("recWordMin", 10); assert.deepStrictEqual(J(ev(`SRS.cfg.recWord`)), [10, 10], "raising the minimum above the maximum pushes the maximum up");
  slider("recWordMax", 4);  assert.deepStrictEqual(J(ev(`SRS.cfg.recWord`)), [4, 4], "lowering the maximum below the minimum pulls the minimum down");
  slider("recWordMax", 99); assert.deepStrictEqual(J(ev(`SRS.cfg.recWord`)), [4, 10], "word limit is 10 s");
  slider("recWordMin", 0);  assert.deepStrictEqual(J(ev(`SRS.cfg.recWord`)), [1, 10], "word minimum is at least 1 s");
  slider("recSenMax", 99);  assert.deepStrictEqual(J(ev(`SRS.cfg.recSen`)), [4, 20], "sentence limit is 20 s");
  slider("recSenMin", 1);   assert.deepStrictEqual(J(ev(`SRS.cfg.recSen`)), [2, 20], "sentence minimum is at least 2 s");
  slider("recSenMin", "x"); assert.deepStrictEqual(J(ev(`SRS.cfg.recSen`)), [2, 20], "garbage is ignored");
  slider("recSenMin", 6);   slider("recSenMax", 12);
  assert.deepStrictEqual(J(ev(`SRS.cfg.recWord`)), [1, 10], "word and sentence settings are independent");
  assert.deepStrictEqual(J(ev(`recRange(true)`)), {min: 6000, max: 12000});
  assert.deepStrictEqual(J(JSON.parse(curStore()).cfg.recSen), [6, 12], "saved");
  assert.strictEqual(ev(`document.getElementById("v-recSenMin").textContent`), 6, "labels update");
  await click("parent", 0, {t: "set"});
  const rh = ev(`app.innerHTML`);
  assert(/跟读录音时长/.test(rh) && /value="6" data-set="recSenMin"/.test(rh) && /value="12" data-set="recSenMax"/.test(rh) && /value="1" data-set="recWordMin"/.test(rh) && /value="10" data-set="recWordMax"/.test(rh), "parent page shows the four sliders");
  assert(/min="2" max="20" step="1" value="6" data-set="recSenMin"/.test(rh) && /min="1" max="10" step="1" value="1" data-set="recWordMin"/.test(rh), "slider ranges");
  await click("p-reset"); assert.deepStrictEqual(J(ev(`SRS.cfg.recSen`)), [6, 12], "reset keeps the recording settings");
  ev(`SRS = normSRS({words: {}, cfg: {newPerDay: 3}})`); assert.deepStrictEqual(J(ev(`SRS.cfg.recWord`)), [3, 6], "old saves get the defaults");
  ev(`SRS = normSRS({words: {}, cfg: {recWord: [50, 2], recSen: "x"}})`);
  assert.deepStrictEqual(J(ev(`SRS.cfg.recWord`)), [10, 10]); assert.deepStrictEqual(J(ev(`SRS.cfg.recSen`)), [4, 10], "bad values in an imported file are cleaned");
  reset();

  /* ---------- parent page: tabs, to-do box, presets, arithmetic gate ---------- */
  {
    reset();
    ev(`parentPage("view")`); let h = ev(`app.innerHTML`);
    assert.strictEqual((h.match(/data-act="p-tab"/g) || []).length, 3, "three tabs");
    assert(/class="on" data-act="p-tab" data-t="view"/.test(h), "overview tab is highlighted");
    assert(/需要你做的事/.test(h) && /今天的魔法任务还没做/.test(h), "to-do box: today's quest not done");
    assert(!/data-set=/.test(h) && !/data-act="p-set"/.test(h) && !/id="presets"/.test(h), "no settings on the overview");
    assert(!/prof-delete/.test(h) && !/id="bk"/.test(h), "no account stuff on the overview");
    // the heavy analysis is folded away (collapsed unless opened), review rules live inside it
    assert(/data-keep="deep"(?! open)/.test(h), "analysis is collapsed");
    const di = h.indexOf("详细分析");
    ["未来 7 天要复习", "遗忘情况", "遗忘曲线", "最容易忘的词", "还没学会的词", "复习规则"].forEach(s => assert(h.indexOf(s) > di, s + " is inside 详细分析"));
    ["每周小结", "今天", "学习进度", "最近 30 天打卡"].forEach(s => assert(h.indexOf(s) >= 0 && h.indexOf(s) < di, s + " stays on top"));
    // everything fine -> friendly message
    ev(`SRS.daily.done = true`); ev(`parentPage("view")`);
    assert(/暂时没有，继续保持/.test(ev(`app.innerHTML`)) && /class="sec todo ok"/.test(ev(`app.innerHTML`)), "nothing to do");
    // a word that keeps being answered wrong
    seed("hose", {box: 0, due: today(), wrong: 3, seen: 3}); ev(`parentPage("view")`);
    assert(/总是答错/.test(ev(`app.innerHTML`)) && /hose/.test(ev(`app.innerHTML`)), "hint for a word that keeps failing");
    reset();
    // tab buttons
    await click("p-tab", 0, {t: "set"}); h = ev(`app.innerHTML`);
    assert(/class="on" data-act="p-tab" data-t="set"/.test(h) && /data-k="zh"/.test(h) && /id="presets"/.test(h) && /data-set="recWordMin"/.test(h), "settings tab");
    assert(!/需要你做的事/.test(h) && !/id="bk"/.test(h));
    assert(/data-keep="adv"(?! open)/.test(h) && h.indexOf("高级设置") > h.indexOf("学习节奏"), "advanced settings are folded under the presets");
    await click("p-tab", 0, {t: "acct"}); h = ev(`app.innerHTML`);
    assert(/小朋友账户/.test(h) && /id="bk"/.test(h) && !/data-set=/.test(h), "account tab");
    await click("p-tab", 0, {t: "bogus"}); assert(/小朋友账户/.test(ev(`app.innerHTML`)), "unknown tab keeps the current one");
    // settings and re-renders keep the tab
    await click("p-tab", 0, {t: "set"}); await click("p-set", 0, {k: "zh", v: "all"});
    assert(/data-t="set"/.test(ev(`app.innerHTML`)) && /id="presets"/.test(ev(`app.innerHTML`)), "p-set stays on the settings tab");
    // entering from home always starts on the overview; the back button leaves
    await click("parent"); assert(/data-act="p-tab" data-t="view"/.test(ev(`app.innerHTML`)) && /需要你做的事/.test(ev(`app.innerHTML`)), "opens on the overview");
    await click("p-back"); assert(/ABC/.test(ev(`app.innerHTML`)), "back goes home");

    // presets
    reset(); ev(`parentPage("set")`); h = ev(`app.innerHTML`);
    assert(/当前：<b>标准<\/b>/.test(h) && /small-btn on" data-act="p-preset" data-v="std"/.test(h), "defaults = standard");
    slider("promptRate", 13);
    await click("p-preset", 0, {v: "easy"});
    assert.deepStrictEqual([ev(`SRS.cfg.newPerDay`), ev(`SRS.cfg.zh`), ev(`SRS.cfg.say`), ev(`SRS.cfg.act`)], [2, "all", false, true], "easy preset");
    assert.strictEqual(ev(`SRS.cfg.promptRate`), 1.3, "presets leave the speed alone");
    assert(/当前：<b>轻松<\/b>/.test(ev(`app.innerHTML`)) && /small-btn on" data-act="p-preset" data-v="easy"/.test(ev(`app.innerHTML`)), "page shows the new preset");
    assert(/value="2" data-set="newPerDay"/.test(ev(`app.innerHTML`)) && /small-btn on" data-act="p-set" data-k="zh" data-v="all"/.test(ev(`app.innerHTML`)), "advanced controls follow the preset");
    await click("p-preset", 0, {v: "hard"});
    assert.deepStrictEqual([ev(`SRS.cfg.newPerDay`), ev(`SRS.cfg.zh`), ev(`SRS.cfg.say`), ev(`SRS.cfg.act`)], [6, "new", true, true], "challenge preset");
    await click("p-preset", 0, {v: "bogus"}); assert.strictEqual(ev(`SRS.cfg.newPerDay`), 6, "unknown preset ignored");
    await click("p-preset", 0, {v: "std"});
    assert.deepStrictEqual([ev(`SRS.cfg.newPerDay`), ev(`SRS.cfg.zh`), ev(`SRS.cfg.say`), ev(`SRS.cfg.act`)], [3, "new", true, true], "standard preset");
    assert.strictEqual(JSON.parse(curStore()).cfg.newPerDay, 3, "saved");
    // moving a slider off a preset switches the label to custom, live
    slider("newPerDay", 4);
    assert(/当前：<b>自定义<\/b>/.test(ev(`document.getElementById("presets").innerHTML`)) && !/small-btn on" data-act="p-preset"/.test(ev(`document.getElementById("presets").innerHTML`)), "custom");
    slider("newPerDay", 6); await click("p-set", 0, {k: "say", v: "0"});
    assert(/当前：<b>自定义<\/b>/.test(ev(`app.innerHTML`)), "toggling an option also leaves the preset");
    reset();

    // folded sections remember being opened across re-renders
    ev(`parentOpen.adv = true`); ev(`parentPage("set")`); assert(/data-keep="adv" open/.test(ev(`app.innerHTML`)), "open state is kept");
    ev(`parentOpen.adv = false`); ev(`parentPage("set")`); assert(!/data-keep="adv" open/.test(ev(`app.innerHTML`)));
    ev(`delete parentOpen.adv`);

    // arithmetic gate
    ev(`PARENT_GATE = true; parentUntil = 0;`);
    for(let n = 0; n < 60; n++){ ev(`gatePage()`); const q = J(ev(`parentGateQ`)); assert(q.a >= 12 && q.a <= 19 && q.b >= 3 && q.b <= 9, "gate question range"); }
    const setAns = v => ev(`document.getElementById("gate").value = ${JSON.stringify(String(v))}`);
    await click("parent"); h = ev(`app.innerHTML`);
    assert(/家长验证/.test(h) && /id="gate"/.test(h) && /data-act="p-gate"/.test(h) && !/data-act="p-tab"/.test(h), "gate page, not the parent page");
    let q = J(ev(`parentGateQ`));
    assert(new RegExp(`${q.a} \\+ ${q.b} = \\?`).test(h), "question is shown");
    setAns(q.a + q.b + 1); await click("p-gate");
    assert(/不对哦/.test(ev(`app.innerHTML`)) && /id="gate"/.test(ev(`app.innerHTML`)) && !/data-act="p-tab"/.test(ev(`app.innerHTML`)), "wrong answer: still locked");
    setAns(""); await click("p-gate"); assert(/id="gate"/.test(ev(`app.innerHTML`)), "empty answer");
    setAns("abc"); await click("p-gate"); assert(/id="gate"/.test(ev(`app.innerHTML`)), "garbage answer");
    q = J(ev(`parentGateQ`)); setAns(` ${q.a + q.b} `); await click("p-gate");
    assert(/data-act="p-tab"/.test(ev(`app.innerHTML`)) && /家长页/.test(ev(`app.innerHTML`)), "right answer opens the parent page");
    // unlocked for a while: opening again does not ask; leaving with the back button locks again
    await click("p-tab", 0, {t: "set"}); await click("p-set", 0, {k: "say", v: "1"});
    assert(/data-act="p-tab"/.test(ev(`app.innerHTML`)), "in-page actions never ask again");
    await click("p-back");
    await click("parent"); assert(/id="gate"/.test(ev(`app.innerHTML`)), "back button locks");
    // Enter key submits; the requested tab is honoured after the gate
    q = J(ev(`parentGateQ`)); setAns(q.a + q.b);
    keyHandlers.forEach(k => k({key: "Enter", target: {id: "gate"}}));
    assert(/data-act="p-tab"/.test(ev(`app.innerHTML`)), "Enter submits");
    keyHandlers.forEach(k => k({key: "a", target: {id: "nm"}}));
    // idle for more than 5 minutes: ask again; activity keeps it open
    ev(`home()`); ev(`__advanceMs(4 * 60000)`); await click("parent"); assert(/data-act="p-tab"/.test(ev(`app.innerHTML`)), "still unlocked after 4 minutes");
    ev(`home()`); ev(`__advanceMs(6 * 60000)`); await click("parent", 0, {t: "set"}); assert(/id="gate"/.test(ev(`app.innerHTML`)), "asks again after 6 idle minutes");
    q = J(ev(`parentGateQ`)); setAns(q.a + q.b); await click("p-gate");
    assert(/data-act="p-tab"/.test(ev(`app.innerHTML`)), "unlocked again");
    // the gate page has a way out
    ev(`parentUntil = 0`); await click("parent"); assert(/data-act="home"/.test(ev(`app.innerHTML`)), "gate page has a back button");
    ev(`PARENT_GATE = false; parentUntil = 0;`);
    reset();
  }

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
    ev(`homeQuestHtml()`); ev(`garden()`); ev(`parentPage("view")`); ev(`parentPage("set")`); ev(`parentPage("acct")`);
  }
  assert.strictEqual(JSON.stringify(reviewDays.slice(0, 6)), JSON.stringify([1, 2, 4, 7, 15, 30]), "schedule: " + reviewDays);
  assert.strictEqual(ev(`SRS.words["${first}"].box`), 5);
  assert.strictEqual(ev(`SRS.streak`), 46);
  assert.strictEqual(Object.keys(ev(`SRS.words`)).length, 27, "all words introduced");
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
  ev(`parentPage("view")`);
  let html = ev(`app.innerHTML`);
  assert(/遗忘情况/.test(html) && /最容易忘的词/.test(html) && /还没学会的词/.test(html));
  ev(`parentPage("set")`);
  assert(/每天新词数/.test(ev(`app.innerHTML`)) && /语速/.test(ev(`app.innerHTML`)), "settings tab has new-word count and speed");
  ev(`parentPage("view")`);
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

  /* ---------- illustrations: every picture is a safe, self-contained inline SVG ---------- */
  {
    const items = ev(`LESSONS`).flatMap(l => l.items), used = new Set();
    items.forEach(it => {
      const svg = ev(`artFor(${JSON.stringify(it.id)})`);
      assert(svg, "no illustration for " + it.id);
      assert(it.emoji === svg, "item " + it.id + " uses the illustration");
      assert.strictEqual((svg.match(/<svg[\s>]/g) || []).length, 1, it.id + ": one svg");
      assert.strictEqual((svg.match(/<\/svg>/g) || []).length, 1, it.id + ": closed");
      assert(!/<script|\son\w+\s*=|javascript:|<image|href=|<foreignObject/i.test(svg), it.id + ": no scripts / external refs");
      assert(/viewBox="0 0 100 100"/.test(svg) && !/\swidth=|\sheight=/.test(svg.match(/<svg[^>]*>/)[0].replace(/stroke-width=/g, "")), it.id + ": sized by CSS");
      used.add(ev(`ART_ALIAS[${JSON.stringify(it.id)}] || ${JSON.stringify(it.id)}`));
    });
    Object.keys(ev(`ART`)).forEach(k => assert(used.has(k), "unused illustration " + k));
    // shapes inside one picture are balanced: every opened tag is self-closed or closed
    Object.entries(J(ev(`ART`))).forEach(([k, svg]) => {
      const opens = (svg.match(/<(?!\/)(?!\?)[a-z]+/gi) || []).length, selfClose = (svg.match(/\/>/g) || []).length, closes = (svg.match(/<\/[a-z]+>/gi) || []).length;
      assert.strictEqual(opens, selfClose + closes, k + ": balanced tags");
    });
  }

  /* ---------- child accounts: first run, names, isolation, migration ---------- */
  const wipe = () => { Object.keys(store).forEach(k => delete store[k]); ev(`PROFS = readProfiles(); SRS = freshSRS(); Q = null; S = null;`); };
  const profs = () => J(ev(`PROFS`));
  const nameIn = v => ev(`document.getElementById("nm").value = ${JSON.stringify(v)}`);
  const alerts = ctx.__alerts;
  {
    // upgrade from the old single-save version: legacy progress waits until the first name is typed
    wipe();
    const legacy = JSON.stringify({words: {hose: {box: 3, due: today() + 2, seen: 4, right: 5, wrong: 1, last: today() - 1, lastGood: today() - 1}},
      daily: {day: 0, newCount: 0, done: false}, doneDays: [today() - 1], streak: 1, lastDone: today() - 1});
    store.abc_srs_v1 = legacy;
    ev(`boot()`);
    let h = ev(`app.innerHTML`);
    assert(/id="nm"/.test(h) && /maxlength="12"/.test(h) && /prof-create/.test(h), "welcome page asks for a name");
    assert(/已有的学习记录/.test(h), "welcome page mentions the existing record");
    assert(/p-pick/.test(h) && /type="file" id="imp"/.test(h), "first-run page can import a record file (new phone)");
    assert.strictEqual(store.abc_srs_v1, legacy, "nothing touched yet");
    assert.strictEqual(profs().list.length, 0);
    // empty / blank name is refused
    nameIn("   "); await click("prof-create");
    assert.strictEqual(profs().list.length, 0); assert(/请先输入名字/.test(ev(`document.getElementById("nmerr").textContent`)));
    // names with markup are kept as text and always escaped on screen
    nameIn("  <b>Lily</b>  "); await click("prof-create");
    let P = profs();
    assert.strictEqual(P.list.length, 1); assert.strictEqual(P.list[0].name, "<b>Lily</b>"); assert.strictEqual(P.cur, P.list[0].id);
    h = ev(`app.innerHTML`);
    assert(/&lt;b&gt;Lily&lt;\/b&gt; ▾/.test(h) && !/<b>Lily/.test(h), "home shows the escaped name chip");
    assert(/prof-chooser/.test(h), "name chip opens the chooser");
    assert(!("abc_srs_v1" in store), "legacy key moved");
    assert.strictEqual(store["abc_srs_v1__" + P.cur], legacy, "legacy record copied verbatim");
    assert.strictEqual(ev(`SRS.words.hose.box`), 3, "legacy progress is the first child's progress");
    const lilyId = P.cur;
    ev(`renameProfile(${JSON.stringify(lilyId)}, "Lily")`);

    // a second child starts empty, the first child's record is untouched
    await click("prof-chooser");
    h = ev(`app.innerHTML`); assert(/谁在玩/.test(h) && /prof-add/.test(h) && /prof-pick/.test(h));
    await click("prof-add");
    h = ev(`app.innerHTML`); assert(/新增小朋友/.test(h) && /prof-chooser/.test(h) && /p-pick/.test(h), "add-child page has a back button and import");
    nameIn("lily"); await click("prof-create");
    assert(/已经有这个名字/.test(ev(`document.getElementById("nmerr").textContent`)), "duplicate (case-insensitive) refused");
    assert.strictEqual(profs().list.length, 1);
    nameIn("Tom"); await click("prof-create");
    P = profs(); assert.strictEqual(P.list.length, 2); const tomId = P.cur; assert.notStrictEqual(tomId, lilyId);
    assert.strictEqual(Object.keys(ev(`SRS.words`)).length, 0, "Tom starts fresh (legacy is only adopted by the first name)");
    ev(`SRS.cfg.newPerDay = 9`); ev(`saveSRS()`);
    await runQuest();
    assert(Object.keys(ev(`SRS.words`)).length >= 1);
    await click("prof-pick", 0, {id: lilyId});
    assert.strictEqual(profs().cur, lilyId); assert.strictEqual(ev(`SRS.words.hose.box`), 3); assert.strictEqual(Object.keys(ev(`SRS.words`)).length, 1, "Lily's record untouched by Tom's quest");
    assert.strictEqual(ev(`SRS.cfg.newPerDay`), 3, "settings are per child");
    await click("prof-pick", 0, {id: tomId});
    assert.strictEqual(ev(`SRS.cfg.newPerDay`), 9); assert(Object.keys(ev(`SRS.words`)).length >= 3, "Tom's own record is back");
    assert.strictEqual(JSON.parse(store["abc_srs_v1__" + tomId]).cfg.newPerDay, 9, "auto-saved under Tom's key");
    // unknown id: nothing changes
    await click("prof-pick", 0, {id: "nope"}); assert.strictEqual(profs().cur, tomId);

    // rename / delete
    assert.strictEqual(ev(`renameProfile(${JSON.stringify(tomId)}, "LILY")`).err, "已经有这个名字啦");
    assert.strictEqual(ev(`renameProfile(${JSON.stringify(tomId)}, "  ")`).err, "名字不能是空的");
    ctx.__promptAns = "Tommy"; await click("prof-rename", 0, {id: tomId}); assert.strictEqual(ev(`curProfile().name`), "Tommy");
    ctx.__promptAns = null; await click("prof-rename", 0, {id: tomId}); assert.strictEqual(ev(`curProfile().name`), "Tommy", "cancel keeps the name");
    ctx.__confirmAns = false; await click("prof-delete", 0, {id: tomId}); assert.strictEqual(profs().list.length, 2, "cancel keeps the child");
    ctx.__confirmAns = true;  await click("prof-delete", 0, {id: tomId});
    P = profs(); assert.strictEqual(P.list.length, 1); assert.strictEqual(P.cur, lilyId, "falls back to the remaining child");
    assert(!(("abc_srs_v1__" + tomId) in store), "deleted child's record removed");
    assert.strictEqual(ev(`SRS.words.hose.box`), 3);
    await click("prof-delete", 0, {id: lilyId});
    assert.strictEqual(profs().list.length, 0); assert(/id="nm"/.test(ev(`app.innerHTML`)), "no children left -> welcome page");
    assert.strictEqual(Object.keys(store).filter(k => k.startsWith("abc_srs_v1__")).length, 0);

    // limit of 6 children
    wipe();
    for(let n = 1; n <= 6; n++) assert(ev(`createProfile("K${n}")`).ok, "child " + n);
    assert(/最多 6 个/.test(ev(`createProfile("K7")`).err));
    ev(`parentPage("acct")`); assert(!/data-act="prof-add"/.test(ev(`app.innerHTML`)), "no add button at the limit");
    ev(`chooserPage()`); assert(!/prof-add/.test(ev(`app.innerHTML`)));

    // damaged profile list / dangling current id / legacy junk
    wipe(); store.abc_profiles_v1 = "{oops"; ev(`PROFS = readProfiles()`); assert.strictEqual(profs().list.length, 0);
    store.abc_profiles_v1 = JSON.stringify({v: 1, cur: "gone", list: [{id: "a1", name: "A"}, {id: "a1", name: "dup id"}, {id: "bad id!", name: "B"}, {id: "c3", name: ""}, null]});
    ev(`PROFS = readProfiles()`); P = profs(); assert.strictEqual(P.list.length, 1); assert.strictEqual(P.cur, "a1");
    wipe(); store.abc_srs_v1 = "not json"; ev(`boot()`); assert(!/已有的学习记录/.test(ev(`app.innerHTML`)), "junk legacy ignored");
    assert.strictEqual(ev(`createProfile("A").adopted`), false); assert.strictEqual(store.abc_srs_v1, "not json", "junk legacy is left alone");

    // safety net: saving with no child creates one so nothing is lost
    wipe(); ev(`SRS.streak = 4; saveSRS()`);
    P = profs(); assert.strictEqual(P.list.length, 1); assert.strictEqual(P.list[0].name, "小朋友");
    assert.strictEqual(JSON.parse(store["abc_srs_v1__" + P.cur]).streak, 4);
    // reload from storage (like reopening the page)
    ev(`PROFS = readProfiles(); SRS = loadSRS();`); assert.strictEqual(ev(`SRS.streak`), 4);

    // Enter key on the name box creates the child
    wipe(); ev(`welcomePage()`); nameIn("Amy");
    keyHandlers.forEach(h => h({key: "Enter", target: {id: "nm"}}));
    assert.strictEqual(profs().list.length, 1); assert.strictEqual(ev(`curProfile().name`), "Amy");
    keyHandlers.forEach(h => h({key: "a", target: {id: "nm"}})); assert.strictEqual(profs().list.length, 1);
    nameIn("x".repeat(40)); ev(`createFromInput()`);
    assert.strictEqual(profs().list.length, 2); assert.strictEqual(ev(`curProfile().name`).length, 12, "name is cut to 12 characters");
  }

  /* ---------- export / import of a child's record ---------- */
  {
    wipe(); ev(`createProfile("Lily")`);
    const lily = ev(`curProfile().id`), t = today();
    seed("hose", {box: 4, due: t + 3, right: 6, last: t - 1, lastGood: t - 1});
    ev(`logAnswer(${t}, "hose", true, 1, 800, "r", 1); SRS.story.fire = 2; SRS.cfg.enRate = 1.4; saveSRS();`);
    // text for copy / paste: wrapped, named, no per-question log
    const txt = JSON.parse(ev(`recordText()`));
    assert.strictEqual(txt.app, "abc_game"); assert.strictEqual(txt.format, 1); assert.strictEqual(txt.name, "Lily");
    assert(txt.data.words.hose && !("log" in txt.data), "text export keeps progress, drops the log");
    assert.strictEqual(JSON.parse(ev(`recordText(undefined, true)`)).data.log.length, 1, "file export keeps the log");
    ev(`parentPage("acct")`);
    assert(/id="bk"/.test(ev(`app.innerHTML`)), "one paste box for links / old text");
    assert(!/data-act="p-copy"/.test(ev(`app.innerHTML`)), "no more 'copy text' button");
  }
  {
    // file download
    const dl = ctx.__downloads; dl.length = 0;
    const id = ev(`PROFS.cur`);
    await click("prof-download", 0, {id});
    assert.strictEqual(dl.length, 1); assert(/^abc_Lily_20\d{6}\.json$/.test(dl[0].name), "file name: " + dl[0].name);
    const fileObj = JSON.parse(dl[0].blob.parts[0]);
    assert.strictEqual(fileObj.name, "Lily"); assert.strictEqual(fileObj.data.log.length, 1);
    assert(ev(`curProfile().exported`) > 0); assert(/今天导出过记录/.test(ev(`app.innerHTML`)), "page re-rendered with the export time");
    assert(/已开始下载/.test(alerts[alerts.length - 1]), "tells the parent what to do if nothing happens");
    ev(`__advanceDay(20)`); ev(`parentPage("acct")`);
    assert(/20 天前/.test(ev(`app.innerHTML`)) && /超过 14 天没有导出/.test(ev(`app.innerHTML`)), "reminder after 14 days");
    ev(`parentPage("view")`);
    assert(/需要你做的事/.test(ev(`app.innerHTML`)) && /超过 14 天没有导出/.test(ev(`app.innerHTML`)) && /data-act="p-tab" data-t="acct"/.test(ev(`app.innerHTML`)), "...and in the to-do box on the overview");
    ev(`__advanceDay(-20)`);
    // a name with path characters is safe in the file name
    ev(`renameProfile(PROFS.cur, 'a/b:c*d')`); dl.length = 0; await click("prof-download", 0, {id});
    assert(/^abc_a_b_c_d_20\d{6}\.json$/.test(dl[0].name), dl[0].name);
    ev(`renameProfile(PROFS.cur, "Lily")`);
  }
  {
    // round trip on a "new device": export, wipe everything, import the file
    wipe(); ev(`createProfile("Lily")`); const t = today();
    seed("hose", {box: 4, due: t + 3, right: 6, last: t - 1, lastGood: t - 1});
    ev(`SRS.story.fire = 2; saveSRS()`);
    const file = ev(`recordText(PROFS.cur, true)`), before = JSON.parse(ev(`JSON.stringify(SRS)`));
    ev(`deleteProfile(PROFS.cur)`); assert.strictEqual(profs().list.length, 0);
    ctx.__alerts.length = 0;
    ev(`accWhere = "welcome"`);
    const r = ev(`importAndShow(${JSON.stringify(file)})`);
    assert.strictEqual(r.mode, "new"); assert(/导入成功：Lily/.test(ctx.__alerts[0]));
    assert.strictEqual(ev(`curProfile().name`), "Lily");
    // importing is an "overwrite": the words get a fresh timestamp (so cloud sync does not merge older data back over them)
    const got = J(ev(`SRS.words`));
    Object.keys(got).forEach(k => { assert(got[k].updated > 0, "imported word is stamped"); delete got[k].updated; });
    assert.deepStrictEqual(got, before.words); assert.strictEqual(ev(`SRS.story.fire`), 2);
    assert(ev(`SRS.resetAt`) > 0, "import marks resetAt");
    assert(/连续/.test(ev(`app.innerHTML`)), "went to the home page");
    // same name again: asks before overwriting
    seed("pole", {box: 1}); ev(`saveSRS()`);
    ctx.__confirmAns = false;
    assert.strictEqual(ev(`importRecord(${JSON.stringify(file)})`).cancel, true);
    assert(ev(`SRS.words.pole`), "declined overwrite keeps current data");
    ctx.__confirmAns = true;
    assert.strictEqual(ev(`importRecord(${JSON.stringify(file)})`).mode, "overwrite");
    assert(!ev(`SRS.words.pole`), "overwrite replaces the record"); assert.strictEqual(profs().list.length, 1, "still one Lily");
    // pasting text on the parent page works the same way
    ev(`parentPage("acct")`); ev(`document.getElementById("bk").value = ${JSON.stringify(file)}`);
    await click("p-import"); assert(/导入成功/.test(ctx.__alerts[ctx.__alerts.length - 1]));
    assert(/家长页/.test(ev(`app.innerHTML`)), "stays on the parent page");
    // old-style backup (no name) replaces the current child after asking
    const old = JSON.stringify({words: {pole: {box: 2, due: t + 1}}, doneDays: [], streak: 0, lastDone: 0});
    ctx.__confirmAns = false; assert.strictEqual(ev(`importRecord(${JSON.stringify(old)})`).cancel, true);
    ctx.__confirmAns = true;  assert.strictEqual(ev(`importRecord(${JSON.stringify(old)})`).mode, "current");
    assert.strictEqual(ev(`SRS.words.pole.box`), 2); assert.strictEqual(ev(`curProfile().name`), "Lily");
    wipe(); assert.strictEqual(ev(`importRecord(${JSON.stringify(old)})`).ok.name, "小朋友", "old backup with no child: creates one");
    // rubbish is rejected without touching anything
    const snap = JSON.stringify(ev(`SRS`));
    ["", "abc", "[]", "null", "{}", '{"app":"abc_game"}', '{"app":"abc_game","data":{"words":5}}', '{"words":null}'].forEach(x =>
      assert(ev(`importRecord(${JSON.stringify(x)})`).err, "rejects " + x));
    assert.strictEqual(JSON.stringify(ev(`SRS`)), snap);
    // hostile values in a file are clamped / dropped
    const bad = JSON.stringify({app: "abc_game", format: 1, name: "<img src=x onerror=alert(1)>", data: {
      words: {hose: {box: 99, due: "soon", right: -5, wrong: 1e9, born: "x"}, evil: "str", arr: [1], nul: null},
      doneDays: [1, "2", "x", null, 2], streak: -3, daily: {news: [1, "a"]}, log: [{k: "hose", d: 5}, {k: 7, d: 1}, null, {d: 1}], story: {a: -1, b: 2},
      cfg: {newPerDay: 9999, enRate: "fast"}}});
    ev(`importRecord(${JSON.stringify(bad)})`);
    const w = J(ev(`SRS.words`));
    assert.deepStrictEqual(Object.keys(w), ["hose"], "only well-formed words survive");
    assert.strictEqual(w.hose.box, 5); assert.strictEqual(w.hose.due, 0); assert.strictEqual(w.hose.right, 0); assert(!("born" in w.hose));
    assert.deepStrictEqual(J(ev(`SRS.doneDays`)), [1, 2]); assert.strictEqual(ev(`SRS.streak`), 0);
    assert.deepStrictEqual(J(ev(`SRS.daily.news`)), ["a"]); assert.strictEqual(ev(`SRS.log.length`), 1);
    assert.strictEqual(ev(`SRS.cfg.newPerDay`), 20); assert.strictEqual(ev(`SRS.cfg.enRate`), 1);
    assert.strictEqual(ev(`curProfile().name`), "<img src=x o", "hostile name is cut and kept as plain text");
    ev(`parentPage("acct")`); ev(`chooserPage()`);
    assert(!/<img/.test(ev(`app.innerHTML`)), "hostile name is escaped in the chooser");
    ev(`parentPage("acct")`); assert(!/<img/.test(ev(`app.innerHTML`)), "...and on the parent page");
    ev(`parentPage("view")`); assert(!/<img/.test(ev(`app.innerHTML`)), "...and in the overview");
    // a file chosen through the <input type=file> goes through the same path (FileReader is a browser API, so only the guard clauses run here)
    ctx.__alerts.length = 0;
    ev(`importFileChosen({files: [{size: 9 * 1024 * 1024}], value: "x"})`); assert(/太大/.test(ctx.__alerts[0]));
    ev(`importFileChosen({files: []})`); ev(`importFileChosen(null)`);
  }

  /* ---------- parent page: accounts section replaces the old backup box ---------- */
  {
    wipe(); ev(`createProfile("Lily")`); seed("hose", {box: 1}); ev(`saveSRS(); createProfile("Tom")`);
    ev(`parentPage("acct")`);
    const h = ev(`app.innerHTML`);
    assert(/小朋友账户/.test(h) && /prof-download/.test(h) && /prof-rename/.test(h) && /prof-delete/.test(h) && /p-pick/.test(h) && /type="file" id="imp"/.test(h));
    assert(!/备份 \/ 恢复进度/.test(h), "old backup section is gone");
    assert((h.match(/data-act="prof-switch"/g) || []).length === 1, "switch button only for the other child");
    assert(/正在使用/.test(h) && /data-act="p-reset"/.test(h));
    // delete / reset live in a collapsed danger zone, not in the child rows
    assert(/data-keep="danger"(?! open)/.test(h) && /危险操作/.test(h), "danger zone is collapsed");
    assert.strictEqual((h.match(/data-act="prof-delete"/g) || []).length, 2, "one delete button per child, inside the danger zone");
    assert(h.indexOf("危险操作") < h.indexOf('data-act="prof-delete"') && h.indexOf("危险操作") < h.indexOf('data-act="p-reset"'));
    assert(!/<div class="prof">(?:(?!<\/div><\/div>)[\s\S])*prof-delete/.test(h), "no delete button in the child rows");
    assert(!/data-keep="paste" open/.test(h), "paste box is collapsed outside WeChat");
    ev(`navigator.userAgent = "Mozilla/5.0 MicroMessenger/8.0"`); ev(`parentPage("acct")`);
    assert(/data-keep="paste" open/.test(ev(`app.innerHTML`)) && /微信里下载不了文件/.test(ev(`app.innerHTML`)), "paste box is open inside WeChat");
    ev(`delete navigator.userAgent`);
    // switching from the parent page keeps you there
    await click("prof-switch", 0, {id: ev(`PROFS.list[0].id`)});
    assert.strictEqual(ev(`curProfile().name`), "Lily"); assert(/家长页/.test(ev(`app.innerHTML`)));
    await click("p-reset"); assert.strictEqual(Object.keys(ev(`SRS.words`)).length, 0, "reset clears only the current child");
    ev(`switchProfile(PROFS.list[1].id)`); assert.strictEqual(ev(`curProfile().name`), "Tom");
    // pasted file via the change event of the <input type=file> with no file chosen does nothing
    changeHandlers.forEach(h => h({target: {id: "imp", files: []}}));
  }

  /* ---------- transfer link: move a record between WeChat and the phone's own browser ---------- */
  {
    const enc = o => Buffer.from(JSON.stringify(o), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const setHash = h => ev(`location.hash = ${JSON.stringify(h)}; hashHandled = false;`);
    wipe(); ev(`createProfile("小明😀")`); const t = today();
    ev(`const t = ${t}; questPool().forEach((it, i) => { SRS.words[wkey(it)] = Object.assign(newWord(todayNum()), {box: i % 6, due: t + i, seen: 3 + i, right: 2 + i, wrong: i % 3, last: t - 1, lastGood: i % 2 ? null : t - 2, born: t - i}); });`
       + ` SRS.story.fire = 3; SRS.doneDays = [${t - 2}, ${t - 1}]; SRS.streak = 2; SRS.cfg.enRate = 1.2; logAnswer(${t}, "hose", true, 1, 800, "r", 1); saveSRS();`);
    const before = J(ev(`SRS`));
    const link = ev(`transferLink()`);
    assert(link.startsWith("https://alexlee-xz.github.io/abc_game/#r="), "link shape: " + link.slice(0, 60));
    assert(/^[\x21-\x7e]+$/.test(link), "link is plain ASCII (safe to paste anywhere)");
    assert(link.length < 5000, "27 learned words fit in a short link: " + link.length);
    assert(link.length < ev(`recordText(undefined, false)`).length, "shorter than the plain text export");
    // round trip onto a "new phone" (a different browser has an empty store)
    ev(`deleteProfile(PROFS.cur)`); assert.strictEqual(profs().list.length, 0);
    ctx.__alerts.length = 0;
    const r = ev(`importRecord(${JSON.stringify(link)})`);
    assert.strictEqual(r.mode, "new"); assert.strictEqual(ev(`curProfile().name`), "小明😀", "name incl. emoji survives");
    const after = J(ev(`SRS`));
    Object.keys(after.words).forEach(k => delete after.words[k].updated);      // import stamps the words (see the file round trip above)
    assert.deepStrictEqual(after.words, before.words, "all word progress survives");
    ["doneDays", "streak", "story", "cfg", "daily", "lastDone"].forEach(k => assert.deepStrictEqual(after[k], before[k], k + " survives"));
    assert.deepStrictEqual(after.log, [], "the per-question log is not carried (keeps the link short)");
    // a link pasted with other text around it, and WeChat's extra query string
    const codeOnly = link.split("#r=")[1];
    wipe();
    assert.strictEqual(ev(`importRecord(${JSON.stringify("看这个：https://alexlee-xz.github.io/abc_game/?from=singlemessage&isappinstalled=0#r=" + codeOnly + " 谢谢")})`).mode, "new");
    wipe(); assert.strictEqual(ev(`importRecord(${JSON.stringify("#r=" + codeOnly)})`).mode, "new", "bare #r= part works too");
    // damaged links are refused and change nothing
    const snap = JSON.stringify(ev(`SRS`));
    [link.slice(0, link.length - 40), link + "ZZZZ", "#r=AAAAAAAAAAAAAAAA", "#r=" + enc({v: 2, n: "x", w: []}), "#r=" + enc({v: 1, w: []}), "#r=" + enc({v: 1, n: "x", w: 5}), "?r=short"].forEach(x => {
      const e = ev(`importRecord(${JSON.stringify(x)})`);
      assert(e.err, "rejects " + x.slice(-30)); });
    assert.strictEqual(JSON.stringify(ev(`SRS`)), snap);
    // a hand-made hostile link goes through the same clean-up as files
    wipe();
    const evil = "#r=" + enc({v: 1, n: "<img src=x onerror=alert(1)>", t: "x", x: {streak: -4, cfg: {newPerDay: 9999}},
      w: [["hose", 99, "soon", 1, -5, 1e9, null, null, null, null, "x"], "str", [7], ["zzz"], null]});
    const er = ev(`importRecord(${JSON.stringify(evil)})`);
    assert.strictEqual(er.mode, "new"); assert.strictEqual(ev(`curProfile().name`), "<img src=x o");
    const w = J(ev(`SRS.words`)); assert.deepStrictEqual(Object.keys(w).sort(), ["hose", "zzz"]);
    assert.strictEqual(w.hose.box, 5); assert.strictEqual(w.hose.due, 0); assert.strictEqual(w.hose.right, 0); assert(!("born" in w.hose));
    assert.strictEqual(ev(`SRS.streak`), 0); assert.strictEqual(ev(`SRS.cfg.newPerDay`), 20);

    // opening the link: a confirm page first, nothing is changed until you agree
    wipe(); setHash("#r=" + codeOnly); ev(`boot()`);
    let h = ev(`app.innerHTML`);
    assert(/收到学习记录/.test(h) && /小明😀/.test(h) && /已学 27 个词/.test(h) && /p-hash-import/.test(h) && /p-hash-cancel/.test(h) && /还没有这个名字/.test(h), "confirm page");
    assert.strictEqual(profs().list.length, 0, "nothing imported yet"); assert.strictEqual(ev(`location.hash`), "", "link is removed from the address bar");
    ctx.__alerts.length = 0;
    await click("p-hash-import");
    assert.strictEqual(profs().list.length, 1); assert.strictEqual(ev(`curProfile().name`), "小明😀"); assert(/导入成功/.test(ctx.__alerts[0]));
    assert(/连续/.test(ev(`app.innerHTML`)), "lands on the home page"); assert.strictEqual(Object.keys(ev(`SRS.words`)).length, 27);
    ev(`boot()`); assert(!/收到学习记录/.test(ev(`app.innerHTML`)), "handled once per page load");
    // existing child with the same name: warns, then overwrites WITHOUT a second confirm
    seed("zzz", {box: 1}); ev(`saveSRS()`); setHash("#r=" + codeOnly); ev(`boot()`);
    h = ev(`app.innerHTML`); assert(/覆盖/.test(h) && h.includes(`已学 ${Object.keys(ev(`SRS.words`)).length} 个词）`), "overwrite warning shows the current progress");
    ctx.__confirmAns = false; ctx.__alerts.length = 0;
    await click("p-hash-import");
    assert(!ev(`SRS.words.zzz`), "overwritten"); assert.strictEqual(profs().list.length, 1); ctx.__confirmAns = true;
    // "not now": leaves everything alone and carries on normally
    seed("zzz", {box: 1}); ev(`saveSRS()`); setHash("#r=" + codeOnly); ev(`boot()`);
    await click("p-hash-cancel");
    assert(ev(`SRS.words.zzz`), "declined"); assert(/连续/.test(ev(`app.innerHTML`)), "back to the home page");
    wipe(); setHash("#r=" + codeOnly); ev(`boot()`); await click("p-hash-cancel");
    assert(/小朋友叫什么名字/.test(ev(`app.innerHTML`)) && profs().list.length === 0, "declining on a fresh phone goes to the welcome page");
    // a broken link in the address bar: tell the parent, then start normally
    wipe(); setHash("#r=AAAAAAAAAAAAAAAA"); ctx.__alerts.length = 0; ev(`boot()`);
    assert(/不完整/.test(ctx.__alerts[0]) && /小朋友叫什么名字/.test(ev(`app.innerHTML`)), "broken link falls back to the welcome page");
    setHash("");

    // welcome page: paste a link (or text) instead of choosing a file
    wipe(); ev(`welcomePage()`); h = ev(`app.innerHTML`);
    assert(/id="bk"/.test(h) && /data-act="p-import"/.test(h) && !/<details open/.test(h), "paste box on the welcome page");
    ev(`navigator.userAgent = "Mozilla/5.0 MicroMessenger/8.0"`); ev(`welcomePage()`);
    assert(/<details open/.test(ev(`app.innerHTML`)), "paste box is open inside WeChat"); ev(`delete navigator.userAgent`);
    ev(`document.getElementById("bk").value = ${JSON.stringify(link)}`); ev(`accWhere = "welcome"`); await click("p-import");
    assert.strictEqual(ev(`curProfile().name`), "小明😀"); assert(/连续/.test(ev(`app.innerHTML`)));

    // parent page: the link button fills the box, copies it, and counts as an export
    ev(`parentPage("acct")`); h = ev(`app.innerHTML`);
    assert(/data-act="prof-link"/.test(h) && /id="lk"/.test(h) && /data-act="prof-download"/.test(h), "browser: link + download");
    ctx.__alerts.length = 0;
    await click("prof-link", 0, {id: ev(`PROFS.cur`)});
    assert(ev(`document.getElementById("lk").value`).startsWith("https://alexlee-xz.github.io/abc_game/#r="), "box shows the link");
    assert(/已复制“小明😀”的传送链接/.test(ctx.__alerts[0]));
    assert(ev(`curProfile().exported`) > 0, "copying the link counts as a backup");
    ev(`navigator.userAgent = "Mozilla/5.0 MicroMessenger/8.0"`); ev(`parentPage("acct")`); h = ev(`app.innerHTML`);
    assert(/data-act="prof-link"/.test(h) && !/data-act="prof-download"/.test(h) && /微信不支持下载文件/.test(h), "WeChat: link instead of download");
    ev(`delete navigator.userAgent`);
  }

  /* ---------- weekly summary ---------- */
  {
    wipe(); ev(`createProfile("Lily")`);
    const t = today(), pk = k => ev(`questPool().find(p => wkey(p) === ${JSON.stringify(k)})`);
    let w = ev(`weeklyText()`);
    assert(/^【Lily 的英语小结】\d+\/\d+ ～ \d+\/\d+/.test(w), "title with name and date range: " + w.split("\n")[0]);
    assert(/打卡 0\/7 天/.test(w) && /本周没有学新词/.test(w) && /本周还没有答题记录/.test(w) && /小花园：种下 0\/27 棵/.test(w), "empty week reads sensibly");
    assert(/本周打卡 0 天/.test(w), "advice for no check-ins");
    // a busy week
    ev(`SRS.doneDays = [${t}, ${t - 2}, ${t - 10}]; SRS.streak = 1; SRS.lastDone = ${t}; SRS.story.fire = 3;`);
    seed("dancer", {born: t - 1, box: 1, due: t + 1}); seed("vet", {born: t - 6, box: 1, due: t + 1}); seed("hose", {born: t - 20, box: 5, due: t + 9});
    seed("pole", {box: 1, due: t + 1}); ev(`delete SRS.words["pole"].born`);        // an old save: no first-learned date
    seed("teacher", {born: t - 7, box: 1, due: t + 1});                                // 8 days ago: outside the week
    const L = (d, k, ok, c = "l") => ev(`logAnswer(${d}, ${JSON.stringify(k)}, ${ok}, 1, 500, "${c}", 1)`);
    L(t, "vet", false); L(t, "vet", false); L(t, "vet", true); L(t, "dancer", true); L(t - 3, "dancer", false);
    L(t - 1, "hose", true); L(t - 1, "hose", true); L(t - 1, "hose", true, "r"); L(t - 10, "vet", false);   // the last one is too old
    w = ev(`weeklyText()`);
    const zh = k => pk(k).zh;
    assert(/打卡 2\/7 天，已连续 1 天/.test(w), "check-ins in the last 7 days only");
    assert(w.includes(`本周新认识 2 个词：`) && w.includes(`dancer ${zh("dancer")}`) && w.includes(`vet ${zh("vet")}`), "new words this week");
    assert(!/teacher|pole/.test(w.split("\n").slice(0, 3).join("\n")), "old / undated words are not 'new this week'");
    assert(w.includes("答题 8 题，一次就对 5 题（63%）"), "accuracy from the last 7 days of the log: " + w);
    assert(w.includes(`vet ${zh("vet")}（错 2 次）`) && w.includes(`dancer ${zh("dancer")}（错 1 次）`), "weak words ranked");
    assert(w.indexOf("vet " + zh("vet") + "（错") < w.indexOf("dancer " + zh("dancer") + "（错"), "most missed first");
    assert(w.includes("听故事排顺序：累计完成 3 次"));
    assert(w.includes("• vet：" + ev(`tipOf(questPool().find(p => wkey(p) === "vet"))`)), "a real-life tip for a weak word");
    assert(w.includes("种下 5/27 棵") || /种下 \d+\/27 棵/.test(w));
    assert(/📌 本周打卡 2 天/.test(w), "advice mentions low check-ins");
    assert(!/hose/.test(w), "a word with no misses and not new is not listed");
    // advice rules
    ev(`SRS.doneDays = [${[0, 1, 2, 3, 4, 5, 6].map(n => t - n).join(",")}]`);
    assert(/继续保持/.test(ev(`weeklyText()`)), "nothing to improve -> encouragement");
    for(let n = 0; n < 30; n++) L(t - 2, "hose", false);
    assert(/调少一点/.test(ev(`weeklyText()`)), "low accuracy -> fewer new words");
    ev(`SRS.log = []; for(let n = 0; n < 30; n++) logAnswer(${t - 2}, "hose", true, 1, 500, "l", 1);`);
    assert(/调多一点/.test(ev(`weeklyText()`)), "very high accuracy with new words -> more new words");
    ev(`SRS.words.hose.due = ${t}; SRS.words.dancer.due = ${t}; SRS.words.vet.due = ${t}; SRS.words.pole.due = ${t}; SRS.words.teacher.due = ${t};`);
    assert(/5 棵小树渴了/.test(ev(`weeklyText()`)), "thirsty trees mentioned");
    assert(ev(`weeklyText()`).split("📌")[1].split("。").filter(Boolean).length <= 2 + 1, "at most two pieces of advice");
    // page: shows the same text and the copy button puts it on the clipboard
    ev(`parentPage("view")`);
    const h = ev(`app.innerHTML`);
    assert(/每周小结/.test(h) && /id="wk"/.test(h) && /readonly/.test(h) && /p-copy-wk/.test(h));
    assert.strictEqual(ev(`document.getElementById("wk").value`), ev(`weeklyText()`));
    ctx.__alerts.length = 0; await click("p-copy-wk");
    assert(/已复制/.test(ctx.__alerts[0]), "copy confirmed");
    // execCommand refused -> falls back to the async clipboard API; both refused -> tells the parent what to do
    ctx.__copied = [];
    ev(`document.execCommand = () => false; navigator.clipboard = {writeText: async s => { globalThis.__copied.push(s); }}`);
    ctx.__alerts.length = 0; await click("p-copy-wk"); await tick();
    assert.strictEqual(ctx.__copied.length, 1); assert.strictEqual(ctx.__copied[0], ev(`weeklyText()`)); assert(/已复制/.test(ctx.__alerts[0]));
    ev(`navigator.clipboard = {writeText: async () => { throw new Error("no"); }}`);
    ctx.__alerts.length = 0; await click("p-copy-wk"); await tick();
    assert(/长按文本框/.test(ctx.__alerts[0]), "manual copy hint");
    ev(`delete navigator.clipboard; document.execCommand = () => true`);
    // the summary is per child
    ev(`createProfile("Tom")`); assert(/【Tom 的英语小结】/.test(ev(`weeklyText()`))); assert(/打卡 0\/7 天/.test(ev(`weeklyText()`)));
    // newWord stamps the first-learned day, and an import / save keeps it
    reset(); await runQuest(); const ws = J(ev(`SRS.words`));
    assert(Object.values(ws).every(x => x.born === today()), "born is stamped when a word is first learned");
    ev(`SRS = normSRS(JSON.parse(JSON.stringify(SRS)))`); assert(Object.values(J(ev(`SRS.words`))).every(x => x.born === today()), "born survives load / import");
  }

  console.log("ALL OK; review days for first word:", reviewDays.slice(0, 6).join(","));
  const firstWeek = perDay.slice(0, 7), steady = perDay.slice(7);
  console.log("questions/day  first 7 days:", firstWeek.join(" "), " | after that min/avg/max:",
    Math.min(...steady), (steady.reduce((a, b) => a + b, 0) / steady.length).toFixed(1), Math.max(...steady));
})().catch(e => { console.error("FAIL:", e.stack || e); process.exit(1); });
