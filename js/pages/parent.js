/* ============ 家长页：进门小问题、三个页签（概览 / 设置 / 账户与备份）、遗忘曲线 ============
   依赖 core/srs.js；小朋友账户和每周小结来自 pages/account.js（缺了也能显示）。 */

/* ---------- 遗忘曲线（手写 SVG，不依赖任何库） ----------
   横坐标：上次见到这个词隔了几天；纵坐标：隔了这么久后「第一次就点对」的比例。
   每个点下面写测试次数 n；n<3 的点画成空心（样本太少，仅供参考）。 */
function curveSvg(curve){
  const W = 320, H = 178, L = 36, R = 10, T = 16, B = 44, pw = W - L - R, ph = H - T - B;
  const m = GAP_BUCKETS.length;
  const X = i => L + (i + 0.5) * pw / m, Y = p => T + (1 - p) * ph;
  const color = p => p >= 0.8 ? "#43a047" : p >= 0.6 ? "#fb8c00" : "#e53935";
  let g = "";
  [0, 0.5, 1].forEach(p => {
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(p)}" y2="${Y(p)}" stroke="#e0e0e0"/>` +
         `<text x="${L - 4}" y="${Y(p) + 3}" font-size="9" fill="#999" text-anchor="end">${p * 100}%</text>`;
  });
  g += `<line x1="${L}" x2="${W - R}" y1="${Y(0.8)}" y2="${Y(0.8)}" stroke="#a5d6a7" stroke-dasharray="4 3"/>` +
       `<text x="${W - R}" y="${Y(0.8) - 2}" font-size="8" fill="#66bb6a" text-anchor="end">目标 80%</text>`;
  const pts = [];
  curve.forEach((c, i) => {
    const n = c[0], x = X(i);
    g += `<text x="${x}" y="${H - B + 13}" font-size="9" fill="#666" text-anchor="middle">${GAP_BUCKETS[i][2]}</text>` +
         `<text x="${x}" y="${H - B + 25}" font-size="8" fill="#aaa" text-anchor="middle">${n ? "n=" + n : "-"}</text>`;
    if(n) pts.push({x, p: c[1] / n, n});
  });
  if(pts.length > 1) g += `<polyline fill="none" stroke="#ffab91" stroke-width="2" points="${pts.map(q => q.x.toFixed(1) + "," + Y(q.p).toFixed(1)).join(" ")}"/>`;
  pts.forEach(q => {
    const col = color(q.p), few = q.n < 3;
    g += `<circle cx="${q.x.toFixed(1)}" cy="${Y(q.p).toFixed(1)}" r="5" fill="${few ? "#fff" : col}" stroke="${col}" stroke-width="2"/>` +
         `<text x="${q.x.toFixed(1)}" y="${(Y(q.p) - 8).toFixed(1)}" font-size="9" fill="${col}" text-anchor="middle">${Math.round(q.p * 100)}%</text>`;
  });
  g += `<text x="${L + pw / 2}" y="${H - 2}" font-size="9" fill="#999" text-anchor="middle">隔了几天再测</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="遗忘曲线">${g}</svg>`;
}
function curveSection(){
  const total = SRS.curve.reduce((a, c) => a + c[0], 0);
  return `<div class="sec"><h3>遗忘曲线</h3>` +
    (total ? curveSvg(SRS.curve) : `<div class="note">还没有数据。孩子隔天复习过的词多了，这里才会画出曲线。</div>`) +
    `<div class="note">每个点：隔了这么多天再测时，第一次就点对的比例（下面的 n 是测试次数）。曲线慢慢往下掉是正常的，掉得越慢说明记得越牢。空心点表示测试不到 3 次，不要当真。` +
    `这张图从这个版本开始统计，之前的作答没有计入。</div></div>`;
}

/* ---------- 进家长页的小问题 ----------
   只是防止孩子随手点进来乱改设置，不是安全措施。答对后 5 分钟内（页面有操作就顺延）不再问；点“返回”立刻重新上锁。 */
let PARENT_GATE = true;                 // 测试里可以关掉
const PARENT_OPEN_MS = 5 * 60 * 1000;
let parentUntil = 0, parentGateQ = null;
function gatePage(msg){
  session++; token++; try{ player.pause(); }catch(e){}
  const a = 12 + Math.floor(Math.random() * 8), b = 3 + Math.floor(Math.random() * 7);
  parentGateQ = {a, b};
  app.innerHTML = `
    <div class="top"><button class="back" data-act="home">← 返回</button><span></span></div>
    <h2>👨‍👩‍👧 家长验证</h2>
    <div class="sub">这一页是给大人看的，请先回答一个小问题</div>
    <div class="sec" style="text-align:center">
      <div class="gate-q">${a} + ${b} = ?</div>
      <input id="gate" class="nm" type="tel" inputmode="numeric" maxlength="3" placeholder="答案" autocomplete="off">
      <div class="fb err" id="gate-err">${msg || ""}</div>
      <button class="big green" data-act="p-gate" style="margin:6px 0 0">进入</button>
    </div>`;
  setTimeout(() => { const e = document.getElementById("gate"); if(e && e.focus) try{ e.focus(); }catch(err){} }, 60);
}
function gateSubmit(){
  const el = document.getElementById("gate"), q = parentGateQ;
  const v = el ? parseInt(String(el.value).trim(), 10) : NaN;
  if(q && v === q.a + q.b){ parentGateQ = null; parentPage(); return true; }
  gatePage("不对哦，请再试一道");
  return false;
}
// 从首页点“家长页”走这里：没解锁就先问小问题
function openParent(tab){
  parentTab = PARENT_TABS.some(t => t[0] === tab) ? tab : "view";
  if(!PARENT_GATE || Date.now() < parentUntil) parentPage(); else gatePage();
}

/* ---------- 学习节奏预设（只改这四项，不动语速和录音时长） ---------- */
const PRESETS = [
  {id: "easy", label: "轻松", newPerDay: 2, zh: "all", say: false, act: true,
   desc: "每天 2 个新词；每题都带中文提示；不出“说一说”，保留“动一动”。适合刚开始学、容易分心的孩子。"},
  {id: "std", label: "标准", newPerDay: 3, zh: "new", say: true, act: true,
   desc: "每天 3 个新词；中文只在新词页出现，答题只听英文；“说一说”“动一动”都开。大多数孩子用这个就好。"},
  {id: "hard", label: "挑战", newPerDay: 6, zh: "new", say: true, act: true,
   desc: "每天 6 个新词，其余和“标准”一样。适合已经很顺、觉得太简单的孩子。"}
];
const presetOf = c => (PRESETS.find(p => p.newPerDay === c.newPerDay && p.zh === c.zh && p.say === c.say && p.act === c.act) || {}).id || "";
function presetHtml(cfg){
  const cur = presetOf(cfg), p = PRESETS.find(x => x.id === cur);
  return `<div class="note" style="margin-top:0">当前：<b>${p ? p.label : "自定义"}</b></div>` +
    PRESETS.map(x => `<button class="small-btn${x.id === cur ? " on" : " ghost"}" data-act="p-preset" data-v="${x.id}">${x.label}</button>`).join("") +
    `<div class="note" style="margin-top:8px">${p ? p.desc : "你调整过下面“高级设置”里的选项，和三个预设都不完全一样。点上面的按钮可以一键套用。"}</div>`;
}
function refreshPresets(){ const e = document.getElementById("presets"); if(e) e.innerHTML = presetHtml(normCfg(SRS.cfg)); }

/* ---------- 家长页 ---------- */
const PARENT_TABS = [["view", "概览"], ["set", "设置"], ["acct", "账户与备份"]];
let parentTab = "view";
const parentOpen = {};                  // 折叠区是否展开（重画页面后保持原样）：data-keep -> true/false
const keepOpen = (k, dflt) => ((k in parentOpen) ? parentOpen[k] : !!dflt) ? " open" : "";
const pline = (a, b) => `<div class="line"><span>${a}</span><b>${b}</b></div>`;

// 概览顶部：需要家长做什么（没有就显示“一切正常”）
function todoSection(d, q){
  const items = [];
  if(!d.done) items.push(`📌 今天的魔法任务还没做${q.due.length ? `（有 ${q.due.length} 个词该复习，会自动带上）` : ""}`);
  const hard = questPool().map(it => ({it, w: SRS.words[wkey(it)]}))
    .filter(x => x.w && x.w.box === 0 && x.w.wrong >= 3).sort((a, b) => b.w.wrong - a.w.wrong).slice(0, 2);
  if(hard.length) items.push(`📌 ${hard.map(x => x.it.en + " " + x.it.zh).join("、")} 总是答错，可以在生活里多指给孩子看、说一说`);
  const bn = typeof backupNote === "function" ? backupNote() : "";
  if(bn) items.push(`📌 ${bn}，建议现在备份一份 <button class="small-btn" data-act="p-tab" data-t="acct">去备份</button>`);
  return `<div class="sec todo${items.length ? "" : " ok"}"><h3>需要你做的事</h3>` +
    (items.length ? items.map(x => `<div class="todo-i">${x}</div>`).join("") : `<div class="todo-i">✅ 暂时没有，继续保持！</div>`) + `</div>`;
}

function overviewTab(){
  const t = todayNum(), d = dailyState(), q = buildQueue(), s = srsStats(), pool = questPool();
  const buckets = new Array(8).fill(0);
  pool.forEach(it => { const w = SRS.words[wkey(it)]; if(w) buckets[Math.min(7, Math.max(0, w.due - t))]++; });
  const bl = i => i === 0 ? "今天（含已到期）" : i === 1 ? "明天" : i === 7 ? "7 天以后" : i + " 天后";
  const upcoming = buckets.map((n, i) => n ? pline(bl(i), n + " 个") : "").join("") || pline("暂无", "");
  const weak = pool.map(it => ({it, w: SRS.words[wkey(it)]}))
    .filter(x => x.w && x.w.fg > 0)
    .sort((a, b) => b.w.fg - a.w.fg || (b.w.fg / (b.w.rc || 1)) - (a.w.fg / (a.w.rc || 1))).slice(0, 5);
  const weakHtml = weak.map(x => pline(`${x.it.en} ${x.it.zh}`, `忘 ${x.w.fg} / 复习 ${x.w.rc} 次`)).join("") || pline("暂时没有", "");
  const learning = pool.map(it => ({it, w: SRS.words[wkey(it)]}))
    .filter(x => x.w && x.w.box === 0 && x.w.wrong > 0)
    .sort((a, b) => b.w.wrong - a.w.wrong).slice(0, 6);
  const learningHtml = learning.map(x => pline(`${x.it.en} ${x.it.zh}`, `答错 ${x.w.wrong} 次`)).join("") || pline("暂时没有", "");
  let rc = 0, fg = 0;
  pool.forEach(it => { const w = SRS.words[wkey(it)]; if(w){ rc += w.rc || 0; fg += w.fg || 0; } });
  const rate = rc ? Math.round(fg / rc * 100) + "%" : "—";
  const storyDone = Object.values(SRS.story).reduce((a, b) => a + b, 0);
  let hist = "", histN = 0;
  const wdOf = n => (new Date(n * 86400000).getUTCDay() + 6) % 7;   // 周一=0 … 周日=6
  const first = t - 29, startCell = first - wdOf(first), endCell = t + (6 - wdOf(t));
  hist += ["一", "二", "三", "四", "五", "六", "日"].map(w => `<span class="hw">${w}</span>`).join("");
  for(let day = startCell; day <= endCell; day++){
    if(day < first || day > t){ hist += `<span class="hd off"></span>`; continue; }
    const on = SRS.doneDays.includes(day);
    if(on) histN++;
    hist += `<span class="hd${day === t ? " today" : ""}">${on ? "✅" : "▫️"}<i>${dayLabel(day)}</i></span>`;
  }
  return `
    ${todoSection(d, q)}
    <div class="sec"><h3>今天</h3>
      ${pline("今日任务", d.done ? "已完成 ✅" : "未完成")}
      ${pline("待复习的词", q.due.length + " 个")}
      ${pline("今天还可学新词", q.news.length + " 个")}
      ${pline("连续打卡", currentStreak() + " 天")}
    </div>
    ${tipSection("今日家长小任务", "今天还没有新学的词，也没有答错过的词。完成魔法任务后这里会列出今天该在生活里用一用的词。")}
    ${typeof weeklySection === "function" ? weeklySection() : ""}
    <div class="sec"><h3>学习进度</h3>
      ${pline("已学 / 总词数", s.planted + " / " + s.total)}
      ${pline("已长成苹果树 🍎", s.mastered + " 个")}
      ${pline("已记录作答", SRS.log.length + " 次")}
      ${storyList().length ? pline("听故事排顺序", "完成 " + storyDone + " 次") : ""}
      <div class="line"><span>${STAGES.map((g, i) => g + s.byStage[i]).join("　")}</span></div>
    </div>
    <div class="sec"><h3>最近 30 天打卡</h3><div class="note" style="margin-top:0">最近 30 天里打卡了 <b>${histN}</b> 天</div><div class="hist">${hist}</div></div>
    <div class="sec"><details data-keep="deep"${keepOpen("deep")}>
      <summary>📊 详细分析（未来 7 天、遗忘情况、遗忘曲线、容易忘的词、复习规则）</summary>
      <div class="sec"><h3>未来 7 天要复习</h3>${upcoming}</div>
      <div class="sec"><h3>遗忘情况</h3>
        ${pline("隔天复习测试", rc + " 次")}
        ${pline("其中答错（遗忘）", fg + " 次 · " + rate)}
        ${rc < 10 ? `<div class="note">测试次数还少，先别下结论。</div>` : ""}
        <div class="note">只有“之前确实学会过、隔了至少一天、第一次就点错”才算遗忘。分析仅供参考。</div>
      </div>
      ${curveSection()}
      <div class="sec"><h3>最容易忘的词</h3>${weakHtml}</div>
      <div class="sec"><h3>还没学会的词</h3>${learningHtml}</div>
      <div class="sec"><h3>复习规则</h3>
        <div class="note">学会后在第 1、2、4、7、15 天各复习一次。新词要在同一天连续两次第一次就点对，而且没有犹豫太久（听完后 9 秒内），才算学会、小树长大；犹豫的算不稳，不升级；点错会降级，明天再练。词长到 🌿 以后改成 4 选 1，到 🪴 以后有句子的词改听整句，复习题会随机换一个英文声音。答错的词隔几题后会再考一次（只算练习，不影响复习日程和统计）；连点错 2 次会把正确的图亮出来带孩子读。每天新词数和语速可在“设置”页调整。</div>
      </div>
    </details></div>`;
}

function settingsTab(){
  const cfg = normCfg(SRS.cfg);
  const rv = v => Math.round(v * 10), rl = v => "×" + v.toFixed(1);
  // 一组录音时长滑动条（最短、最长），key 形如 recWordMin / recSenMax
  const recBlock = (K, label, pair, lim) => `
      <div class="note" style="margin-top:10px"><b>${label}</b>　最短 <b id="v-rec${K}Min">${pair[0]}</b> 秒　最长 <b id="v-rec${K}Max">${pair[1]}</b> 秒</div>
      <div class="note" style="margin:4px 0 0">最短</div>
      <input type="range" class="rng" id="sl-rec${K}Min" min="${lim.lo}" max="${lim.hi}" step="1" value="${pair[0]}" data-set="rec${K}Min">
      <div class="note" style="margin:4px 0 0">最长</div>
      <input type="range" class="rng" id="sl-rec${K}Max" min="${lim.lo}" max="${lim.hi}" step="1" value="${pair[1]}" data-set="rec${K}Max">
      <div class="rngrow"><span>${lim.lo} 秒</span><span>${lim.hi} 秒</span></div>`;
  const tg = (k, v, label, on) => `<button class="small-btn${on ? " on" : " ghost"}" data-act="p-set" data-k="${k}" data-v="${v}">${label}</button>`;
  return `
    <div class="sec"><h3>学习节奏</h3>
      <div class="note" style="margin-top:0">一键选一档，不用逐项调。想细调的话，在下面的“高级设置”里改。</div>
      <div id="presets">${presetHtml(cfg)}</div>
    </div>
    <div class="sec"><h3>语速</h3>
      <div class="note" style="margin-top:0">提示语速：中文提示、夸奖（“听一听，找一找”等）。<b id="v-promptRate">${rl(cfg.promptRate)}</b></div>
      <input type="range" class="rng" min="${rv(RATE_MIN)}" max="${rv(RATE_MAX)}" step="1" value="${rv(cfg.promptRate)}" data-set="promptRate">
      <div class="rngrow"><span>×${RATE_MIN.toFixed(1)} 慢</span><span>×${RATE_MAX.toFixed(1)} 快</span></div>
      <div class="note" style="margin-top:10px">英语播放语速：英文单词和句子。<b id="v-enRate">${rl(cfg.enRate)}</b></div>
      <input type="range" class="rng" min="${rv(RATE_MIN)}" max="${rv(RATE_MAX)}" step="1" value="${rv(cfg.enRate)}" data-set="enRate">
      <div class="rngrow"><span>×${RATE_MIN.toFixed(1)} 慢</span><span>×${RATE_MAX.toFixed(1)} 快</span></div>
      <button class="small-btn" data-act="p-try-prompt">🔊 试听提示</button>
      <button class="small-btn" data-act="p-try-en">🔊 试听英语</button>
      <div class="note" style="margin-top:6px">×1.0 是原速（英语本来就已经放慢了一点）。超过 ×1.5 或低于 ×0.7 时声音可能有点变调。个别手机浏览器（比如部分安卓微信）可能不支持变速，听起来没变化时请用系统浏览器打开。</div>
    </div>
    <div class="sec"><details data-keep="adv"${keepOpen("adv")}>
      <summary>⚙️ 高级设置（学习方式、每天新词数、跟读录音时长）</summary>
      <h4>学习方式</h4>
      <div class="note"><b>中文翻译</b>：“只在新词页”是认识新词时才告诉孩子中文，答题时只听英文（每组只在前 2 题用中文提示），英语输入更多，推荐。“总是播放”是每题都带中文提示和翻译，适合刚接触英语的孩子。</div>
      ${tg("zh", "new", "只在新词页", cfg.zh === "new")}${tg("zh", "all", "总是播放", cfg.zh === "all")}
      <div class="note" style="margin-top:12px"><b>说一说</b>：偶尔（约一半的任务）挑一个已经很熟的词（🌳 以上），只给图、让孩子用英语说，由家长点“说对了”或“没说出来”。说对算一次复习答对；没说出来不扣分，会带读并补考一道选择题。</div>
      ${tg("say", "1", "开", cfg.say)}${tg("say", "0", "关", !cfg.say)}
      <div class="note" style="margin-top:12px"><b>动一动</b>：每组任务最后，按 1–2 个词播英语指令（如 “Show me a dancer!”），让孩子做动作，家长点“做完啦”。不计分、不影响复习日程。</div>
      ${tg("act", "1", "开", cfg.act)}${tg("act", "0", "关", !cfg.act)}
      <h4>每天新词数</h4>
      <div class="note">每天最多学 <b id="v-new">${cfg.newPerDay}</b> 个新词（可设 ${NEW_MIN}～${NEW_MAX}）。每个新词先教一遍，当天再考 2 次，所以新词约占 <b id="v-newq">${cfg.newPerDay * 2}</b> 题；再加上当天到期的复习题（每组最多 ${MAX_DUE} 个旧词），不足 ${MIN_Q} 题时用已学过的词补满。孩子觉得太简单就调多，注意力不够就调少。当天已学的新词达到上限后，“再练一组”只会复习。</div>
      <input type="range" class="rng" min="${NEW_MIN}" max="${NEW_MAX}" step="1" value="${cfg.newPerDay}" data-set="newPerDay">
      <div class="rngrow"><span>${NEW_MIN}</span><span>${NEW_MAX}</span></div>
      <h4>跟读录音时长</h4>
      <div class="note">点“跟读”后录多久，<b>单词</b>和<b>句子</b>可以分别设。“最短”：录满这个时间后，孩子才能点“✋ 说完了”提前结束；“最长”：到时间自动停止。超过 5 岁的孩子或句子较长时可以调长一些。</div>
      ${recBlock("Word", "单词", cfg.recWord, REC_KINDS.word)}
      ${recBlock("Sen", "句子", cfg.recSen, REC_KINDS.sen)}
      <div class="note" style="margin-top:10px">说明：有语音识别的浏览器（如 iPhone Safari）说完就会自动结束，“最长”是上限，“最短”不起作用；只能录音回放的浏览器（如微信）两个值都起作用。</div>
    </details></div>`;
}

function parentPage(tab){
  if(PARENT_TABS.some(t => t[0] === tab)) parentTab = tab;
  session++; token++; try{ player.pause(); }catch(e){}
  parentUntil = Date.now() + PARENT_OPEN_MS;
  const body = parentTab === "set" ? settingsTab()
    : parentTab === "acct" ? (typeof accountSection === "function" ? accountSection() : "")
    : overviewTab();
  app.innerHTML = `
    <div class="top"><button class="back" data-act="p-back">← 返回</button><span></span></div>
    <h2>👨‍👩‍👧 家长页</h2>
    <div class="ptabs">${PARENT_TABS.map(([k, n]) => `<button class="${k === parentTab ? "on" : ""}" data-act="p-tab" data-t="${k}">${n}</button>`).join("")}</div>
    ${body}`;
  if(typeof afterParentRender === "function") afterParentRender();
}
// 重画当前页签，并回到原来的滚动位置
function parentRefresh(){
  const y = (typeof window !== "undefined" && window.scrollY) || 0;
  parentPage();
  try{ window.scrollTo(0, y); }catch(err){}
}

/* ---------- 事件 ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if(!t) return;
  switch(t.dataset.act){
    case "parent":   openParent(t.dataset.t); break;
    case "p-gate":   gateSubmit(); break;
    case "p-back":   parentUntil = 0; home(); break;
    case "p-tab":
      parentPage(t.dataset.t);
      try{ window.scrollTo(0, 0); }catch(err){}
      break;
    case "p-set": {
      const k = t.dataset.k, v = t.dataset.v, c = normCfg(SRS.cfg);
      if(k === "zh") c.zh = v === "all" ? "all" : "new";
      else if(k === "say" || k === "act") c[k] = v === "1";
      else break;
      SRS.cfg = c; saveSRS();
      parentRefresh();
      break;
    }
    case "p-preset": {
      const p = PRESETS.find(x => x.id === t.dataset.v);
      if(!p) break;
      const c = normCfg(SRS.cfg);
      c.newPerDay = p.newPerDay; c.zh = p.zh; c.say = p.say; c.act = p.act;
      SRS.cfg = c; saveSRS();
      parentRefresh();
      break;
    }
    case "p-try-prompt": playSeq([fx("fx_find_zh"), fx("fx_good_zh")]); break;
    case "p-try-en": {
      const it = questPool().find(p => p.sen) || questPool()[0];
      playSeq([enClip(it), ...(it.sen ? [senClip(it)] : [])]);
      break;
    }
    case "p-reset":
      if(confirm("确定清空所有学习进度吗？此操作不能撤销。学习方式、每天新词数、语速等设置会保留。")){
        const keep = normCfg(SRS.cfg);
        SRS = freshSRS(); SRS.cfg = keep; SRS.cfgAt = SRS.resetAt = Date.now(); saveSRS(); parentPage();
      }
      break;
  }
});

// 折叠区展开 / 收起时记下来（toggle 事件不冒泡，所以要在捕获阶段监听）
document.addEventListener("toggle", e => {
  const el = e.target;
  if(el && el.dataset && el.dataset.keep) parentOpen[el.dataset.keep] = !!el.open;
}, true);
document.addEventListener("keydown", e => {
  if(e && e.key === "Enter" && e.target && e.target.id === "gate") gateSubmit();
});

// 家长页的滑动条：拖动时实时保存并更新数字，语速条松手后试听一句
function applySetting(key, raw){
  const cfg = normCfg(SRS.cfg);
  const rm = /^rec(Word|Sen)(Min|Max)$/.exec(key);
  if(rm){
    const f = "rec" + rm[1], kind = rm[1] === "Word" ? "word" : "sen", lim = REC_KINDS[kind], i = rm[2] === "Min" ? 0 : 1;
    const v = Math.round(+raw);
    if(!isFinite(v)) return null;
    const p = cfg[f].slice();
    p[i] = Math.min(lim.hi, Math.max(lim.lo, v));
    if(i === 0 && p[0] > p[1]) p[1] = p[0];          // 最短拉到超过最长：最长跟着往后移
    if(i === 1 && p[1] < p[0]) p[0] = p[1];          // 最长拉到低于最短：最短跟着往前移
    cfg[f] = p; SRS.cfg = cfg; saveSRS();
    [["Min", 0], ["Max", 1]].forEach(([n, j]) => {
      const lab = document.getElementById("v-" + f + n); if(lab) lab.textContent = p[j];
      const sl = document.getElementById("sl-" + f + n); if(sl && String(sl.value) !== String(p[j])) sl.value = p[j];
    });
    return cfg;
  }
  if(key === "newPerDay") cfg.newPerDay = Math.round(clampNum(raw, NEW_MIN, NEW_MAX, NEW_DEFAULT));
  else if(key === "enRate" || key === "promptRate") cfg[key] = Math.round(clampNum(raw / 10, RATE_MIN, RATE_MAX, 1) * 10) / 10;
  else return null;
  SRS.cfg = cfg; saveSRS();
  const set = (id, text) => { const e = document.getElementById(id); if(e) e.textContent = text; };
  if(key === "newPerDay"){ set("v-new", cfg.newPerDay); set("v-newq", cfg.newPerDay * 2); refreshPresets(); }
  else set("v-" + key, "×" + cfg[key].toFixed(1));
  return cfg;
}
document.addEventListener("input", e => {
  const el = e.target;
  if(el && el.dataset && el.dataset.set) applySetting(el.dataset.set, el.value);
});
document.addEventListener("change", e => {
  const el = e.target;
  if(!el || !el.dataset || !el.dataset.set || el.dataset.set === "newPerDay" || /^rec/.test(el.dataset.set)) return;
  applySetting(el.dataset.set, el.value);
  const t = el.dataset.set === "enRate" ? "p-try-en" : "p-try-prompt";
  const btn = document.querySelector(`[data-act="${t}"]`);
  if(btn) btn.click();
});
