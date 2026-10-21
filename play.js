/* ============ 语音播放 ============
   微信内置浏览器不支持 speechSynthesis，所以用预先生成的 mp3 + 单个 Audio 元素
   （第一次点击时被"解锁"后，后续切换 src 都能自动播放）。

   这一层要保证两件事：
   1. 不会卡死：任何一段语音，不管加载失败、一直不出声、还是出了声却不触发 ended，最终都会让 playSeq 继续往下走。
      （之前的毛病：孩子在上一段还没开始播时点了下一题，旧段的 play() 被 pause() 打断后，
       它的失败回调把新段的 onended 清掉了，新段永远等不到“播完”，页面就停在那里。）
   2. 尽量不静音：加载失败先重试（换成预加载好的本地数据、再换一次网络请求），实在不行才回退到 TTS。
      旧的、已经被取代的那一段，不再回退到 TTS，也不再碰 Audio 元素上的回调。 */

const player = new Audio();
player.preload = "auto";
let token = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 这三个用 let，只是为了测试里可以改小
let PLAY_START_MS = 6000;    // 点播后这么久还没开始出声：当作没加载出来，换个办法重试
let PLAY_EXTRA_MS = 3000;    // 开始出声后，超过“音频时长 + 这个”还没播完：不再等，继续往下
let PLAY_MAX_MS = 20000;     // 读不到音频时长时的上限

// 家长页设置的语速（srs.js 里的 rateFor）；设置不可用时用原速
const rateOf = c => { try{ const r = rateFor(c); return r > 0 ? r : 1; }catch(e){ return 1; } };

function ttsFallback(c){
  return new Promise(res=>{
    try{
      if(!("speechSynthesis" in window)) return res();
      const u = new SpeechSynthesisUtterance(c.text);
      u.lang = c.lang === "zh" ? "zh-CN" : "en-US"; u.rate = 0.8 * rateOf(c);
      // 有的浏览器没有可用的语音，朗读永远不触发结束事件：按字数给个上限，到点就继续
      const cap = setTimeout(() => res(), Math.min(8000, 2500 + String(c.text || "").length * 150));
      u.onend = u.onerror = () => { clearTimeout(cap); res(); };
      speechSynthesis.speak(u);
    }catch(e){ res(); }
  });
}

let playId = 0;             // 每次尝试播放一个编号，只有“当前编号”才允许动 Audio 元素上的回调
let stopCurrent = null;     // 让正在等待的那一次尝试立刻结束（被新的 playSeq 取代时用）

/* 试播一次。结果：
   "ended"   正常播完
   "stuck"   出了声但一直没播完（或时间超了）：不再等，继续往下
   "fail"    加载出错，或一直没开始出声：可以换个办法再试
   "blocked" 浏览器拒绝自动播放（没有用户点击）：重试没用，直接回退
   "cancel"  被新的播放取代（或页面已经切走） */
function attemptPlay(c, src, my){
  return new Promise(res => {
    const id = ++playId, timers = [];
    let finished = false, startTimer = null;
    const mine = () => id === playId;
    const finish = r => {
      if(finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      if(mine()){ player.onended = player.onerror = player.onplaying = null; stopCurrent = null; }
      res(r);
    };
    stopCurrent = () => finish("cancel");
    player.onended = () => finish("ended");
    player.onerror = () => finish("fail");
    player.onplaying = () => {
      clearTimeout(startTimer);
      const d = player.duration, rate = player.playbackRate || 1;
      const lim = (isFinite(d) && d > 0) ? d / rate * 1000 + PLAY_EXTRA_MS : PLAY_MAX_MS;
      timers.push(setTimeout(() => {
        if(my !== token || !mine()) return finish("cancel");     // 已经切走了：不要再碰现在的播放
        try{ player.pause(); }catch(e){}
        finish("stuck");
      }, lim));
    };
    startTimer = setTimeout(() => finish(my !== token || !mine() ? "cancel" : "fail"), PLAY_START_MS);
    timers.push(startTimer);
    const r = rateOf(c);
    player.defaultPlaybackRate = r;      // 换 src 会把 playbackRate 重置成 defaultPlaybackRate，所以两个都要设
    try{ player.preservesPitch = true; player.webkitPreservesPitch = true; }catch(e){}
    player.src = src;
    player.playbackRate = r;
    let p;
    try{ p = player.play(); }catch(e){ return finish("fail"); }
    if(p && p.catch) p.catch(e => {
      // 被别人的 pause()/换 src 打断（AbortError）时，这一次尝试早就被 stopCurrent 结束了，这里什么都不做
      if(!mine() || finished) return;
      finish(e && e.name === "NotAllowedError" ? "blocked" : "fail");
    });
  });
}

const blobUrls = new Map();     // 原地址 -> 预加载好的本地数据地址（blob:）
const bust = u => u + (u.indexOf("?") < 0 ? "?" : "&") + "r=" + Date.now();
async function playOne(c, my){
  // 先用预加载好的本地数据（不受网络影响）；没有，或者它出了问题，就走网络，最后再来一次带随机参数的网络请求
  const srcs = blobUrls.has(c.url) ? [blobUrls.get(c.url), c.url] : [c.url, bust(c.url)];
  for(const src of srcs){
    if(my !== token) return;
    const r = await attemptPlay(c, src, my);
    if(r === "ended" || r === "stuck" || r === "cancel") return;
    if(r === "blocked") break;
  }
  if(my === token) await ttsFallback(c);
}
async function playSeq(list){
  const my = ++token;
  if(stopCurrent) stopCurrent();
  try{ player.pause(); }catch(e){}
  try{ speechSynthesis.cancel(); }catch(e){}      // 微信里没有 speechSynthesis，会直接跳到这里的 catch
  for(const c of list){
    if(!c) continue;
    if(my !== token) return false;
    await playOne(c, my);
    if(my !== token) return false;
    await sleep(200);
  }
  return true;
}
// 点对之后“等表扬播完再进下一题”最多等这么久；超过就直接进下一题（下一段播放会把没播完的打断）
const PRAISE_CAP_MS = 8000;
const playSeqCapped = (list, ms) => Promise.race([playSeq(list), sleep(ms || PRAISE_CAP_MS).then(() => false)]);

/* ---------- 预加载：后台把 mp3 下载成本地数据，之后播放不再依赖网络 ---------- */
const warmQueue = [], warmSeen = new Set();
let warmBusy = 0;
function warmAudio(urls, front){
  if(typeof fetch !== "function" || typeof URL === "undefined" || !URL.createObjectURL) return;
  const fresh = [...new Set(urls)].filter(u => u && !warmSeen.has(u) && !blobUrls.has(u));
  fresh.forEach(u => warmSeen.add(u));
  if(front) warmQueue.unshift(...fresh); else warmQueue.push(...fresh);
  warmPump();
}
function warmPump(){
  while(warmBusy < 2 && warmQueue.length){
    const u = warmQueue.shift();
    warmBusy++;
    fetch(u).then(r => r.ok ? r.blob() : Promise.reject(new Error("http " + r.status)))
      .then(b => {
        if(!b || b.size < 500) throw new Error("tiny");
        blobUrls.set(u, URL.createObjectURL(new Blob([b], {type: "audio/mpeg"})));
      })
      .catch(() => warmSeen.delete(u))        // 失败了以后还可以再试
      .then(() => { warmBusy--; warmPump(); });
  }
}

// 微信 iOS：JSBridge 就绪后再预热一次
document.addEventListener("WeixinJSBridgeReady", ()=>{ try{ player.load(); }catch(e){} });
