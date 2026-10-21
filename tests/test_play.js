/* 语音播放层（play.js）的测试：用一个可控的假 Audio 在 node 里复现各种“坏情况”。
   运行：node tests/test_play.js
   加 --mutate 会故意把修复还原成旧毛病，确认测试真的能抓到它（应该看到失败）。 */
const fs = require("fs"), path = require("path"), vm = require("vm");

const MUTATE = process.argv.includes("--mutate");
let code = fs.readFileSync(path.join(__dirname, "..", "js", "audio", "play.js"), "utf8");
if(MUTATE){
  // 还原旧毛病：被打断(AbortError)的旧 play() 的失败回调，把当前 Audio 上的回调清掉
  const needle = "if(!mine() || finished) return;";
  if(!code.includes(needle)) throw new Error("mutation anchor missing");
  code = code.replace(needle, "player.onended = player.onerror = null;");
}

let fails = 0;
const ok = (c, m) => { if(!c){ fails++; console.log("  FAIL:", m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, dflt) => Promise.race([p, sleep(ms).then(() => dflt)]);

/* ---------- 假的浏览器环境 ---------- */
let behave = () => ({kind: "ok"});
let ttsCount = 0, ttsTexts = [];
class FakeAudio{
  constructor(){ this.plays = []; this._timers = []; this._pend = null; this.duration = NaN; this.playbackRate = 1; this.defaultPlaybackRate = 1; }
  _clear(){
    this._timers.forEach(clearTimeout); this._timers = [];
    if(this._pend){ const p = this._pend; this._pend = null; Promise.resolve().then(() => p.reject(Object.assign(new Error("aborted"), {name: "AbortError"}))); }
  }
  set src(v){ this._clear(); this._src = v; }
  get src(){ return this._src; }
  pause(){ this._clear(); }
  load(){}
  play(){
    const src = this._src; this.plays.push(src);
    const b = behave(src, this) || {kind: "ok"};
    const d = b.delay == null ? 5 : b.delay, dur = b.dur == null ? 10 : b.dur;
    return new Promise((resolve, reject) => {
      this._pend = {reject};
      const at = (ms, fn) => this._timers.push(setTimeout(fn, ms));
      if(b.kind === "ok" || b.kind === "playing-never-end"){
        at(d, () => {
          this._pend = null; resolve();
          this.duration = b.kind === "ok" ? dur / 1000 : 0.01;
          this.onplaying && this.onplaying();
          if(b.kind === "ok") at(dur, () => this.onended && this.onended());
        });
      }else if(b.kind === "error"){
        at(d, () => { this._pend = null; reject(Object.assign(new Error("bad"), {name: "NotSupportedError"})); this.onerror && this.onerror(); });
      }else if(b.kind === "blocked"){
        at(0, () => { this._pend = null; reject(Object.assign(new Error("no"), {name: "NotAllowedError"})); });
      } // "never"：什么都不发生
    });
  }
}
let blobN = 0, fetchLog = [], fetchBehave = () => ({ok: true});
const ctx = {
  console, setTimeout, clearTimeout, Promise, Date, isFinite, Set, Map,
  Audio: FakeAudio,
  document: {addEventListener(){}},
  window: {speechSynthesis: true},
  speechSynthesis: {cancel(){}, speak(u){ ttsCount++; ttsTexts.push(u.text); setTimeout(() => u.onend && u.onend(), 3); }},
  SpeechSynthesisUtterance: function(t){ this.text = t; },
  Blob: function(parts, o){ this.size = parts[0].size; },
  URL: {createObjectURL: () => "blob:fake/" + (++blobN)},
  fetch: u => { fetchLog.push(u); const b = fetchBehave(u); return b.ok ? Promise.resolve({ok: true, blob: () => Promise.resolve({size: 2000})}) : Promise.reject(new Error("net")); },
};
vm.createContext(ctx);
const api = vm.runInContext(code + `
;({playSeq, playSeqCapped, warmAudio, blobUrls, player,
   tune(a,b,c){ PLAY_START_MS=a; PLAY_EXTRA_MS=b; PLAY_MAX_MS=c; } })`, ctx);
api.tune(60, 20, 100);

const C = n => ({url: "audio/en/" + n + ".mp3", text: n, lang: "en"});
function reset(b){ behave = b || (() => ({kind: "ok"})); ttsCount = 0; ttsTexts = []; api.player.plays.length = 0; api.player.pause(); api.blobUrls.clear(); }

(async () => {
  let r, t0;

  console.log("1. 正常播放：播完就返回 true，只播一次");
  reset();
  r = await withTimeout(api.playSeq([C("a"), C("b")]), 2000, "TIMEOUT");
  ok(r === true, "返回 true，实际 " + r);
  ok(api.player.plays.length === 2, "播了 2 段，实际 " + api.player.plays.length);
  ok(ttsCount === 0, "没有用 TTS");

  console.log("2. 竞态（旧毛病）：上一段还没开始出声，孩子又点了下一题 → 新的一段必须能正常结束");
  api.tune(60, 5000, 5000);      // 把“出声后不结束”的看门狗调得很慢，确保靠的是正常的 ended 回调而不是看门狗
  reset(src => src.includes("/slow") ? {kind: "ok", delay: 400} : {kind: "ok", delay: 5, dur: 10});
  const A = api.playSeq([C("slow")]);
  await sleep(10);
  t0 = Date.now();
  const B = api.playSeq([C("fast")]);
  r = await withTimeout(B, 1500, "TIMEOUT");
  ok(r === true, "新的一段正常结束，实际 " + r);
  ok(Date.now() - t0 < 600, "新的一段很快就结束，用了 " + (Date.now() - t0) + "ms");
  ok(await withTimeout(A, 1500, "TIMEOUT") === false, "被取代的旧序列返回 false");
  ok(ttsCount === 0, "被取代的旧段不回退到 TTS，实际 " + ttsCount);

  console.log("3. 连点：快速连续 5 次 playSeq，最后一次必须结束，其余返回 false");
  reset(() => ({kind: "ok", delay: 30, dur: 10}));
  const rs = [];
  for(let i = 0; i < 5; i++){ rs.push(api.playSeq([C("w" + i)])); await sleep(3); }
  const res = await withTimeout(Promise.all(rs), 2000, "TIMEOUT");
  ok(res !== "TIMEOUT", "全部都有结果（没有卡住）");
  if(res !== "TIMEOUT"){ ok(res[4] === true, "最后一次返回 true"); ok(res.slice(0, 4).every(x => x === false), "前面的返回 false：" + res); }
  ok(ttsCount === 0, "没有多余的 TTS");
  api.tune(60, 20, 100);

  console.log("4. 一直不出声：重试 2 次（原地址、带随机参数的地址）后回退到 TTS，总耗时有限");
  reset(() => ({kind: "never"}));
  t0 = Date.now();
  r = await withTimeout(api.playSeq([C("mute")]), 3000, "TIMEOUT");
  ok(r === true, "最终返回，实际 " + r);
  ok(api.player.plays.length === 2, "尝试 2 次，实际 " + api.player.plays.length);
  ok(api.player.plays[0] === "audio/en/mute.mp3" && /mute\.mp3\?r=\d+/.test(api.player.plays[1]), "第二次带随机参数：" + api.player.plays[1]);
  ok(ttsCount === 1 && ttsTexts[0] === "mute", "回退 TTS 一次");
  ok(Date.now() - t0 < 1000, "耗时有限 " + (Date.now() - t0) + "ms");

  console.log("5. 第一次加载出错，重试成功：不用 TTS");
  let n5 = 0;
  reset(() => (++n5 === 1 ? {kind: "error"} : {kind: "ok"}));
  r = await withTimeout(api.playSeq([C("flaky")]), 2000, "TIMEOUT");
  ok(r === true && api.player.plays.length === 2 && ttsCount === 0, "重试成功 plays=" + api.player.plays.length + " tts=" + ttsCount);

  console.log("6. 已预加载：先播本地数据；本地数据出问题再走网络");
  reset(src => src.startsWith("blob:") ? {kind: "error"} : {kind: "ok"});
  api.blobUrls.set("audio/en/pre.mp3", "blob:fake/xx");
  r = await withTimeout(api.playSeq([C("pre")]), 2000, "TIMEOUT");
  ok(api.player.plays[0] === "blob:fake/xx" && api.player.plays[1] === "audio/en/pre.mp3", "顺序 blob → 网络：" + api.player.plays);
  ok(r === true && ttsCount === 0, "成功且没用 TTS");

  console.log("7. 出了声但一直不触发 ended：不再等，继续往下（不重播、不 TTS）");
  reset(() => ({kind: "playing-never-end"}));
  t0 = Date.now();
  r = await withTimeout(api.playSeq([C("loop"), C("loop2")]), 3000, "TIMEOUT");
  ok(r === true, "返回 true，实际 " + r);
  ok(api.player.plays.length === 2 && ttsCount === 0, "每段只播一次 plays=" + api.player.plays.length + " tts=" + ttsCount);
  ok(Date.now() - t0 < 1000, "耗时有限 " + (Date.now() - t0) + "ms");

  console.log("8. 浏览器拒绝自动播放(NotAllowedError)：不重试，直接回退");
  reset(() => ({kind: "blocked"}));
  r = await withTimeout(api.playSeq([C("blk")]), 2000, "TIMEOUT");
  ok(api.player.plays.length === 1 && ttsCount === 1, "plays=" + api.player.plays.length + " tts=" + ttsCount);
  ok(r === true, "返回 true");

  console.log("9. playSeqCapped：下载/播放卡住时，最多等指定时间就放行");
  reset(() => ({kind: "never"}));
  t0 = Date.now();
  r = await withTimeout(api.playSeqCapped([C("hang1"), C("hang2"), C("hang3")], 80), 2000, "TIMEOUT");
  ok(r !== "TIMEOUT" && Date.now() - t0 < 400, "80ms 上限，实际 " + (Date.now() - t0) + "ms，结果 " + r);
  // 放行后马上开始下一题的播放，要能正常结束
  reset();
  r = await withTimeout(api.playSeq([C("next")]), 2000, "TIMEOUT");
  ok(r === true, "放行后的下一段正常 " + r);

  console.log("10. 预加载 warmAudio：下载成为本地数据；去重；并发≤2；失败后能重试");
  reset();
  fetchLog.length = 0;
  let maxBusy = 0, busy = 0;
  ctx.fetch = u => { fetchLog.push(u); busy++; maxBusy = Math.max(maxBusy, busy);
    return sleep(15).then(() => { busy--; if(u.includes("bad")) throw new Error("net"); return {ok: true, blob: () => Promise.resolve({size: 2000})}; }); };
  api.warmAudio(["u1", "u2", "u3", "u4", "u1", "bad1"]);
  api.warmAudio(["u2", "u5"]);
  await sleep(250);
  ok(api.blobUrls.size === 5, "5 个成功，实际 " + api.blobUrls.size);
  ok(fetchLog.filter(x => x === "u1").length === 1 && fetchLog.filter(x => x === "u2").length === 1, "不重复下载");
  ok(maxBusy <= 2, "并发 ≤ 2，实际 " + maxBusy);
  api.warmAudio(["bad1"]);
  await sleep(80);
  ok(fetchLog.filter(x => x === "bad1").length === 2, "失败的可以再试一次");

  console.log("11. TTS 回退时浏览器没有语音、永远不触发结束事件：也不会卡住");
  reset(() => ({kind: "blocked"}));
  ctx.speechSynthesis.speak = () => { ttsCount++; };        // 不触发 onend
  t0 = Date.now();
  r = await withTimeout(api.playSeq([C("x")]), 6000, "TIMEOUT");
  ok(r === true && Date.now() - t0 < 5000, "有上限地继续往下 " + (Date.now() - t0) + "ms，结果 " + r);

  console.log(fails ? "\nFAILED: " + fails : "\nALL OK");  process.exit(fails ? 1 : 0);
})();
