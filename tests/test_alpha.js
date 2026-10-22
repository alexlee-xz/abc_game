// Offline test for the letters page (data, stars, game rules):  node tests/test_alpha.js
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const ctx = vm.createContext({console, setTimeout, clearTimeout, setImmediate});
const store = {};
let clickHandler = null;
ctx.__store = store;
ctx.__setHandler = f => { clickHandler = f; };

vm.runInContext(read("js/content/data.js"), ctx);
vm.runInContext(read("js/content/alphabet.js"), ctx);
vm.runInContext(`
  globalThis.window = globalThis;
  globalThis.localStorage = {getItem:k=>(k in __store?__store[k]:null), setItem:(k,v)=>{__store[k]=String(v)}, removeItem:k=>{delete __store[k]}};
  globalThis.document = {addEventListener:(t,f)=>{ if(t==='click') __setHandler(f); }, querySelector:()=>null};
  globalThis.app = {innerHTML: ''};
  globalThis.panel = {innerHTML: ''};
  const cls = new Set();
  globalThis.detail = {classList: {add:c=>cls.add(c), remove:c=>cls.delete(c), contains:c=>cls.has(c)}};
  let session = 0, token = 0;
  const player = {pause(){}};
  globalThis.__played = [];
  const playSeq = async list => { __played.push(list.filter(Boolean).map(c=>c.url)); return true; };
  const playSeqCapped = playSeq;
  const shuffle = a => a.slice().sort(()=>Math.random()-0.5);
  const clip = (kind,id,text,lang)=>({url:'audio/'+kind+'/'+id+'.mp3',text,lang});
  const fx = id => { const f = FX.find(x=>x.id===id); if(!f) throw new Error('missing fx '+id); return clip('fx',id,f.text,f.lang); };
  const showZh = () => true;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  globalThis.loadSRS = () => ({words:{}}); var SRS = {words:{}};
`, ctx);
vm.runInContext(read("js/core/profile.js"), ctx);
vm.runInContext(read("js/pages/alphabet.js"), ctx);
const ev = code => vm.runInContext(code, ctx);
const J = x => JSON.parse(JSON.stringify(x));
const click = (act, extra) => { const el = Object.assign({dataset: Object.assign({act}, extra || {}), classList: {add(){}, remove(){}}}, {}); el.closest = () => el; clickHandler({target: el}); return el; };
const tick = () => new Promise(r => setTimeout(r, 5));

(async () => {
  /* ---------- data ---------- */
  const A = J(ev("ALPHABET"));
  assert.strictEqual(A.length, 26);
  assert.deepStrictEqual(A.map(L => L.id).join(""), "abcdefghijklmnopqrstuvwxyz");
  A.forEach(L => {
    assert.strictEqual(L.say, L.id.toUpperCase(), L.id + " say");
    assert(L.word && L.zh && L.emoji, L.id + " fields");
    assert(L.word[0].toLowerCase() === L.id, L.id + ": example word must start with the letter: " + L.word);
    ["let", "letw", "letz"].forEach(k => assert(fs.existsSync(path.join(root, "audio", k, L.id + ".mp3")), `missing audio/${k}/${L.id}.mp3`));
  });
  assert.strictEqual(new Set(A.map(L => L.word)).size, 26, "example words must differ");
  console.log("1. data ok (26 letters, audio files present)");

  /* ---------- stars: no profile, profile, separation ---------- */
  ev("alphaData()");
  assert.strictEqual(ev("alphaTotals().stars"), 0);
  ev('alphaMark("a", 1)');
  assert.strictEqual(ev("alphaTotals().stars"), 0, "no profile: nothing saved");
  assert.strictEqual(Object.keys(store).filter(k => k.startsWith("abc_alpha_v1__")).length, 0);

  const amy = ev('createProfile("Amy")').ok, amyId = amy.id;
  assert.strictEqual(ev("alphaTotals().stars"), 0);
  assert(/0\/26/.test(ev("basicsHtml()")) && /data-act="alpha"/.test(ev("basicsHtml()")));

  click("alpha");
  const html = ev("app.innerHTML");
  assert.strictEqual((html.match(/data-act="al-open"/g) || []).length, 26);
  assert(/data-act="al-game"/.test(html));

  click("al-open", {i: "0"});
  assert(ev('detail.classList.contains("show")'));
  const panel = ev("panel.innerHTML");
  assert(/<b class="hl">a<\/b>pple/.test(panel), "first letter highlighted: " + panel.slice(0, 200));
  assert(/苹果/.test(panel));
  assert.deepStrictEqual(J(ev("__played.at(-1)")), ["audio/let/a.mp3", "audio/letw/a.mp3", "audio/letz/a.mp3"]);
  assert.strictEqual(ev("alphaTotals().stars"), 1);
  assert.strictEqual(JSON.parse(store["abc_alpha_v1__" + amyId]).m.a, 1);
  click("al-next");
  assert(/<b class="hl">b<\/b>all/.test(ev("panel.innerHTML")));
  click("al-prev"); click("al-prev");                                  // a -> z (wraps)
  assert(/<b class="hl">z<\/b>ebra/.test(ev("panel.innerHTML")));
  click("al-name");
  assert.deepStrictEqual(J(ev("__played.at(-1)")), ["audio/let/z.mp3"]);
  click("al-word");
  assert.deepStrictEqual(J(ev("__played.at(-1)")), ["audio/letw/z.mp3", "audio/letz/z.mp3"]);
  click("al-close");
  assert(!ev('detail.classList.contains("show")'));
  assert.strictEqual(ev("alphaTotals().letters"), 3);       // a, b (opened by "next") and z
  console.log("2. page, detail, stars saved per child ok");

  // another child starts from zero; Amy keeps hers; stored data is cleaned on load
  const tom = ev('createProfile("Tom")').ok;
  assert.strictEqual(ev("alphaTotals().stars"), 0);
  ev('alphaMark("c", 7)');
  assert.strictEqual(ev("alphaTotals().stars"), 3);
  ev(`switchProfile(${JSON.stringify(amyId)})`);
  assert.strictEqual(ev("alphaTotals().letters"), 3);        // a, b, z
  store["abc_alpha_v1__" + amyId] = JSON.stringify({v: 1, m: {a: 99, "?": 1, b: "x", z: 3.7}});
  ev("ALPHA = {pid: null, m: {}}");
  assert.deepStrictEqual(J(ev("alphaData()")), {a: 3, b: 0, z: 3});       // 99 & 7 = 3, junk letter dropped
  store["abc_alpha_v1__" + amyId] = "not json";
  ev("ALPHA = {pid: null, m: {}}");
  assert.deepStrictEqual(J(ev("alphaData()")), {});
  console.log("3. per-child separation and cleaning ok");

  /* ---------- game ---------- */
  // 20 letters done (7), 6 untouched: the game must pick all 6 untouched first
  const m = {}; "abcdefghijklmnopqrst".split("").forEach(c => { m[c] = 7; });
  store["abc_alpha_v1__" + amyId] = JSON.stringify({v: 1, m});
  ev("ALPHA = {pid: null, m: {}}");
  click("al-game");
  let rounds = J(ev("AL.rounds"));
  assert.strictEqual(rounds.length, 8);
  const ids = rounds.map(r => A[r.i].id);
  "uvwxyz".split("").forEach(c => assert(ids.includes(c), "untouched letter " + c + " must be in the round: " + ids));
  assert.strictEqual(new Set(ids).size, 8);
  rounds.filter(r => "uvwxyz".includes(A[r.i].id)).forEach(r => assert.strictEqual(r.type, "n", "first the name question"));
  assert(/🎧/.test(ev("app.innerHTML")) && (ev("app.innerHTML").match(/data-act="al-choose"/g) || []).length === 3);
  // the prompt clip belongs to the current round
  const r0 = rounds[0], L0 = A[r0.i];
  assert.deepStrictEqual(J(ev("__played.at(-1)")).slice(-1), [`audio/${r0.type === "n" ? "let" : "letw"}/${L0.id}.mp3`]);

  // round 1: wrong first, then right -> no star for that round
  const wrongIdx = J(ev("AL.choices")).findIndex(c => c.id !== L0.id);
  click("al-choose", {i: String(wrongIdx)});
  assert.strictEqual(ev("AL.missed"), true);
  const before = ev("alphaTotals().stars");
  click("al-choose", {i: String(J(ev("AL.choices")).findIndex(c => c.id === L0.id))});
  await tick(); await tick();
  assert.strictEqual(ev("AL.ri"), 1);
  assert.strictEqual(ev("alphaTotals().stars"), before, "a missed round earns no star");
  assert.strictEqual(ev("AL.stars"), 0);

  // the other 7 rounds: right first time
  for(let k = 1; k < 8; k++){
    const r = rounds[k], L = A[r.i];
    const stars0 = ev("alphaTotals().stars"), bits0 = (J(ev("alphaData()"))[L.id] || 0);
    click("al-choose", {i: String(J(ev("AL.choices")).findIndex(c => c.id === L.id))});
    await tick(); await tick();
    const want = bits0 | (r.type === "n" ? 2 : 4);
    if(want !== bits0) assert.strictEqual(ev("alphaTotals().stars"), stars0 + 1, "round " + k + " earns a star");
  }
  assert(/太棒了/.test(ev("app.innerHTML")), "finish page");
  assert.strictEqual(ev("AL.stars"), 7);
  assert(/一次就答对 7 \/ 8/.test(ev("app.innerHTML")));
  assert(/data-act="al-game"/.test(ev("app.innerHTML")) && /data-act="alpha"/.test(ev("app.innerHTML")));
  console.log("4. game: untouched letters first, stars only for first-try answers ok");

  // question type follows what the letter still lacks
  ev("ALPHA = {pid: null, m: {}}");
  const m2 = {}; "abcdefghijklmnopqrstuvwxyz".split("").forEach(c => { m2[c] = 7; }); m2.a = 2; m2.b = 4;
  store["abc_alpha_v1__" + amyId] = JSON.stringify({v: 1, m: m2});
  for(let n = 0; n < 5; n++){
    click("al-game");
    const rs = J(ev("AL.rounds")), byId = {}; rs.forEach(r => { byId[A[r.i].id] = r.type; });
    assert.strictEqual(byId.a, "w", "a already has the name star, still needs the word star");
    assert.strictEqual(byId.b, "n", "b already has the word star, still needs the name star");
  }
  console.log("5. question type follows missing stars ok");

  /* ---------- deleting / re-keying a child ---------- */
  ev('alphaMark("d", 1)');
  assert(("abc_alpha_v1__" + amyId) in store);
  assert.strictEqual(ev(`rekeyProfile(${JSON.stringify(amyId)}, "cloud-amy")`), true);
  assert(!(("abc_alpha_v1__" + amyId) in store) && ("abc_alpha_v1__cloud-amy" in store), "stars follow the new id");
  ev("ALPHA = {pid: null, m: {}}");
  assert(ev("alphaTotals().stars") > 0, "stars still readable after rekey");
  ev(`deleteProfile("cloud-amy", true)`);
  assert(!("abc_alpha_v1__cloud-amy" in store), "deleting a child removes the stars");
  console.log("6. rekey / delete ok");

  console.log("ALL OK");
})().catch(e => { console.error(e); process.exit(1); });
