/* ============ 音标显示 + 跟读打分 ============
   依赖 index.html 里的全局：token, player, playSeq, clip, fx, sleep。

   跟读的三档能力（按浏览器自动选择）：
   1. 有语音识别（iOS Safari、部分 Android 浏览器）：识别孩子说的话，和目标单词比对，打 1~3 颗星。
      这是"识别匹配度"，不是逐音素的发音评测，仅供参考。
   2. 只有录音（MediaRecorder）：录 3 秒，回放"你的声音"和"标准发音"，不打分。
   3. 都没有（例如微信内置浏览器常见）：提示用系统浏览器打开。 */

const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const ipaHtml = it => (it && it.ipa) ? `<div class="ipa">/${esc(it.ipa)}/</div>` : "";
const recHtml = it => `
  <button class="rec" data-act="rec" data-id="${it.id}" data-en="${esc(it.en)}">🎤 跟读打分</button>
  <div class="recres" id="recres"></div>`;

/* ---------- 评分（纯函数） ---------- */
function normText(s){ return String(s || "").toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim(); }
function lev(a, b){
  let prev = Array.from({length: b.length + 1}, (_, j) => j);
  for(let i = 1; i <= a.length; i++){
    const cur = [i];
    for(let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function sim(a, b){ const m = Math.max(a.length, b.length); return m ? 1 - lev(a, b) / m : 1; }
// 目标文本 vs 识别结果（多个候选）→ 0~1。对 5 岁孩子的口音比较宽容。
function matchScore(target, alts){
  const T = normText(target), tt = T.split(" ").filter(Boolean);
  let best = 0;
  (alts || []).forEach(a => {
    const A = normText(a), at = A.split(" ").filter(Boolean);
    const whole = sim(T.replace(/ /g, ""), A.replace(/ /g, ""));            // fire fighter ≈ firefighter
    const hit = tt.filter(w => at.some(x => sim(w, x) >= 0.75)).length;      // 逐词命中
    best = Math.max(best, whole, tt.length ? hit / tt.length : 0);
  });
  return best;
}
const starsOf = s => s >= 0.85 ? 3 : (s >= 0.55 ? 2 : 1);   // 只要开口就至少 1 颗星

/* ---------- 能力检测 ---------- */
const recogCtor = () => window.SpeechRecognition || window.webkitSpeechRecognition;
const hasRecog = () => !!recogCtor();
const hasRecorder = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

function recognize(){
  return new Promise(resolve => {
    let alts = null, finished = false, timer = null;
    const fin = r => { if(finished) return; finished = true; clearTimeout(timer); resolve(r); };
    let rec;
    try{ rec = new (recogCtor())(); }catch(e){ return resolve({error: "unsupported"}); }
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 5; rec.continuous = false;
    rec.onresult = e => { try{ alts = Array.from(e.results[0]).map(a => a.transcript); }catch(x){} };
    rec.onerror = e => fin({error: e.error || "error"});
    rec.onend = () => fin({alts: alts || []});
    timer = setTimeout(() => { try{ rec.stop(); }catch(e){} }, 6000);
    try{ rec.start(); }catch(e){ fin({error: "start"}); }
  });
}

async function recordClip(ms, onTick){
  const stream = await navigator.mediaDevices.getUserMedia({audio: true});
  try{
    const rec = new MediaRecorder(stream), chunks = [];
    rec.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => { rec.onstop = r; });
    rec.start();
    for(let n = Math.ceil(ms / 1000); n > 0; n--){ onTick && onTick(n); await sleep(1000); }
    rec.stop(); await stopped;
    return URL.createObjectURL(new Blob(chunks, {type: rec.mimeType || "audio/webm"}));
  }finally{
    stream.getTracks().forEach(t => t.stop());
  }
}

/* ---------- 一次跟读 ---------- */
let recBusy = false;
async function doRec(target, id, btn){
  if(recBusy) return;
  const box = document.getElementById("recres");
  if(!box) return;
  recBusy = true; btn && btn.classList.add("rec-on");
  ++token; try{ player.pause(); speechSynthesis.cancel(); }catch(e){}
  const say = clip("en", id, target, "en");
  const show = h => { box.innerHTML = h; };
  const alive = () => document.body.contains(box);     // 中途离开页面就不再播放
  const small = t => `<div class="small">${t}</div>`;
  try{
    if(hasRecog()){
      show(`🎤 请大声说：<b>${esc(target)}</b>`);
      const r = await recognize();
      if(!r.error){
        if(!r.alts.length){ show("😶 没听清，再大声说一次吧"); return; }
        const n = starsOf(matchScore(target, r.alts));
        const msg = n === 3 ? "读得真棒！" : n === 2 ? "不错，再清楚一点！" : "再听一听，再试试！";
        show(`<div class="stars2">${"⭐".repeat(n)}${"☆".repeat(3 - n)}</div><div>${msg}</div>` +
             small(`我听到：${esc(r.alts[0])} · 识别匹配度，仅供参考`));
        if(alive()) await playSeq(n === 3 ? [fx("fx_good_en"), fx("fx_good_zh")] : [say, fx("fx_try_zh")]);
        return;
      }
      if(r.error === "no-speech"){ show("😶 没听到声音，再说一次吧"); return; }
      // 其他错误（网络 / 服务不可用 / 没权限等）：退回到"录音回放"
    }
    if(hasRecorder()){
      const url = await recordClip(3000, n => show(`🎤 录音中… <b>${n}</b><br>请大声说：<b>${esc(target)}</b>`));
      show(`🌟 你真勇敢！` + small("这个浏览器只能录音回放，不能打分。听听你的声音，再对比标准发音。"));
      if(alive()) await playSeq([fx("fx_brave_zh"), fx("fx_mine_zh"), {url, text: "", lang: "en"}, fx("fx_std_zh"), say]);
      try{ URL.revokeObjectURL(url); }catch(e){}
      return;
    }
    show("😢 这个浏览器不能录音" + small("请点右上角「···」选「在浏览器中打开」，用 Safari 或 Chrome 再试。"));
  }catch(err){
    const name = err && err.name;
    show(name === "NotAllowedError" || name === "SecurityError"
      ? "🔒 没有麦克风权限" + small("请在手机设置或浏览器里允许使用麦克风，再点一次。")
      : name === "NotFoundError"
        ? "🎙️ 没找到麦克风"
        : "😢 录音失败了，再试一次吧");
  }finally{
    recBusy = false; btn && btn.classList.remove("rec-on");
  }
}

document.addEventListener("click", e => {
  const t = e.target.closest('[data-act="rec"]');
  if(t) doRec(t.dataset.en, t.dataset.id, t);
});
