/* ============ 练写单词（描红） ============
   单元里的每个词：先听发音，再用手指沿着虚线描一遍。盖住虚线的大部分才算写好；不计入复习计划。
   依赖 app.js 的 app, lesson, session, unitWords，audio/play.js 的 playSeq。 */
let Wr = null;
const wrFont = s => `700 ${s}px "Arial Rounded MT Bold","Trebuchet MS",Verdana,sans-serif`;
const WR_COVER = 0.55, WR_STRAY = 0.4;     // 至少描到字形的 55%，画在字外面的不超过 40%

function writeStart(){
  const words = unitWords(lesson).filter(it => /^[a-z][a-z' -]*$/i.test(it.en));
  if(!words.length) return;
  Wr = {words, i: 0, stars: 0};
  writeShow();
}
function writeShow(){
  session++;
  const it = Wr.words[Wr.i];
  Wr.tries = 0; Wr.locked = false;
  const dots = Wr.words.map((_, i) => i < Wr.i ? "⭐" : (i === Wr.i ? "🔹" : "⚪")).join("");
  app.innerHTML = `
    <div class="top"><button class="back" data-act="menu">← 返回</button><span></span></div>
    <div class="dots tiny">${dots}</div>
    <h2>✍️ 描一描，写一写</h2>
    <div class="wpic"><span class="emoji">${it.emoji}</span><span class="zh">${it.zh}</span></div>
    <canvas id="wc" class="wcanvas"></canvas>
    <div class="fb" id="wfb">用手指沿着虚线描一遍</div>
    <div class="row">
      <button class="ghost" data-act="w-say">🔊 听</button>
      <button class="ghost" data-act="w-clear">🧽 重写</button>
      <button class="ok" data-act="w-check">✅ 写好了</button>
    </div>
    <div class="row"><button class="ghost" data-act="w-skip">跳过 ▶</button></div>`;
  writeSetup(it);
  playSeq([enClip(it)]);
}

function writeSetup(it){
  const cv = document.getElementById("wc");
  const cssW = Math.round(Math.min((app.clientWidth || 360) - 28, 420)), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const lines = ha(it.en).split(/\s+/);
  const ms = document.createElement("canvas").getContext("2d");
  ms.font = wrFont(100);
  const w100 = Math.max(...lines.map(l => ms.measureText(l).width));
  const size = Math.floor(Math.min(84, cssW * 0.86 / w100 * 100));
  const lineH = size * 1.35, cssH = Math.round(lineH * lines.length + size * 0.2);
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  cv.style.width = cssW + "px"; cv.style.height = cssH + "px";
  const layer = () => {
    const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height;
    const x = c.getContext("2d", {willReadFrequently: true});
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.font = wrFont(size); x.textAlign = "center"; x.textBaseline = "middle"; x.lineJoin = x.lineCap = "round";
    return x;
  };
  const at = k => [cssW / 2, size * 0.1 + lineH * (k + 0.5)];
  const guide = layer(), mask = layer(), allowed = layer(), ink = layer();
  guide.fillStyle = "#eceff1"; guide.strokeStyle = "#78909c"; guide.lineWidth = 2; guide.setLineDash([7, 5]);
  mask.fillStyle = "#000";
  allowed.fillStyle = allowed.strokeStyle = "#000"; allowed.lineWidth = size * 0.3;
  lines.forEach((l, k) => {
    const [x, y] = at(k);
    guide.fillText(l, x, y); guide.strokeText(l, x, y);
    mask.fillText(l, x, y);
    allowed.strokeText(l, x, y); allowed.fillText(l, x, y);
  });
  ink.strokeStyle = "#1e88e5"; ink.lineWidth = Math.max(10, Math.min(18, size * 0.18));
  const vis = cv.getContext("2d");
  vis.setTransform(dpr, 0, 0, dpr, 0, 0);
  Wr.g = {cv, vis, guide, mask, allowed, ink, cssW, cssH};
  writeRedraw();

  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cssW / r.width, (e.clientY - r.top) * cssH / r.height]; };
  let last = null;
  const seg = (a, b) => { ink.beginPath(); ink.moveTo(a[0], a[1]); ink.lineTo(b[0], b[1]); ink.stroke(); writeRedraw(); };
  cv.addEventListener("pointerdown", e => {
    if(Wr.locked) return;
    last = pos(e);
    try{ cv.setPointerCapture(e.pointerId); }catch(_){}
    seg(last, last); e.preventDefault();
  });
  cv.addEventListener("pointermove", e => { if(!last) return; const p = pos(e); seg(last, p); last = p; });
  ["pointerup", "pointercancel"].forEach(n => cv.addEventListener(n, () => { last = null; }));
}
function writeRedraw(){
  const g = Wr.g;
  g.vis.clearRect(0, 0, g.cssW, g.cssH);
  g.vis.drawImage(g.guide.canvas, 0, 0, g.cssW, g.cssH);
  g.vis.drawImage(g.ink.canvas, 0, 0, g.cssW, g.cssH);
}
function writeClear(){
  if(!Wr || Wr.locked) return;
  const k = Wr.g.ink.canvas;
  Wr.g.ink.save(); Wr.g.ink.setTransform(1, 0, 0, 1, 0, 0); Wr.g.ink.clearRect(0, 0, k.width, k.height); Wr.g.ink.restore();
  writeRedraw();
}
// cover：字形被描到的比例；stray：画在字形外面的比例（每隔 4 个像素抽样一次）
function writeScore(){
  const {mask, allowed, ink} = Wr.g, w = ink.canvas.width, h = ink.canvas.height;
  const m = mask.getImageData(0, 0, w, h).data, a = allowed.getImageData(0, 0, w, h).data, k = ink.getImageData(0, 0, w, h).data;
  let mt = 0, mc = 0, it = 0, io = 0;
  for(let p = 3; p < m.length; p += 16){
    const inked = k[p] > 60;
    if(m[p] > 128){ mt++; if(inked) mc++; }
    if(inked){ it++; if(a[p] <= 128) io++; }
  }
  return {cover: mt ? mc / mt : 0, stray: it ? io / it : 1, ink: it};
}
async function writeCheck(){
  if(!Wr || Wr.locked) return;
  const it = Wr.words[Wr.i], r = writeScore(), fb = document.getElementById("wfb");
  if(r.cover >= WR_COVER && r.stray <= WR_STRAY){
    Wr.locked = true;
    if(Wr.tries === 0) Wr.stars++;
    fb.className = "fb"; fb.textContent = "🌟 写得真棒！";
    const s = session;
    await playSeqCapped([fx("fx_good_en"), enClip(it)]);
    if(s !== session) return;
    writeNext();
    return;
  }
  Wr.tries++;
  fb.className = "fb err"; fb.textContent = r.ink < 20 ? "用手指沿着虚线描一描 👆" : "再描一遍，尽量盖住每个字母 👆";
  const cv = Wr.g.cv;
  cv.classList.add("wshake"); setTimeout(() => cv.classList.remove("wshake"), 500);
  playSeq([fx("fx_try_en")]);
}
function writeNext(){
  Wr.i++;
  Wr.i < Wr.words.length ? writeShow() : writeFinish();
}
function writeFinish(){
  session++;
  app.innerHTML = `
    <div class="top"><span></span><span></span></div>
    <h1>🎉 写完啦！</h1>
    <div class="stars">${"⭐".repeat(Wr.stars) || "🌟"}</div>
    <div class="sub">一次就描好 ${Wr.stars} / ${Wr.words.length} 个</div>
    <button class="big blue" data-act="write">🔁 再写一次</button>
    <button class="big green" data-act="menu">📚 回到单元</button>
    <button class="big" data-act="home">🏠 回到首页</button>`;
  playSeq([fx("fx_done_zh")]);
}

document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if(!t) return;
  switch(t.dataset.act){
    case "write":   writeStart(); break;
    case "w-say":   if(Wr && !Wr.locked) playSeq([enClip(Wr.words[Wr.i])]); break;
    case "w-clear": writeClear(); break;
    case "w-check": writeCheck(); break;
    case "w-skip":  if(Wr && !Wr.locked) writeNext(); break;
  }
});
