// Offline test for speak.js (scoring + the 4 browser-capability paths):  node tests/test_speak.js
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const ctx = vm.createContext({console, setTimeout, clearTimeout, setImmediate});
let clickHandler = null;
ctx.__setHandler = f => { clickHandler = f; };

vm.runInContext(fs.readFileSync(path.join(root, "js/content/data.js"), "utf8"), ctx);
vm.runInContext(`
  globalThis.window = globalThis;
  const box = {innerHTML: ""};
  globalThis.__box = box;
  globalThis.document = {
    addEventListener:(t,f)=>{ if(t==='click') __setHandler(f); },
    getElementById:id=>id==='recres'?box:null,
    body:{contains:()=>true}
  };
  globalThis.navigator = {};
  globalThis.speechSynthesis = {cancel(){}};
  globalThis.URL = {createObjectURL:()=> 'blob:x', revokeObjectURL(){}};
  globalThis.Blob = class{ constructor(parts, opts){ this.parts = parts; this.type = opts && opts.type; } };
  let token = 0;
  const player = {pause(){}};
  const sleep = ms => new Promise(r => setTimeout(r, Math.min(ms, 5)));
  globalThis.__played = [];
  const playSeq = async list => { __played.push(list.filter(Boolean).map(c=>c.url)); return true; };
  const clip = (kind,id,text,lang)=>({url:'audio/'+kind+'/'+id+'.mp3',text,lang});
  const fx = id => { const f = FX.find(x=>x.id===id); if(!f) throw new Error('missing fx '+id); return clip('fx',id,f.text,f.lang); };
`, ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/audio/speak.js"), "utf8"), ctx);
const ev = code => vm.runInContext(code, ctx);
const J = x => JSON.parse(JSON.stringify(x));      // values from the vm have another realm's prototypes

// ---- IPA data: every game word has IPA, sentences don't need it
const items = ev(`LESSONS.flatMap(l=>l.items)`);
const noIpa = items.filter(i => !i.sentence && !i.ipa).map(i => i.en);
assert.strictEqual(noIpa.length, 0, "missing IPA: " + noIpa.join(","));
assert(/\/ˈtiːtʃər\//.test(ev(`ipaHtml(LESSONS[1].items.find(i=>i.id==='teacher'))`)));

// ---- scoring
const S = (t, a) => ev(`matchScore(${JSON.stringify(t)}, ${JSON.stringify(a)})`);
const N = s => ev(`starsOf(${s})`);
assert.strictEqual(N(S("hose", ["hose"])), 3);
assert.strictEqual(N(S("hose", ["Hose."])), 3);
assert.strictEqual(N(S("firefighter", ["fire fighter"])), 3);
assert.strictEqual(N(S("fire station", ["fire station"])), 3);
assert.strictEqual(N(S("fire station", ["fire"])), 1);                       // only half the phrase
assert.strictEqual(N(S("teacher", ["teachers"])), 3);
assert.strictEqual(N(S("vet", ["bed", "that"])), 1);
assert.strictEqual(N(S("vet", ["bed", "vet"])), 3);                          // best of alternatives
assert.strictEqual(N(S("Alarm bells ring!", ["alarm bells ring"])), 3);
assert.strictEqual(N(S("Alarm bells ring!", ["alarm ring"])), 2);
assert.strictEqual(N(S("astronaut", [])), 1);

// ---- doRec paths
const click = async () => {
  clickHandler({target: {closest: () => ({dataset: {en: "hose", id: "hose"}, classList: {add(){}, remove(){}}})}});
  for(let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 400));
};
const reset = () => { ev(`__box.innerHTML=''; __played.length=0; recBusy=false; delete window.webkitSpeechRecognition; delete window.SpeechRecognition; delete window.MediaRecorder; navigator.mediaDevices=undefined;`); };
const box = () => ev(`__box.innerHTML`);
const played = () => ev(`__played`).flat();
const mockRecog = (alts, error) => ev(`window.webkitSpeechRecognition = class{
  start(){ setTimeout(()=>{ ${error ? `this.onerror({error:${JSON.stringify(error)}}); this.onend();` :
    `this.onresult({results:[ ${JSON.stringify(alts)}.map(t=>({transcript:t,confidence:.9})) ]}); this.onend();`} },5); }
  stop(){}
}`);
const mockRecorder = (denied) => ev(`
  navigator.mediaDevices = {getUserMedia: async()=>{ if(${!!denied}){ const e=new Error('x'); e.name='NotAllowedError'; throw e; } return {getTracks:()=>[{stop(){}}]}; }};
  window.MediaRecorder = class{ constructor(){ this.mimeType='audio/webm'; } start(){} stop(){ this.ondataavailable({data:{size:1}}); setTimeout(()=>this.onstop(),1); } };
`);

(async () => {
  // 1) recognition success -> 3 stars + praise
  reset(); mockRecog(["hose"]); await click();
  assert(box().includes("⭐⭐⭐") && box().includes("读得真棒"), box());
  assert(played().includes("audio/fx/fx_good_en.mp3"));

  // 2) recognition heard something else -> 1 star, replays the word
  reset(); mockRecog(["bed"]); await click();
  assert(box().includes("⭐☆☆"), box());
  assert(played().includes("audio/en/hose.mp3") && played().includes("audio/fx/fx_try_zh.mp3"));

  // 3) no speech -> friendly message, no scoring
  reset(); mockRecog(null, "no-speech"); await click();
  assert(box().includes("没听到声音"), box());

  // 4) recognition service fails (e.g. offline / WeChat) -> falls back to record + playback, no score
  reset(); mockRecog(null, "network"); mockRecorder(false); await click();
  assert(box().includes("你真勇敢") && !box().includes("⭐"), box());
  const p = played();
  assert.strictEqual(JSON.stringify(p.slice(0, 5)), JSON.stringify(["audio/fx/fx_brave_zh.mp3", "audio/fx/fx_mine_zh.mp3", "blob:x", "audio/fx/fx_std_zh.mp3", "audio/en/hose.mp3"]));

  // 5) mic permission denied
  reset(); mockRecorder(true); await click();
  assert(box().includes("没有麦克风权限"), box());

  // 6) nothing supported -> tells user to open in a system browser
  reset(); await click();
  assert(box().includes("不能录音") && box().includes("在浏览器中打开"), box());

  // 7) busy guard: second click while recording is ignored
  reset(); mockRecog(["hose"]);
  clickHandler({target: {closest: () => ({dataset: {en: "hose", id: "hose"}, classList: {add(){}, remove(){}}})}});
  assert.strictEqual(ev(`recBusy`), true);
  await click();   // ignored while busy, then first finishes
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual(ev(`recBusy`), false);

  // 8) recording length: normalisation, word vs sentence defaults, early stop only after the minimum
  const N2 = (v, k) => J(ev(`normRec(${JSON.stringify(v)}, ${JSON.stringify(k)})`));
  assert.deepStrictEqual(N2(undefined, "word"), [3, 6]); assert.deepStrictEqual(N2(undefined, "sen"), [4, 10]);
  assert.deepStrictEqual(N2([2, 8], "word"), [2, 8]); assert.deepStrictEqual(N2(["5", "7.4"], "sen"), [5, 7]);
  assert.deepStrictEqual(N2([0, 99], "word"), [3, 10], "0 means unset; above the limit is cut");
  assert.deepStrictEqual(N2([99, 1], "word"), [10, 10], "max is never below min");
  assert.deepStrictEqual(N2([-5, "x"], "sen"), [4, 10]); assert.deepStrictEqual(N2([1, 3], "sen"), [2, 3], "sentence minimum is 2 s");
  assert.deepStrictEqual(N2("junk", "word"), [3, 6]); assert.deepStrictEqual(N2([8], "word"), [8, 8]);
  assert.deepStrictEqual(J(ev(`recRangeOf(false)`)), {min: 3000, max: 6000}); assert.deepStrictEqual(J(ev(`recRangeOf(true)`)), {min: 4000, max: 10000});
  ev(`globalThis.recRange = s => s ? {min: 2000, max: 3000} : {min: 1000, max: 2000}`);
  assert.deepStrictEqual(J(ev(`recRangeOf(true)`)), {min: 2000, max: 3000}, "uses the parent's setting when srs.js is loaded");
  ev(`delete globalThis.recRange`);
  const ticks = [];
  ctx.__tick = (l, c) => ticks.push([l, c]);
  reset(); mockRecorder(false);
  await ev(`recordClip(2000, 5000, (l, c) => __tick(l, c))`);
  assert.deepStrictEqual(J(ticks), [[5, false], [4, false], [3, true], [2, true], [1, true]], "full length; stop allowed after the minimum");
  ticks.length = 0; reset(); mockRecorder(false);
  await ev(`recordClip(2000, 5000, (l, c) => { __tick(l, c); if(c) recStopNow(); })`);
  assert.deepStrictEqual(J(ticks), [[5, false], [4, false], [3, true]], "stopping after the minimum ends the recording early");
  ticks.length = 0; reset(); mockRecorder(false);
  await ev(`recordClip(2000, 4000, (l, c) => { __tick(l, c); recStopNow(); })`);
  assert.deepStrictEqual(J(ticks).map(t => t[0]), [4, 3, 2], "stopping before the minimum is ignored (stops at the minimum + first allowed tick)");
  assert.strictEqual(ev(`recStopNow`), null, "stop hook is cleared afterwards");
  // the countdown text and the stop button in the real flow (recorder only, sentence item)
  reset(); mockRecorder(false);
  ev(`globalThis.__seen = []; document.getElementById('recres');`);
  ev(`Object.defineProperty(__box, 'innerHTML', {configurable: true, get(){ return this._h || ''; }, set(v){ this._h = v; __seen.push(v); }})`);
  clickHandler({target: {closest: () => ({dataset: {act: "rec", en: "Alarm bells ring!", id: "s_alarm", s: "1"}, classList: {add(){}, remove(){}}})}});
  await new Promise(r => setTimeout(r, 500));
  const seen = J(ev(`__seen`)), at = n => seen.find(h => h.includes(`还剩 <b>${n}</b> 秒`));
  assert(at(10), "sentence: counts down from its own max (10 s)");
  assert(!at(10).includes("rec-stop") && !at(7).includes("rec-stop"), "no stop button before the sentence minimum (4 s)");
  assert(at(6).includes("rec-stop"), "stop button once the minimum has passed");
  ev(`delete __box.innerHTML; __box.innerHTML = ''`);

  console.log("ALL OK");
})().catch(e => { console.error("FAIL:", e.stack || e); process.exit(1); });
