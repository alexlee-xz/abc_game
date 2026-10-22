// Offline test for the IPA page (data, lesson steps, quiz, game, stars):  node tests/test_ipa.js
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
vm.runInContext(read("js/content/phonetics.js"), ctx);
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
vm.runInContext(read("js/pages/phonetics.js"), ctx);
const ev = code => vm.runInContext(code, ctx);
const J = x => JSON.parse(JSON.stringify(x));
const click = (act, extra) => { const el = Object.assign({dataset: Object.assign({act}, extra || {}), classList: {add(){}, remove(){}}}, {}); el.closest = () => el; clickHandler({target: el}); return el; };
const tick = () => new Promise(r => setTimeout(r, 5));
const played = () => J(ev("__played.at(-1)"));

(async () => {
  /* ---------- data ---------- */
  const S = J(ev("IPA")), G = J(ev("IPA_GROUPS"));
  assert.strictEqual(S.length, 44, "44 sounds");
  assert.strictEqual(new Set(S.map(s => s.id)).size, 44, "ids unique");
  assert.strictEqual(new Set(S.map(s => s.ipa)).size, 44, "symbols unique");
  const count = {}; S.forEach(s => { count[s.g] = (count[s.g] || 0) + 1; });
  assert.deepStrictEqual(count, {short: 6, long: 4, rv: 5, dip: 5, stop: 6, fric: 9, aff: 2, nasal: 3, glide: 4});
  assert.deepStrictEqual(G.map(g => g.id), ["short", "long", "rv", "dip", "stop", "fric", "aff", "nasal", "glide"]);
  const slugs = new Set();
  S.forEach(s => {
    assert(/^[a-z]+$/.test(s.id), s.id + " id");
    assert(s.ipa && s.tip && /^\[\[.+\]\]$/.test(s.syn), s.id + " fields");
    assert.strictEqual(s.words.length, 3, s.id + " needs 3 example words");
    s.words.forEach(w => {
      assert(w[1], s.id + " word needs zh");
      assert(/^[^\[\]]*\[[^\[\]]+\][^\[\]]*$/.test(w[0]), `${s.id}: exactly one [..] highlight in ${w[0]}`);
      slugs.add(ev(`phSlug(${JSON.stringify(w[0])})`));
    });
    if(s.pair){
      assert.strictEqual(s.pair.length, 3, s.id + " pair");
      assert(S.some(o => o.id === s.pair[2]) && s.pair[2] !== s.id, s.id + " pair partner");
      assert(!/[\[\]]/.test(s.pair[0] + s.pair[1]));
      slugs.add(ev(`phSlug(${JSON.stringify(s.pair[0])})`)); slugs.add(ev(`phSlug(${JSON.stringify(s.pair[1])})`));
    }
    ["ph", "phz"].forEach(k => {
      const f = path.join(root, "audio", k, s.id + ".mp3");
      assert(fs.existsSync(f) && fs.statSync(f).size > 1500, `missing/empty audio/${k}/${s.id}.mp3`);
    });
  });
  slugs.forEach(sl => {
    const f = path.join(root, "audio", "phw", sl + ".mp3");
    assert(fs.existsSync(f) && fs.statSync(f).size > 1000, `missing/empty audio/phw/${sl}.mp3`);
  });
  assert.deepStrictEqual(fs.readdirSync(path.join(root, "audio", "phw")).map(f => f.replace(/\.mp3$/, "")).sort(), [...slugs].sort(), "no stale word files");
  assert.strictEqual(ev('phSlug("tele[vi]sion")'), "television");
  assert.strictEqual(ev('phSlug("Ice cream!")'), "ice_cream");
  assert.strictEqual(ev('phWordHtml("p[i]g")'), 'p<b class="hl">i</b>g');
  console.log("1. data ok (44 sounds, 3 words each, audio files present: " + slugs.size + " words)");

  /* ---------- no profile, then a profile ---------- */
  assert.strictEqual(ev("phTotals().stars"), 0);
  ev('phMark("ih", 1)');
  assert.strictEqual(ev("phTotals().stars"), 0, "no profile: nothing saved");
  assert.strictEqual(Object.keys(store).filter(k => k.startsWith("abc_ipa_v1__")).length, 0);
  const amyId = ev('createProfile("Amy")').ok.id;
  assert(/0\/44/.test(ev("basicsHtml()")) && /data-act="ipa"/.test(ev("basicsHtml()")) && /data-act="alpha"/.test(ev("basicsHtml()")));

  click("ipa");
  let html = ev("app.innerHTML");
  assert.strictEqual((html.match(/data-act="ph-open" data-i="\d+">\s*<div class="psym"/g) || []).length + 0, 44);
  assert(/开始学/.test(html) && /data-act="ph-game"/.test(html));
  G.forEach(g => assert(html.includes(g.title), g.title));
  console.log("2. chart page ok");

  /* ---------- a lesson with a pair (ɪ) ---------- */
  click("ph-open", {i: "0"});
  assert.deepStrictEqual(J(ev("PH.steps")), ["listen", "mouth", "words", "pair", "quiz"]);
  assert(/👂 听一听/.test(ev("app.innerHTML")) && />ɪ</.test(ev("app.innerHTML")));
  assert.deepStrictEqual(played(), ["audio/ph/ih.mp3"]);
  assert.strictEqual(ev("phTotals().stars"), 0, "just listening earns nothing");
  click("ph-snd");
  assert.deepStrictEqual(played(), ["audio/ph/ih.mp3"]);
  click("ph-next");                                                    // mouth
  assert(/嘴巴/.test(ev("app.innerHTML")) && /放松/.test(ev("app.innerHTML")));
  assert.deepStrictEqual(played(), ["audio/ph/ih.mp3", "audio/phz/ih.mp3"]);
  click("ph-tip");
  assert.deepStrictEqual(played(), ["audio/phz/ih.mp3"]);
  click("ph-next");                                                    // words
  html = ev("app.innerHTML");
  assert(html.includes('p<b class="hl">i</b>g') && html.includes('s<b class="hl">i</b>x') && html.includes('m<b class="hl">i</b>lk'));
  assert.deepStrictEqual(played(), ["audio/ph/ih.mp3", "audio/phw/pig.mp3", "audio/phw/six.mp3", "audio/phw/milk.mp3"]);
  click("ph-word", {k: "1"});
  assert.deepStrictEqual(played(), ["audio/phw/six.mp3"]);
  click("ph-next");                                                    // pair: sit / seat
  html = ev("app.innerHTML");
  assert(/比一比/.test(html) && html.includes(">sit<") && html.includes(">seat<") && /iː/.test(html));
  assert.deepStrictEqual(played(), ["audio/phw/sit.mp3", "audio/phw/seat.mp3"]);
  click("ph-pair", {k: "1"});
  assert.deepStrictEqual(played(), ["audio/phw/seat.mp3"]);
  assert.strictEqual(ev("phTotals().learned"), 0);
  click("ph-next");                                                    // quiz
  html = ev("app.innerHTML");
  assert(/小测/.test(html) && (html.match(/data-act="ph-pick"/g) || []).length === 3);
  assert.strictEqual(ev("phTotals().learned"), 1, "reaching the quiz marks it learned");
  assert.strictEqual(ev("phTotals().stars"), 1);
  console.log("3. lesson steps (listen, mouth, words, pair, quiz) ok");

  /* ---------- quiz rules ---------- */
  for(let n = 0; n < 15; n++){
    click("ph-open", {i: "0"}); click("ph-next"); click("ph-next"); click("ph-next"); click("ph-next");
    const ch = J(ev("PH.choices")).map(c => c.id);
    assert.strictEqual(new Set(ch).size, 3);
    assert(ch.includes("ih") && ch.includes("ee"), "the easily-confused sound is always offered: " + ch);
    const w = J(ev("IPA[PH.cur].words[PH.quizWord][0]"));
    assert.deepStrictEqual(played(), ["audio/phw/" + ev(`phSlug(${JSON.stringify(w)})`) + ".mp3"]);
  }
  for(let n = 0; n < 10; n++){                                         // "ch" group has only 2 sounds: still 3 distinct choices
    const i = S.findIndex(s => s.id === "ch");
    click("ph-open", {i: String(i)});
    for(let k = 0; k < 3; k++) click("ph-next");
    assert.deepStrictEqual(J(ev("PH.steps")).at(-1), "quiz");
    click("ph-next");
    const ch = J(ev("PH.choices")).map(c => c.id);
    assert.strictEqual(new Set(ch).size, 3); assert(ch.includes("ch") && ch.includes("sh"));
  }
  // wrong, then right -> learned but no quiz star
  click("ph-open", {i: "1"});                                          // e: has a pair too
  for(let k = 0; k < 4; k++) click("ph-next");
  let target = J(ev("IPA[PH.cur].id"));
  let wrongIdx = J(ev("PH.choices")).findIndex(c => c.id !== target);
  const base = ev("phTotals().stars");
  click("ph-pick", {k: String(wrongIdx)});
  assert.strictEqual(ev("PH.missed"), true);
  assert.strictEqual(ev("phTotals().stars"), base);
  click("ph-pick", {k: String(J(ev("PH.choices")).findIndex(c => c.id === target))});
  await tick(); await tick();
  assert(/学会啦/.test(ev("app.innerHTML")) && /再听几遍/.test(ev("app.innerHTML")));
  assert.strictEqual(ev("phTotals().stars"), base, "a missed quiz earns no star");
  // first try right -> star
  click("ph-open", {i: "1"});
  for(let k = 0; k < 4; k++) click("ph-next");
  click("ph-pick", {k: String(J(ev("PH.choices")).findIndex(c => c.id === "eh"))});
  await tick(); await tick();
  assert(/小测一次就答对了/.test(ev("app.innerHTML")));
  assert.strictEqual(J(ev("phData()")).eh, 3);
  assert.strictEqual(ev("phTotals().stars"), base + 1);
  assert(/data-act="ph-open" data-i="2">下一个音 \/æ\//.test(ev("app.innerHTML")), "next-sound button: " + ev("app.innerHTML"));
  assert.strictEqual(JSON.parse(store["abc_ipa_v1__" + amyId]).m.eh, 3);
  console.log("4. quiz: confusable sound offered, stars only for first-try answers ok");

  /* ---------- a lesson without a pair (ə), and the last sound ---------- */
  const schwaI = S.findIndex(s => s.id === "schwa");
  click("ph-open", {i: String(schwaI)});
  assert.deepStrictEqual(J(ev("PH.steps")), ["listen", "mouth", "words", "quiz"]);
  const lastI = S.length - 1;
  click("ph-open", {i: String(lastI)});
  for(let k = 0; k < 3; k++) click("ph-next");
  click("ph-pick", {k: String(J(ev("PH.choices")).findIndex(c => c.id === "y"))});
  await tick(); await tick();
  assert(!/下一个音/.test(ev("app.innerHTML")) && /英标表/.test(ev("app.innerHTML")), "no next button after the last sound");
  console.log("5. no-pair lesson and last sound ok");

  /* ---------- game ---------- */
  const m = {}; S.slice(0, 38).forEach(s => { m[s.id] = 7; });             // 6 sounds untouched
  store["abc_ipa_v1__" + amyId] = JSON.stringify({v: 1, m});
  ev("PHD = {pid: null, m: {}}");
  click("ph-game");
  const rounds = J(ev("PH.rounds")), ids = rounds.map(i => S[i].id);
  assert.strictEqual(rounds.length, 8);
  assert.strictEqual(new Set(ids).size, 8);
  S.slice(38).forEach(s => assert(ids.includes(s.id), "untouched sound " + s.id + " must be asked: " + ids));
  assert(/🎧/.test(ev("app.innerHTML")) && (ev("app.innerHTML").match(/data-act="ph-gpick"/g) || []).length === 3);
  assert.deepStrictEqual(played().slice(-1), ["audio/ph/" + ids[0] + ".mp3"]);
  const wrong = J(ev("PH.choices")).findIndex(c => c.id !== ids[0]);
  click("ph-gpick", {k: String(wrong)});
  const before = ev("phTotals().stars");
  click("ph-gpick", {k: String(J(ev("PH.choices")).findIndex(c => c.id === ids[0]))});
  await tick(); await tick();
  assert.strictEqual(ev("PH.ri"), 1);
  assert.strictEqual(ev("PH.stars"), 0, "a missed round earns no star");
  for(let k = 1; k < 8; k++){
    click("ph-gpick", {k: String(J(ev("PH.choices")).findIndex(c => c.id === ids[k]))});
    await tick(); await tick();
  }
  assert(/太棒了/.test(ev("app.innerHTML")) && /一次就答对 7 \/ 8/.test(ev("app.innerHTML")));
  assert(/data-act="ph-game"/.test(ev("app.innerHTML")) && /data-act="ipa"/.test(ev("app.innerHTML")));
  assert(ev("phTotals().stars") > before);
  const mm = J(ev("phData()"));
  assert.strictEqual(mm[ids[0]] & 4, S.findIndex(s => s.id === ids[0]) < 38 ? 4 : 0, "missed round: no game bit");
  console.log("6. game: untouched sounds first, stars only for first-try answers ok");

  /* ---------- storage hygiene ---------- */
  store["abc_ipa_v1__" + amyId] = JSON.stringify({v: 1, m: {ih: 99, nope: 1, eh: "x", ae: 3.7}});
  ev("PHD = {pid: null, m: {}}");
  assert.deepStrictEqual(J(ev("phData()")), {ih: 3, eh: 0, ae: 3});
  store["abc_ipa_v1__" + amyId] = "not json";
  ev("PHD = {pid: null, m: {}}");
  assert.deepStrictEqual(J(ev("phData()")), {});
  store["abc_ipa_v1__" + amyId] = JSON.stringify({v: 1, m: {ih: 7}});
  ev("PHD = {pid: null, m: {}}");
  // letters and IPA stars are separate
  ev('alphaMark("a", 7)');
  assert.strictEqual(ev("alphaTotals().stars"), 3);
  assert.strictEqual(ev("phTotals().stars"), 3);
  assert.strictEqual(JSON.parse(store["abc_alpha_v1__" + amyId]).m.ih, undefined);
  assert.strictEqual(ev(`rekeyProfile(${JSON.stringify(amyId)}, "cloud-amy")`), true);
  assert(!(("abc_ipa_v1__" + amyId) in store) && ("abc_ipa_v1__cloud-amy" in store), "stars follow the new id");
  ev("PHD = {pid: null, m: {}}");
  assert.strictEqual(ev("phTotals().stars"), 3);
  ev(`deleteProfile("cloud-amy", true)`);
  assert(!("abc_ipa_v1__cloud-amy" in store) && !("abc_alpha_v1__cloud-amy" in store), "deleting a child removes both");
  console.log("7. storage cleaning, separation, rekey / delete ok");

  console.log("ALL OK");
})().catch(e => { console.error(e); process.exit(1); });
