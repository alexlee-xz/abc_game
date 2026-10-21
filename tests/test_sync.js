// Offline test for cloud sync:  node tests/test_sync.js
//   1. cloud/worker.mjs against a real SQLite database (node:sqlite stands in for D1)
//   2. mergeSRS (js/core/sync.js): the merge rules
//   3. several "devices" (separate vm contexts with their own localStorage) syncing through that worker
//   4. the cloud page (js/pages/cloud.js)
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const {webcrypto} = require("crypto");
const {pathToFileURL} = require("url");

const root = path.resolve(__dirname, "..");
const J = x => JSON.parse(JSON.stringify(x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, what, ms = 4000){
  const t0 = Date.now();
  while(!cond()){ if(Date.now() - t0 > ms) throw new Error("timeout waiting for: " + what); await sleep(5); }
}

/* ---------- D1 stand-in: node:sqlite with the same prepare().bind().run()/first()/all() shape ---------- */
const {DatabaseSync} = require("node:sqlite");
function makeD1(){
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(root, "cloud/schema.sql"), "utf8"));
  return {
    raw: db,
    prepare(sql){
      const st = db.prepare(sql);
      return {bind: (...a) => ({
        run: async () => { const r = st.run(...a); return {success: true, meta: {changes: Number(r.changes)}}; },
        first: async () => st.get(...a) || null,
        all: async () => ({results: st.all(...a)})
      })};
    }
  };
}

/* ---------- a shared virtual clock and one simulated device ---------- */
const clock = {now: Date.UTC(2026, 9, 21, 12)};
const tick = ms => { clock.now += ms; };
const FILES = ["js/content/data.js", "js/audio/speak.js", "js/core/profile.js", "js/core/srs.js", "js/core/sync.js", "js/pages/parent.js", "js/pages/account.js", "js/pages/cloud.js"];
function makeNet(worker, env){
  const n = {down: false, fail: 0, hook: null, count: 0,
    async fetch(url, init = {}){
      n.count++;
      if(n.down) throw new TypeError("network down");
      if(n.hook) await n.hook(init.method || "GET", new URL(url).pathname);
      if(n.fail) return new Response(JSON.stringify({error: "x"}), {status: n.fail});
      return worker.fetch(new Request(url, {method: init.method, headers: init.headers, body: init.body}), env);
    }};
  return n;
}
function makeDevice(net){
  const store = {}, handlers = {}, timers = [], els = {};
  const ctx = vm.createContext({console, setTimeout: (f, ms) => { timers.push({f, ms}); return timers.length; }, clearTimeout: id => { if(id) timers[id - 1] = null; }});
  Object.assign(ctx, {__store: store, __handlers: handlers, __clock: clock, __els: els, __alerts: [], __confirmAns: true, btoa, atob, crypto: webcrypto, fetch: (u, i) => net.fetch(u, i)});
  const run = code => vm.runInContext(code, ctx);
  run(`
    globalThis.localStorage = {getItem:k=>(k in __store?__store[k]:null), setItem:(k,v)=>{__store[k]=String(v)}, removeItem:k=>{delete __store[k]}};
    globalThis.alert = m=>{ __alerts.push(String(m)); }; globalThis.confirm = ()=>__confirmAns; globalThis.prompt = ()=>null;
    globalThis.document = {
      addEventListener:(t,f)=>{ (__handlers[t] = __handlers[t] || []).push(f); },
      getElementById:id=>__els[id]||(__els[id]={value:'',textContent:'',select(){},setSelectionRange(){},click(){}}),
      visibilityState:'visible', execCommand:()=>true, createElement:()=>({}), body:{appendChild(){}}
    };
    const RD = Date;
    globalThis.Date = class extends RD{ constructor(...a){ a.length?super(...a):super(__clock.now);} static now(){return __clock.now;} };
    globalThis.window = globalThis; globalThis.navigator = {}; globalThis.scrollTo = () => {};
    globalThis.location = {href: "https://alexlee-xz.github.io/abc_game/", hash: "", pathname: "/abc_game/", search: ""};
    globalThis.history = {replaceState(){ location.hash = ""; }};
    const app = {innerHTML: ''}; let session = 0, token = 0; const player = {pause(){}};
    const playSeq = async () => true;
    const home = () => { app.innerHTML = 'HOME'; };
  `);
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx));
  run(`PARENT_GATE = false;`);
  const d = {ctx, store, handlers, timers, els, net, ev: run,
    sync: () => run(`syncNow()`),
    id: () => run(`PROFS.cur`),
    words: () => J(run(`SRS.words`)),
    learn: (k, f) => run(`SRS.words[${JSON.stringify(k)}] = Object.assign(newWord(todayNum()), ${JSON.stringify(f || {})}, {updated: Date.now()}); saveSRS();`),
    join: (url, code) => run(`syncEnable(${JSON.stringify(url)}, ${JSON.stringify(code)})`),
    async click(act, data){
      const t = {dataset: Object.assign({act}, data || {})}, e = {target: {closest: s => s === "[data-act]" ? t : null}};
      for(const h of handlers.click || []) await h(e);
    }};
  return d;
}

(async () => {
  const worker = (await import(pathToFileURL(path.join(root, "cloud/worker.mjs")).href)).default;
  const URL0 = "https://sync.test";
  const CODE = "ABCDEFGHJKMNPQRSTUVW", CODE2 = "23456789ABCDEFGHJKMN";

  /* ========== 1. worker ========== */
  {
    const d1 = makeD1(), env = {DB: d1};
    const api = async (code, method, p, body, extra) => {
      const h = Object.assign({}, code ? {"X-Family": code} : {}, extra || {});
      const r = await worker.fetch(new Request(URL0 + p, {method, headers: h, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body))}), env);
      return {status: r.status, j: await r.json().catch(() => null), headers: r.headers};
    };
    let r = await api(null, "GET", "/api/ping"); assert.strictEqual(r.status, 200); assert.strictEqual(r.j.ok, true);
    assert.strictEqual(r.headers.get("access-control-allow-origin"), "*", "CORS header");
    const pre = await worker.fetch(new Request(URL0 + "/api/kids", {method: "OPTIONS"}), env);
    assert.strictEqual(pre.status, 204); assert(/X-Family/.test(pre.headers.get("access-control-allow-headers")), "preflight allows the code header");
    assert.strictEqual((await api(null, "GET", "/api/kids")).status, 401, "no code");
    assert.strictEqual((await api("short", "GET", "/api/kids")).status, 401, "bad code");
    r = await api(CODE, "GET", "/api/kids"); assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j.kids, [], "empty family");
    r = await api(CODE, "PUT", "/api/kid/k1", {base: 0, name: "小宝", data: {v: 1, srs: {words: {dog: {box: 1}}}}});
    assert.strictEqual(r.status, 200); assert.strictEqual(r.j.rev, 1);
    r = await api(CODE, "GET", "/api/kid/k1"); assert.strictEqual(r.j.rev, 1); assert.strictEqual(r.j.name, "小宝"); assert.strictEqual(r.j.data.srs.words.dog.box, 1);
    assert.strictEqual((await api(CODE.toLowerCase(), "GET", "/api/kid/k1")).status, 200, "code is case-insensitive");
    r = await api(CODE, "PUT", "/api/kid/k1", {base: 1, name: "小宝", data: {v: 1, srs: {words: {dog: {box: 2}}}}}); assert.strictEqual(r.j.rev, 2);
    r = await api(CODE, "PUT", "/api/kid/k1", {base: 1, name: "x", data: {v: 1}}); assert.strictEqual(r.status, 409, "stale base is a conflict"); assert.strictEqual(r.j.rev, 2);
    r = await api(CODE, "PUT", "/api/kid/k1", {base: 0, name: "x", data: {v: 1}}); assert.strictEqual(r.status, 409, "creating over an existing row is a conflict");
    assert.strictEqual((await api(CODE, "GET", "/api/kid/k1")).j.name, "小宝", "the conflicting write changed nothing");
    // another family cannot see it
    assert.deepStrictEqual((await api(CODE2, "GET", "/api/kids")).j.kids, []); assert.strictEqual((await api(CODE2, "GET", "/api/kid/k1")).status, 404);
    // the code itself is never stored
    const rows = JSON.stringify(d1.raw.prepare("SELECT * FROM kids").all());
    assert(!rows.includes(CODE), "the sync code is not in the database"); assert(/"fam":"[0-9a-f]{64}"/.test(rows), "family is a sha-256 hash");
    // prev: a snapshot at least 6 hours old
    r = await api(CODE, "GET", "/api/kid/k1?prev=1"); assert.strictEqual(r.j.data, null, "no snapshot yet");
    d1.raw.exec("UPDATE kids SET updated = updated - 7 * 3600 * 1000");
    await api(CODE, "PUT", "/api/kid/k1", {base: 2, name: "小宝", data: {v: 1, srs: {words: {dog: {box: 3}}}}});
    r = await api(CODE, "GET", "/api/kid/k1?prev=1"); assert.strictEqual(r.j.data.srs.words.dog.box, 2, "prev holds the state before the first write after a quiet spell");
    await api(CODE, "PUT", "/api/kid/k1", {base: 3, name: "小宝", data: {v: 1, srs: {words: {dog: {box: 4}}}}});
    r = await api(CODE, "GET", "/api/kid/k1?prev=1"); assert.strictEqual(r.j.data.srs.words.dog.box, 2, "quick successive writes do not overwrite the snapshot");
    // validation
    assert.strictEqual((await api(CODE, "PUT", "/api/kid/bad id!", {base: 0, data: {}})).status, 400, "bad id");
    assert.strictEqual((await api(CODE, "PUT", "/api/kid/k2", "not json")).status, 400);
    assert.strictEqual((await api(CODE, "PUT", "/api/kid/k2", {base: -1, data: {}})).status, 400);
    assert.strictEqual((await api(CODE, "PUT", "/api/kid/k2", {base: 0, data: [1]})).status, 400);
    assert.strictEqual((await api(CODE, "PUT", "/api/kid/k2", {base: 0, data: {x: "a".repeat(950000)}})).status, 413, "too big");
    assert.strictEqual((await api(CODE, "GET", "/api/nope")).status, 404);
    // tombstone
    r = await api(CODE, "DELETE", "/api/kid/k1"); assert.strictEqual(r.status, 200);
    r = await api(CODE, "GET", "/api/kids"); assert.strictEqual(r.j.kids.length, 1); assert.strictEqual(r.j.kids[0].deleted, true);
    r = await api(CODE, "PUT", "/api/kid/k1", {base: r.j.kids[0].rev, name: "x", data: {v: 1}}); assert.strictEqual(r.status, 409); assert.strictEqual(r.j.deleted, true, "a deleted child cannot be written again");
    r = await api(CODE, "PUT", "/api/kid/k1", {base: 0, name: "x", data: {v: 1}}); assert.strictEqual(r.status, 409); assert.strictEqual(r.j.deleted, true);
    assert.strictEqual((await api(CODE, "GET", "/api/kid/k1")).j.data, null, "data of a deleted child is gone");
    // limits and wiping
    for(let i = 0; i < 23; i++) assert.strictEqual((await api(CODE, "PUT", "/api/kid/m" + i, {base: 0, name: "n", data: {v: 1}})).status, 200);
    assert.strictEqual((await api(CODE, "PUT", "/api/kid/mx", {base: 0, name: "n", data: {v: 1}})).status, 400, "row limit per family");
    await api(CODE, "DELETE", "/api/family");
    assert.deepStrictEqual((await api(CODE, "GET", "/api/kids")).j.kids, [], "family wiped");
    // ORIGINS restriction
    const env2 = {DB: d1, ORIGINS: "https://alexlee-xz.github.io"};
    const ro = (o) => worker.fetch(new Request(URL0 + "/api/kids", {headers: {"X-Family": CODE, Origin: o}}), env2);
    assert.strictEqual((await ro("https://evil.example")).status, 403); assert.strictEqual((await ro("https://alexlee-xz.github.io")).status, 200);
    console.log("1. worker api ok");
  }

  /* ========== 2. merge rules ========== */
  {
    const dev = makeDevice(makeNet(worker, {DB: makeD1()}));
    const M = (a, b) => J(dev.ev(`mergeSRS(${JSON.stringify(a)}, ${JSON.stringify(b)})`));
    const W = (box, updated, extra) => Object.assign({box, due: 100, seen: 1, right: 1, wrong: 0, last: 50, lastGood: null, rc: 0, fg: 0, lw: 0, updated}, extra || {});
    const strip = o => { const c = J(o); delete c.log; return JSON.stringify(c, Object.keys(c).sort()); };
    const same = (a, b, msg) => {
      const x = M(a, b), y = M(b, a);
      ["words", "daily", "doneDays", "streak", "lastDone", "cfg", "cfgAt", "curve", "story", "resetAt"].forEach(k => assert.deepStrictEqual(x[k], y[k], msg + " (order-independent: " + k + ")"));
      assert.deepStrictEqual(x.log.map(l => JSON.stringify(l)).sort(), y.log.map(l => JSON.stringify(l)).sort(), msg + " (log)");
      return x;
    };
    let m = same({words: {dog: W(2, 1000), cat: W(1, 5)}}, {words: {dog: W(4, 2000), bird: W(1, 7)}}, "words");
    assert.strictEqual(m.words.dog.box, 4, "the newer change of the same word wins"); assert(m.words.cat && m.words.bird, "words only one side has are kept");
    m = same({words: {dog: W(2, 3000)}}, {words: {dog: W(4, 2000)}}, "newer-first"); assert.strictEqual(m.words.dog.box, 2);
    // an old record without a timestamp: more answers wins
    const old = W(1, undefined); delete old.updated;
    m = same({words: {dog: Object.assign(old, {right: 5, wrong: 1})}}, {words: {dog: W(3, 1000, {right: 2})}}, "no timestamp on one side");
    assert.strictEqual(m.words.dog.right, 5, "falls back to the number of answers");
    // identical in every compared respect -> still the same pick from both sides
    same({words: {dog: W(2, 10, {due: 1})}}, {words: {dog: W(2, 10, {due: 2})}}, "tie");
    // check-in days, streak, today's state
    m = same({doneDays: [10, 11, 12], streak: 3, lastDone: 12, daily: {day: 12, newCount: 2, done: false, news: ["a", "b"]}},
             {doneDays: [11, 14], streak: 1, lastDone: 14, daily: {day: 12, newCount: 3, done: true, news: ["b", "c"]}}, "days");
    assert.deepStrictEqual(m.doneDays, [10, 11, 12, 14]); assert.strictEqual(m.streak, 1); assert.strictEqual(m.lastDone, 14, "streak follows the most recent check-in");
    assert.strictEqual(m.daily.done, true); assert.strictEqual(m.daily.newCount, 3); assert.deepStrictEqual(m.daily.news.sort(), ["a", "b", "c"]);
    m = same({daily: {day: 12, newCount: 2, done: true, news: ["a"]}}, {daily: {day: 13, newCount: 1, done: false, news: ["z"]}}, "daily on different days");
    assert.strictEqual(m.daily.day, 13, "the later day wins");
    // settings by cfgAt
    m = same({cfg: {newPerDay: 5}, cfgAt: 100}, {cfg: {newPerDay: 2}, cfgAt: 200}, "cfg"); assert.strictEqual(m.cfg.newPerDay, 2); assert.strictEqual(m.cfgAt, 200);
    same({cfg: {newPerDay: 5}, cfgAt: 100}, {cfg: {newPerDay: 2}, cfgAt: 100}, "cfg tie");
    // curve, story
    const c1 = J(dev.ev(`freshCurve()`)), c2 = J(dev.ev(`freshCurve()`)); c1[0] = [5, 4]; c2[0] = [3, 3]; c2[2] = [2, 1];
    m = same({curve: c1, story: {a: 2, b: 1}}, {curve: c2, story: {a: 1, c: 4}}, "curve/story");
    assert.deepStrictEqual(m.curve[0], [5, 4]); assert.deepStrictEqual(m.curve[2], [2, 1]); assert.deepStrictEqual(m.story, {a: 2, b: 1, c: 4});
    // log: identical entries are not doubled, entries only one side has are kept, real repeats survive
    const L = (d, k, extra) => Object.assign({d, k, ok: 1, n: 1, ms: 800, c: "l", p: 1}, extra || {});
    m = same({log: [L(10, "a"), L(10, "a"), L(11, "b")]}, {log: [L(10, "a"), L(12, "c")]}, "log");
    assert.strictEqual(m.log.length, 4, "a,a,b,c: shared entry counted once, a genuine repeat kept"); assert.deepStrictEqual(m.log.map(l => l.d), [10, 10, 11, 12], "sorted by day");
    // reset: the older side only contributes words learned after the reset
    m = same({resetAt: 5000, words: {fish: W(1, 5100)}, cfgAt: 5000}, {words: {dog: W(4, 4000), bird: W(2, 5200)}, doneDays: [1, 2], streak: 2, lastDone: 2, story: {x: 3}}, "reset");
    assert.deepStrictEqual(Object.keys(m.words).sort(), ["bird", "fish"], "words from before the reset are dropped, later ones kept");
    assert.deepStrictEqual(m.doneDays, []); assert.deepStrictEqual(m.story, {}); assert.strictEqual(m.resetAt, 5000);
    // idempotent, and merging with nothing changes nothing
    const x = {words: {dog: W(2, 1000)}, doneDays: [3], streak: 1, lastDone: 3, log: [L(3, "dog")]};
    assert.strictEqual(strip(M(x, x)), strip(J(dev.ev(`normSRS(${JSON.stringify(x)})`))), "merge(x, x) = x");
    assert.strictEqual(strip(M(x, {})), strip(J(dev.ev(`normSRS(${JSON.stringify(x)})`))), "merge(x, empty) = x");
    // garbage from the cloud cannot break the merge
    m = M(x, {words: "nope", doneDays: "x", log: [1, 2], cfg: 7}); assert(m.words.dog);
    console.log("2. merge rules ok");
  }

  /* ========== 3. devices ========== */
  {
    const d1 = makeD1(), env = {DB: d1};
    const mk = () => makeDevice(makeNet(worker, env));
    const A = mk(), B = mk();
    const cloudKids = async code => (await (await worker.fetch(new Request(URL0 + "/api/kids", {headers: {"X-Family": code}}), env)).json()).kids;
    const sameWords = (x, y, msg) => assert.deepStrictEqual(x.words(), y.words(), msg);

    // A creates the family
    A.ev(`createProfile("小宝")`); A.learn("dog", {box: 2, right: 3}); A.learn("cat", {box: 1});
    assert.strictEqual(A.ev(`syncOn()`), false, "off by default: nothing is sent");
    const n0 = A.net.count; A.learn("fox"); assert.strictEqual(A.net.count, n0, "no network traffic while sync is off");
    A.join(URL0, CODE);
    let r = await A.sync();
    assert.strictEqual(r.pushed, 1, "first sync uploads the child"); assert.strictEqual(r.err, undefined);
    let kids = await cloudKids(CODE); assert.strictEqual(kids.length, 1); assert.strictEqual(kids[0].id, A.id()); assert.strictEqual(kids[0].name, "小宝");
    assert.deepStrictEqual(J(A.ev(`SYNC.dirty`)), {}, "nothing left to upload");
    r = await A.sync(); assert.strictEqual(r.pushed, 0, "a second sync with no change uploads nothing"); assert.strictEqual(r.pulled, 0);

    // B joins with an empty device and gets the child
    B.join(URL0, CODE);
    r = await B.sync(); assert.strictEqual(r.pulled, 1); assert.strictEqual(B.ev(`curProfile().name`), "小宝"); assert.strictEqual(B.id(), A.id());
    sameWords(A, B, "B got A's words"); assert.strictEqual(B.ev(`SRS.words.dog.box`), 2);

    // A answers -> B sees it on its next sync
    tick(5000); A.learn("bird", {box: 1});
    assert(A.timers.some(t => t && t.ms === 4000), "an answer schedules an upload a few seconds later");
    assert(Object.keys(J(A.ev(`SYNC.dirty`))).length === 1, "marked as having changes");
    await A.sync(); r = await B.sync(); assert.strictEqual(r.pulled, 1); assert.strictEqual(r.changedCur, true); sameWords(A, B, "B has bird");

    // both offline, different words -> both survive
    A.net.down = true; B.net.down = true;
    tick(5000); A.learn("cow", {box: 1}); tick(1000); B.learn("pig", {box: 1});
    r = await A.sync(); assert(/连不上云端/.test(r.err), r.err); assert(/连不上云端/.test(A.ev(`syncStatusText()`)));
    assert.strictEqual(A.ev(`SRS.words.cow.box`), 1, "an offline sync attempt loses nothing locally"); assert(A.ev(`SYNC.dirty[PROFS.cur]`), "still marked as having changes");
    await B.sync();
    A.net.down = false; B.net.down = false;
    r = await A.sync(); assert.strictEqual(r.pushed, 1); assert.strictEqual(A.ev(`SYNC.err`), "", "error cleared after a good sync");
    r = await B.sync(); assert.strictEqual(r.pulled, 1); assert.strictEqual(r.pushed, 1, "B merged A's change and uploaded the combined result");
    await A.sync(); sameWords(A, B, "both have cow and pig");
    assert(A.ev(`!!(SRS.words.cow && SRS.words.pig)`));

    // same word edited on both sides: the later edit wins
    A.net.down = true; B.net.down = true;
    tick(5000); A.learn("dog", {box: 3}); tick(5000); B.learn("dog", {box: 5});
    A.net.down = false; B.net.down = false;
    await A.sync(); await B.sync(); await A.sync();
    assert.strictEqual(A.ev(`SRS.words.dog.box`), 5); assert.strictEqual(B.ev(`SRS.words.dog.box`), 5); sameWords(A, B, "converged");

    // settings follow the newest change; rename follows too
    tick(5000); A.ev(`SRS.cfg.newPerDay = 7; saveSRS();`);
    assert(A.ev(`SRS.cfgAt`) > 0, "changing the settings stamps cfgAt");
    A.ev(`renameProfile(PROFS.cur, "小宝宝")`);
    await A.sync(); await B.sync();
    assert.strictEqual(B.ev(`SRS.cfg.newPerDay`), 7); assert.strictEqual(B.ev(`curProfile().name`), "小宝宝");
    // an older settings change on a device that was offline does not override a newer one
    B.net.down = true; tick(1000); B.ev(`SRS.cfg.newPerDay = 4; saveSRS();`); tick(5000); A.ev(`SRS.cfg.newPerDay = 9; saveSRS();`);
    await A.sync(); B.net.down = false; await B.sync();
    assert.strictEqual(B.ev(`SRS.cfg.newPerDay`), 9, "newest settings win");

    // a change made while an upload is in flight is not lost, and stays marked
    A.net.hook = async (m) => { if(m === "PUT"){ A.net.hook = null; tick(10); A.learn("late", {box: 1}); } };
    tick(1000); A.learn("early", {box: 1});
    await A.sync();
    assert(A.ev(`SYNC.dirty[PROFS.cur]`), "a change made during the upload keeps the 'has changes' mark");
    await A.sync(); assert(!A.ev(`SYNC.dirty[PROFS.cur]`));
    await B.sync(); assert(B.ev(`!!(SRS.words.early && SRS.words.late)`), "both words arrived");
    // a change made while a download is in flight survives the merge
    B.net.hook = async (m, p) => { if(m === "GET" && /\/api\/kid\//.test(p)){ B.net.hook = null; tick(10); B.learn("mid", {box: 1}); } };
    tick(5000); A.learn("fresh", {box: 1}); await A.sync();
    await B.sync(); assert(B.ev(`!!(SRS.words.mid && SRS.words.fresh)`), "merge used the latest local state");
    await B.sync(); await A.sync(); sameWords(A, B, "converged after races");

    // server errors are reported, local data untouched
    A.net.fail = 500; tick(1000); A.learn("zzz", {box: 1});
    r = await A.sync(); assert(/云端暂时出错/.test(r.err), r.err); assert(A.ev(`!!SRS.words.zzz`)); A.net.fail = 0;
    A.net.fail = 401; r = await A.sync(); assert(/同步码不对/.test(r.err)); A.net.fail = 0;
    r = await A.sync(); assert.strictEqual(r.err, undefined); await B.sync(); assert(B.ev(`!!SRS.words.zzz`));

    // debounce: many answers in a row -> one scheduled upload
    const live = () => A.timers.filter(t => t).length;
    A.timers.length = 0; A.ev(`syncTimer = 0`);
    for(let i = 0; i < 5; i++){ tick(1000); A.learn("w" + i, {box: 1}); }
    assert.strictEqual(live(), 1, "only one upload is pending");
    A.timers.filter(t => t)[0].f(); await until(() => !A.ev(`syncBusy`), "timer-triggered sync"); await sleep(20);
    assert.deepStrictEqual(J(A.ev(`SYNC.dirty`)), {}, "the scheduled upload ran");

    // delete on A -> removed on B
    A.ev(`deleteProfile(PROFS.cur)`);
    assert(Object.keys(J(A.ev(`SYNC.del`))).length === 1, "the delete is queued");
    await A.sync(); kids = await cloudKids(CODE); assert.strictEqual(kids[0].deleted, true);
    r = await B.sync(); assert.strictEqual(r.removed, 1); assert.strictEqual(B.ev(`PROFS.list.length`), 0, "B's copy is removed too");
    assert.strictEqual(B.ev(`!Object.keys(__store).some(k => k.startsWith("abc_srs_v1__"))`), true, "and its stored record");
    console.log("3a. two devices ok");
  }
  {
    // a new device already has a child with the same name: they are recognised as the same child
    const d1 = makeD1(), env = {DB: d1};
    const A = makeDevice(makeNet(worker, env)), C = makeDevice(makeNet(worker, env));
    A.ev(`createProfile("阿布")`); A.learn("dog", {box: 2}); A.join(URL0, CODE2); await A.sync();
    C.ev(`createProfile("阿布")`); C.learn("cat", {box: 1}); const localId = C.id();
    C.join(URL0, CODE2); const r = await C.sync();
    assert.strictEqual(C.ev(`PROFS.list.length`), 1, "no duplicate 阿布"); assert.strictEqual(C.id(), A.id(), "adopted the cloud id"); assert.notStrictEqual(localId, A.id());
    assert(C.ev(`!!(SRS.words.dog && SRS.words.cat)`), "records merged"); assert.strictEqual(C.ev(`curProfile().name`), "阿布");
    await A.sync(); assert(A.ev(`!!SRS.words.cat`), "and A got C's word");
    assert(!Object.keys(C.store).some(k => k === "abc_srs_v1__" + localId), "the old local key is gone");
    // up to 6 children sync together; the 7th is not created locally
    for(const n of ["a1", "a2", "a3", "a4", "a5"]) A.ev(`createProfile(${JSON.stringify(n)})`);
    A.ev(`switchProfile(PROFS.list[0].id)`); await A.sync(); await C.sync();
    assert.strictEqual(C.ev(`PROFS.list.length`), 6, "all six children arrived");
    // reset ("清空进度") propagates, but words learned after it elsewhere survive
    const E = makeDevice(makeNet(worker, env)); E.join(URL0, CODE2); await E.sync();
    E.net.down = true; tick(1000); E.learn("bird", {box: 1});
    tick(5000); A.ev(`switchProfile(PROFS.list[0].id)`);
    A.ev(`{ const keep = normCfg(SRS.cfg); SRS = freshSRS(); SRS.cfg = keep; SRS.cfgAt = SRS.resetAt = Date.now(); saveSRS(); }`);
    await A.sync();
    tick(5000); E.learn("fish", {box: 1}); E.net.down = false;
    // E's current child is its first synced one = A's list[0]
    E.ev(`switchProfile(${JSON.stringify(A.id())})`);
    await E.sync(); await A.sync();
    assert.deepStrictEqual(Object.keys(A.words()), Object.keys(E.words()), "A and E agree after the reset");
    assert(!A.ev(`SRS.words.dog`) && !A.ev(`SRS.words.bird`), "old words are not merged back");
    console.log("3b. adoption, six children, reset ok");
  }

  /* ========== 4. cloud page ========== */
  {
    const d1 = makeD1(), env = {DB: d1};
    const U = makeDevice(makeNet(worker, env)), V = makeDevice(makeNet(worker, env));
    U.ev(`createProfile("Lily")`); U.learn("dog", {box: 2});
    U.ev(`accWhere = "parent"; parentPage("acct")`);
    let html = U.ev(`app.innerHTML`);
    assert(/云同步/.test(html) && /开启云同步/.test(html) && /id="cu"/.test(html), "off: shows the switch and the URL box");
    assert(!/立即同步/.test(html));
    // missing address
    await U.click("c-create"); assert(/请先填写云服务地址/.test(U.ctx.__alerts.pop()), "asks for the address"); assert.strictEqual(U.ev(`syncOn()`), false);
    // unreachable address
    U.els.cu = {value: URL0}; U.net.down = true; await U.click("c-create"); await until(() => U.ctx.__alerts.length, "ping failure alert");
    assert(/连不上这个云服务地址/.test(U.ctx.__alerts.pop())); assert.strictEqual(U.ev(`syncOn()`), false, "not switched on when the address is wrong");
    U.net.down = false;
    // create
    await U.click("c-create"); await until(() => U.ev(`syncOn() && SYNC.last > 0`), "create flow");
    await until(() => /立即同步/.test(U.ev(`app.innerHTML`)), "page refreshed");
    html = U.ev(`app.innerHTML`); const code = U.ev(`SYNC.code`);
    assert(html.includes(U.ev(`fmtCode(SYNC.code)`)), "the sync code is shown in groups of four"); assert(/^[A-Z2-9]{20}$/.test(code) && !/[ILO01]/.test(code), "20 chars, no look-alikes");
    assert(/已同步/.test(html));
    assert.strictEqual((await (await worker.fetch(new Request(URL0 + "/api/kids", {headers: {"X-Family": code}}), env)).json()).kids.length, 1);
    // the join link
    await U.click("c-link"); const link = U.els.cl.value;
    assert(/^https:\/\/alexlee-xz\.github\.io\/abc_game\/#s=[A-Za-z0-9_-]+$/.test(link), link); assert(/加入链接/.test(U.ctx.__alerts.pop()));
    const parsed = J(U.ev(`parseSyncInput(${JSON.stringify(link)})`)); assert.strictEqual(parsed.code, code); assert.strictEqual(parsed.url, URL0);
    assert.strictEqual(J(U.ev(`parseSyncInput(${JSON.stringify("ab-cd " + code.toLowerCase())})`)), null, "garbage is refused");
    assert.deepStrictEqual(J(U.ev(`parseSyncInput(${JSON.stringify(code.replace(/(.{4})/g, "$1-"))})`)), {url: "", code}, "a bare code with dashes works");
    // a new device: welcome page offers the code, the link opens the confirmation page
    V.ev(`welcomePage()`); assert(/用同步码加入/.test(V.ev(`app.innerHTML`)), "welcome page has the join box");
    V.ev(`location.hash = ${JSON.stringify("#s=" + link.split("#s=")[1])}`);
    const p = J(V.ev(`incomingSyncLink()`)); assert.strictEqual(p.code, code);
    V.ev(`syncJoinPage(${JSON.stringify(p)})`); assert(/加入云同步/.test(V.ev(`app.innerHTML`)));
    await V.click("c-hash-join"); await until(() => V.ev(`syncOn() && SYNC.last > 0`), "join by link");
    await until(() => V.ev(`app.innerHTML`) === "HOME", "went home");
    assert.strictEqual(V.ev(`curProfile().name`), "Lily"); assert(V.ev(`!!SRS.words.dog`));
    // a broken link
    const W = makeDevice(makeNet(worker, env)); W.ev(`location.hash = "#s=AAAAAAAAAA"`);
    assert.strictEqual(W.ev(`incomingSyncLink()`), null); assert(/不完整/.test(W.ctx.__alerts.pop()));
    // already joined with this code: no question
    V.ev(`hashHandled = false; location.hash = ${JSON.stringify("#s=" + link.split("#s=")[1])}`); assert.strictEqual(V.ev(`incomingSyncLink()`), null);
    // join by typing the code
    const X = makeDevice(makeNet(worker, env)); X.ev(`welcomePage()`);
    X.els.cu = {value: URL0}; X.els.cc = {value: "not a code"}; await X.click("c-join"); assert(/没有识别出同步码/.test(X.ctx.__alerts.pop()));
    X.els.cc = {value: code.replace(/(.{4})/g, "$1 ")}; await X.click("c-join"); await until(() => X.ev(`syncOn() && SYNC.last > 0`), "join by code");
    await until(() => X.ev(`app.innerHTML`) === "HOME", "went home"); assert.strictEqual(X.ev(`curProfile().name`), "Lily");
    // a wrong-but-well-formed code reaches an empty family: told so
    const Y = makeDevice(makeNet(worker, env)); Y.ev(`welcomePage()`); Y.els.cu = {value: URL0}; Y.els.cc = {value: CODE2};
    await Y.click("c-join"); await until(() => Y.ctx.__alerts.length, "empty family alert"); assert(/云端还没有这个家庭的记录/.test(Y.ctx.__alerts.pop()));
    // leave, then wipe
    U.ctx.__confirmAns = true; await U.click("c-leave"); assert.strictEqual(U.ev(`syncOn()`), false); assert(/开启云同步/.test(U.ev(`app.innerHTML`)));
    assert.strictEqual((await (await worker.fetch(new Request(URL0 + "/api/kids", {headers: {"X-Family": code}}), env)).json()).kids.length, 1, "leaving keeps the cloud data");
    assert(U.ev(`!!SRS.words.dog`), "and the local data");
    V.ev(`accWhere = "parent"; parentPage("acct")`); await V.click("c-wipe"); await until(() => !V.ev(`syncOn()`), "wipe");
    assert.deepStrictEqual((await (await worker.fetch(new Request(URL0 + "/api/kids", {headers: {"X-Family": code}}), env)).json()).kids, [], "cloud wiped");
    assert(V.ev(`!!SRS.words.dog`), "local data kept after wiping the cloud");
    // account tab shows the cloud box above the child accounts
    U.ev(`parentPage("acct")`); html = U.ev(`app.innerHTML`); assert(html.indexOf("云同步") < html.indexOf("小朋友账户"));
    console.log("4. cloud page ok");
  }
  console.log("ALL OK");
})().catch(e => { console.log("FAIL:", e && e.stack || e); process.exit(1); });
