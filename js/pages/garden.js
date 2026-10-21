/* ============ 小花园：学过的词长成小树 ============
   依赖 core/srs.js、app.js 里的 app, session。 */

/* ---------- 小花园 ---------- */
function garden(){
  session++;
  const pool = questPool(), t = todayNum(), s = srsStats();
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    <h2>🌳 我的小花园</h2>
    <div class="sub">种下 ${s.planted}/${s.total} 棵<br>${STAGES.map((g, i) => g + s.byStage[i]).join("　")}</div>
    ${s.thirsty ? `<button class="big quest" data-act="quest" style="margin:4px 0 10px;padding:14px">💧 小树渴了，去浇水</button>` : ""}
    <div class="grid3">
      ${pool.map((it, i) => {
        const w = SRS.words[wkey(it)];
        const stage = w ? STAGES[w.box] : "❓";
        const thirsty = w && w.due <= t;
        return `
        <div class="card mini ${w ? "" : "locked"}" data-act="g-say" data-i="${i}">
          <div class="stage">${stage}${thirsty ? `<span class="drop">💧</span>` : ""}</div>
          <div class="emoji">${it.emoji}</div>
          <div class="en">${it.en}</div>
        </div>`;
      }).join("")}
    </div>
    <div class="footer">点一点图片听发音 · 💧 表示该复习啦<br>答对越多，种子越长越大：🌰→🌱→🌿→🪴→🌳→🍎</div>`;
  playSeq([fx("fx_garden_zh")]);
}

/* ---------- 事件 ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if(!t) return;
  const i = +t.dataset.i;
  switch(t.dataset.act){
    case "garden":   garden(); break;
    case "g-say": {
      const it = questPool()[i];
      if(it) playSeq([enClip(it), zhClip(it)]);
      break;
    }
  }
});
