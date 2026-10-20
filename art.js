/* 统一风格的原创简笔画（内联 SVG，原创绘制，无外部素材）。
   画法：粗深棕色轮廓 + 平涂色块，100×100 画布。
   所有人物共用同一个“大头小朋友”模板（kid），只靠服装和道具区分职业，不靠性别；
   也因为是矢量图，在任何手机上长得都一样（emoji 在不同系统里差别很大）。
   本文件在 data.js 之后加载：把 LESSONS 里每个词/句子的 emoji 换成对应的 SVG，
   找不到对应图时保留原来的 emoji，所以单独缺这个文件也不会坏。 */
const ART = (function(){
  const INK = "#4e342e", SKIN = "#ffe0b2";
  const RED = "#e53935", BLUE = "#1e88e5", YEL = "#fdd835", GRN = "#43a047", ORG = "#fb8c00",
        GRY = "#b0bec5", WHT = "#ffffff", BRN = "#8d6e63", SKY = "#29b6f6";
  const NS = 'stroke="none"';
  const n = v => Math.round(v * 10) / 10;
  const at = x => x ? " " + x : "";
  const path = (d, fill, ex) => `<path d="${d}" fill="${fill || "none"}"${at(ex)}/>`;
  const circ = (x, y, r, fill, ex) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill || "none"}"${at(ex)}/>`;
  const rect = (x, y, w, h, rx, fill, ex) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill || "none"}"${at(ex)}/>`;
  const ell = (x, y, rx, ry, fill, ex) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill || "none"}"${at(ex)}/>`;
  const line = (d, col, w) => path(d, "none", `stroke="${col || INK}" stroke-width="${w || 3}"`);
  // 带轮廓的粗线（胳膊、腿、水管）：先画深色粗线，再在上面画一条细一点的彩色线
  const tube = (d, col, w) => path(d, "none", `stroke="${INK}" stroke-width="${w + 5}"`) + path(d, "none", `stroke="${col}" stroke-width="${w}"`);
  const limb = (x1, y1, x2, y2, col) => tube(`M${x1} ${y1}L${x2} ${y2}`, col, 5);
  const star = (cx, cy, r, fill) => {
    const k = .3 * r, P = (x, y) => `${n(x)} ${n(y)}`;
    return path(`M${P(cx, cy - r)}L${P(cx + k, cy - k)}L${P(cx + r, cy)}L${P(cx + k, cy + k)}L${P(cx, cy + r)}L${P(cx - k, cy + k)}L${P(cx - r, cy)}L${P(cx - k, cy - k)}Z`, fill, 'stroke-width="2"');
  };
  const gear = (cx, cy, r, fill) => {
    const ri = r * .78, pts = [];
    for(let k = 0; k < 8; k++){
      [[-15, ri], [-9, r], [9, r], [15, ri]].forEach(([da, rr]) => {
        const t = (k * 45 + da) * Math.PI / 180;
        pts.push(`${n(cx + rr * Math.cos(t))} ${n(cy + rr * Math.sin(t))}`);
      });
    }
    return path("M" + pts.join("L") + "Z", fill, 'stroke-width="2.5"') + circ(cx, cy, n(r * .36), "none", 'stroke-width="2.5"');
  };

  /* 大头小朋友模板：头 (50,27) 半径 15，身体 x36–64、y43–70，腿到 y≈89。
     back / front：画在人物后面 / 前面的道具；hat、hair：头上的东西；
     armL / armR / legL / legR：自定义 [x1,y1,x2,y2]；torso：替换默认身体。 */
  function kid(o){
    const d = Object.assign({body: "#42a5f5", legs: "#5c6bc0", sleeve: null, arms: "down", mouth: "smile", back: "", front: "", hat: "", hair: "",
      torso: null, noLegs: false, noArms: false, legL: null, legR: null, armL: null, armR: null, glasses: false, skin: SKIN}, o);
    const AR = {down: [[37, 48, 29, 65], [63, 48, 71, 65]], up: [[37, 48, 25, 31], [63, 48, 75, 31]], out: [[37, 48, 21, 53], [63, 48, 79, 53]]}[d.arms];
    const aL = d.armL || AR[0], aR = d.armR || AR[1], lL = d.legL || [44, 69, 44, 89], lR = d.legR || [56, 69, 56, 89];
    let s = d.back;
    if(!d.noLegs) [lL, lR].forEach(l => { s += limb(l[0], l[1], l[2], l[3], d.legs) + ell(l[2], l[3] + 3, 6, 3.2, "#6d4c41", 'stroke-width="2"'); });
    s += d.torso || rect(36, 43, 28, 27, 8, d.body);
    if(!d.noArms) [aL, aR].forEach(a => { s += limb(a[0], a[1], a[2], a[3], d.sleeve || d.body) + circ(a[2], a[3], 4, d.skin, 'stroke-width="2.5"'); });
    s += circ(50, 27, 15, d.skin) + circ(41, 31, 2.4, "#ffab91", NS) + circ(59, 31, 2.4, "#ffab91", NS) +
         circ(45, 26, 1.8, INK, NS) + circ(55, 26, 1.8, INK, NS);
    s += d.mouth === "open" ? path("M45 31Q50 42 55 31Z", RED, 'stroke-width="2.5"') : path("M45 32Q50 37 55 32", "none", 'stroke-width="2.5"');
    if(d.glasses) s += circ(45, 26, 5.4, "none", 'stroke-width="2.2"') + circ(55, 26, 5.4, "none", 'stroke-width="2.2"');
    return s + d.hair + d.hat + d.front;
  }
  const dome = (fill, brim) => path("M34 19Q34 4 50 4Q66 4 66 19Z", fill) + rect(30, 17, 40, 5, 2.5, brim || fill);
  const steth = () => path("M42 45Q40 60 50 60Q60 60 58 45", "none", 'stroke-width="2.5"') + circ(50, 62, 3.5, GRY, 'stroke-width="2.2"');
  const kitCross = (x, y) => rect(x + 2.4, y, 2.4, 7, 0, RED, NS) + rect(x, y + 2.3, 7, 2.4, 0, RED, NS);
  const bell = () => path("M50 14C36 14 31 28 31 44C31 58 25 62 22 70H78C75 62 69 58 69 44C69 28 64 14 50 14Z", YEL) +
    circ(50, 12, 4, "#f9a825") + circ(50, 78, 6, "#f9a825") + line("M40 28Q38 38 38 48", "#fff59d", 3);
  const win = (x, y, w, h) => rect(x, y, w, h, 2, "#fff59d", 'stroke-width="2.5"');

  const I = {};

  /* ---------- 第一单元：消防 ---------- */
  I.fire_station = rect(14, 38, 72, 54, 3, RED) + rect(10, 32, 80, 8, 2, "#b71c1c") + rect(40, 12, 20, 22, 2, "#ef5350") +
    path("M35 14L50 3L65 14Z", "#b71c1c") + circ(50, 23, 6.5, WHT, 'stroke-width="2.5"') + line("M50 23V19.5M50 23L53 24.5", INK, 2) +
    rect(18, 46, 9, 9, 2, "#b3e5fc", 'stroke-width="2.5"') + rect(73, 46, 9, 9, 2, "#b3e5fc", 'stroke-width="2.5"') +
    rect(30, 58, 40, 34, 2, WHT) + line("M30 66H70M30 74H70M30 82H70", INK, 2);

  I.alarm_bell = bell() + line("M16 36Q10 46 16 56", RED, 3.5) + line("M84 36Q90 46 84 56", RED, 3.5);

  I.firefighter = kid({body: RED, legs: "#37474f", hat: dome(RED, "#c62828") + circ(50, 11, 3.2, YEL, 'stroke-width="2"'),
    front: rect(37, 57, 26, 4, 0, YEL, NS)});

  I.hose = circ(34, 56, 24, RED) + circ(34, 56, 16, "#ef9a9a") + circ(34, 56, 8, RED) + circ(34, 56, 3, WHT) +
    tube("M54 72Q82 86 84 60L84 40", RED, 5) + rect(75, 26, 18, 14, 3, YEL) + rect(77, 20, 14, 7, 2, ORG) +
    line("M80 16L76 6M84 16V4M88 16L92 6", SKY, 3.5);

  // 救生圈里探出一个被救起来的小朋友
  I.save = circ(50, 50, 38, WHT, NS) +
    `<circle cx="50" cy="50" r="29" fill="none" stroke="${RED}" stroke-width="18" stroke-dasharray="22.78 22.78" transform="rotate(-11 50 50)"/>` +
    circ(50, 50, 38, "none") + circ(50, 50, 20, "none") +
    circ(50, 51, 13, SKIN) + circ(46, 49.5, 1.6, INK, NS) + circ(54, 49.5, 1.6, INK, NS) + path("M46 54.5Q50 58 54 54.5", "none", 'stroke-width="2.2"') +
    line("M6 93Q15 87 24 93T42 93T60 93T78 93T94 93", SKY, 3.5);

  I.cheer = kid({body: "#ff8a65", legs: "#5c6bc0", arms: "up", mouth: "open",
    back: circ(14, 16, 3, RED, NS) + circ(86, 14, 3, BLUE, NS) + circ(8, 44, 2.5, GRN, NS) + circ(92, 46, 2.5, "#ab47bc", NS) +
      star(20, 9, 4, YEL) + star(80, 9, 4, ORG) + line("M12 28L18 31", ORG, 3) + line("M88 30L82 33", RED, 3)});

  I.pole = rect(6, 10, 34, 8, 2, BRN) + rect(60, 10, 34, 8, 2, BRN) + rect(6, 84, 88, 8, 2, BRN) + rect(44, 4, 12, 86, 6, YEL) +
    path("M12 82Q12 68 26 68Q40 68 40 82Z", RED) + rect(9, 80, 34, 5, 2.5, "#c62828") +
    line("M70 36L78 46L86 36", ORG, 4) + line("M70 52L78 62L86 52", ORG, 4);

  // 故事三句：警报铃响了 → 到达大楼 → 火被扑灭了
  I.s_alarm = `<g transform="translate(2 22) scale(.72)">` + bell() + `</g>` +
    line("M10 50Q5 60 10 70", RED, 3.5) + line("M72 52Q77 60 72 68", RED, 3.5) +
    rect(62, 16, 30, 7, 2, "#455a64") + path("M65 16Q65 6 77 6Q89 6 89 16Z", RED) +
    line("M60 12L56 8M94 12L97 8M77 4V3", ORG, 3) +
    rect(78, 28, 14, 14, 3, RED) + line("M85 31.5V37", WHT, 2.5) + circ(85, 40, 1.4, WHT, NS);

  I.s_reach = rect(54, 12, 38, 66, 3, "#90a4ae") +
    win(60, 18, 10, 10) + win(76, 18, 10, 10) + win(60, 34, 10, 10) + win(76, 34, 10, 10) + win(60, 50, 10, 10) + win(76, 50, 10, 10) +
    line("M4 88H96", INK, 2.5) +
    // 消防车：车厢 + 驾驶室 + 梯子 + 警灯 + 轮子
    line("M10 42H48M10 46H48M15 42V46M22 42V46M29 42V46M36 42V46M43 42V46", "#78909c", 2.5) +
    rect(6, 50, 46, 26, 3, RED) + path("M52 56H65L74 66V76H52Z", "#ef5350") + path("M56 59H64L69 66H56Z", "#b3e5fc", 'stroke-width="2.5"') +
    circ(60, 52, 3.2, YEL, 'stroke-width="2"') +
    circ(22, 78, 8, "#455a64") + circ(22, 78, 3, WHT, NS) + circ(62, 78, 8, "#455a64") + circ(62, 78, 3, WHT, NS);

  I.s_out = ell(50, 90, 38, 4.5, "#b3e5fc", 'stroke-width="2"') +
    rect(40, 28, 50, 58, 3, "#90a4ae") + win(48, 36, 12, 12) + win(70, 36, 12, 12) + win(48, 54, 12, 12) + win(70, 54, 12, 12) +
    rect(58, 70, 14, 16, 2, BRN) +
    rect(3, 58, 14, 10, 2, YEL) + line("M17 60Q30 30 48 38", SKY, 4) +
    circ(26, 62, 2.2, SKY, NS) + circ(33, 68, 2.2, SKY, NS) + circ(21, 72, 2, SKY, NS) +
    circ(80, 20, 12, GRN) + line("M73.5 20L78.5 25L87 15", WHT, 3.5);

  /* ---------- 第二单元：我长大想当… ---------- */
  I.grow_up = line("M6 88H94", BRN, 3) + line("M24 88V62", GRN, 4) +
    path("M24 72Q11 72 9 59Q22 59 24 72Z", GRN) + path("M24 66Q37 66 39 53Q26 53 24 66Z", GRN) +
    line("M44 72H62M56 65L63 72L56 79", ORG, 4) +
    rect(75, 56, 10, 32, 3, "#a1887f") + circ(80, 41, 16, GRN) + circ(74, 38, 3, RED, NS) + circ(86, 44, 3, RED, NS) + circ(80, 32, 3, RED, NS);

  I.job = rect(12, 34, 76, 48, 9, BRN) + path("M38 34V26Q38 20 44 20H56Q62 20 62 26V34", "none") +
    line("M12 56H88", INK, 2.5) + rect(43, 50, 14, 12, 3, YEL);

  I.teacher = kid({body: "#66bb6a", legs: "#455a64", glasses: true, armR: [63, 48, 72, 57],
    back: rect(66, 12, 30, 26, 3, "#2e7d32") + line("M71 33L75 18L79 33M72.5 28H77.5", WHT, 2.2) + line("M84 22H91M84 28H91", WHT, 2.2),
    front: line("M72 57L81 40", BRN, 2.5)});

  I.vet = kid({body: "#4db6ac", legs: "#37474f", armR: [63, 48, 75, 64],
    front: steth() +
      ell(69.5, 73, 4, 7.5, "#8d6e63") + ell(90.5, 73, 4, 7.5, "#8d6e63") + circ(80, 77, 11, "#ffcc80") +
      circ(76.5, 75, 1.6, INK, NS) + circ(83.5, 75, 1.6, INK, NS) + circ(80, 80, 2.6, INK, NS) +
      line("M80 82.5V84M80 84Q77 87 75 85M80 84Q83 87 85 85", INK, 2)});

  I.mechanic = kid({body: BLUE, legs: "#455a64",
    hat: path("M34 19Q34 4 50 4Q66 4 66 19Z", ORG) + path("M60 17Q79 15 82 22H60Z", "#ef6c00"),
    back: gear(20, 22, 12, GRY),
    front: rect(43, 55, 14, 11, 2, "#1565c0", 'stroke-width="2.5"')});

  I.builder = kid({body: ORG, legs: "#5d4037", armR: [63, 48, 76, 62], hat: dome(YEL, "#fbc02d") + line("M50 4V17", INK, 2.5),
    back: tube("M78 34V72", "#a1887f", 5) + rect(66, 24, 24, 10, 2, "#90a4ae"),
    front: rect(37, 57, 26, 4, 0, YEL, NS)});

  I.footballer = kid({body: YEL, legs: SKIN, arms: "out", legR: [56, 69, 68, 82],
    front: rect(37, 66, 26, 9, 3, BLUE) + rect(48, 46, 4, 20, 0, BLUE, NS) +
      circ(80, 86, 9, WHT) + path("M80 82.4L83.4 84.9L82.1 88.9L77.9 88.9L76.6 84.9Z", INK, 'stroke-width="1.5"') +
      line("M80 82.4V77.5M83.4 84.9L87.5 83.5M76.6 84.9L72.5 83.5", INK, 1.8)});

  I.musician = kid({body: "#ab47bc", legs: "#37474f", armR: [63, 48, 70, 60],
    hat: path("M33 19Q34 7 52 7Q67 8 67 19Q50 14 33 19Z", "#7e57c2") + circ(53, 6, 2.5, "#7e57c2"),
    back: circ(14, 32, 4.2, INK, NS) + line("M18 32V12", INK, 2.5) + line("M18 12Q27 14 25 22", INK, 2.5) +
      circ(8, 62, 3.5, INK, NS) + line("M11.5 62V47", INK, 2.2) + line("M11.5 47Q19 49 17 55", INK, 2.2) +
      rect(72, 14, 4, 22, 1.5, "#5d4037") + circ(74, 12, 3.5, "#5d4037") +
      path("M74 36C66 36 64 44 68 50C62 54 62 66 68 72C70 78 78 78 80 72C86 66 86 54 80 50C84 44 82 36 74 36Z", "#ff8a65") +
      line("M70 66H78", INK, 2) + line("M69.5 56Q68.5 60 69.5 63M78.5 56Q79.5 60 78.5 63", INK, 1.8) +
      line("M56 88L92 60", BRN, 2.5)});

  I.dancer = kid({legs: SKIN, sleeve: SKIN, armL: [40, 47, 20, 34], armR: [60, 47, 80, 34], legL: [44, 74, 44, 90], legR: [56, 74, 70, 82],
    torso: rect(40, 43, 20, 14, 5, "#f06292") + path("M40 54L28 75Q50 81 72 75L60 54Z", "#f48fb1"),
    hair: path("M35 22Q35 9 50 9Q65 9 65 22Q58 15 50 15Q42 15 35 22Z", "#6d4c41") + circ(50, 9, 4.5, "#6d4c41"),
    back: star(12, 18, 6, YEL) + star(88, 62, 5, YEL) + star(10, 70, 4, "#ff8a80")});

  I.hairdresser = kid({body: "#7986cb", legs: "#37474f", armR: [63, 48, 75, 66],
    hair: circ(38, 15, 7.5, "#ffb74d") + circ(50, 12.5, 8.5, "#ffb74d") + circ(62, 15, 7.5, "#ffb74d"),
    back: rect(12, 66, 24, 7, 2, "#ba68c8") + line("M15 73V78M19 73V78M23 73V78M27 73V78M31 73V78", INK, 2) +
      tube("M74 69L88 24", GRY, 3) + tube("M84 69L70 24", GRY, 3) +
      circ(72, 76, 6, "none", `stroke="${RED}" stroke-width="3.5"`) + circ(86, 76, 6, "none", `stroke="${RED}" stroke-width="3.5"`)});

  I.doctor = kid({body: WHT, legs: "#5c6bc0",
    hat: line("M35 20Q50 14 65 20", INK, 3) + circ(50, 11, 6.5, GRY, 'stroke-width="2.5"') + circ(50, 11, 2.2, "none", 'stroke-width="2"'),
    front: steth() + kitCross(54, 51)});

  I.nurse = kid({body: "#80deea", legs: "#5c6bc0", armR: [63, 48, 74, 64],
    hat: rect(36, 6, 28, 14, 4, WHT) + rect(48.5, 8.5, 3, 9, 0, RED, NS) + rect(45.5, 11.5, 9, 3, 0, RED, NS),
    front: path("M72 66V62H84V66", "none", 'stroke-width="2.5"') + rect(64, 66, 28, 22, 4, WHT) + kitCross(74, 70)});

  I.programmer = kid({body: "#455a64", torso: rect(30, 43, 40, 22, 9, "#455a64"), noLegs: true, noArms: true,
    hat: line("M33 26Q33 7 50 7Q67 7 67 26", INK, 3.5) + rect(28.5, 22, 8, 14, 3.5, RED) + rect(63.5, 22, 8, 14, 3.5, RED),
    front: rect(22, 54, 56, 28, 3, "#37474f") + line("M30 62L37 69L30 76", "#69f0ae", 3) + line("M42 76H58", "#69f0ae", 3) + line("M62 62H70", "#ffd54f", 3) +
      path("M14 85H86L80 92H20Z", GRY)});

  I.astronaut = kid({body: "#eceff1", legs: "#eceff1", armR: [63, 48, 77, 32],
    back: rect(30, 45, 40, 26, 5, GRY) + circ(16, 22, 7, "#ffb74d") + ell(16, 22, 12, 3.5, "none", 'transform="rotate(-20 16 22)"') +
      star(86, 16, 6, YEL) + star(90, 56, 4, YEL),
    front: circ(50, 27, 19, "#b3e5fc", 'fill-opacity=".5"') + line("M38 17Q41 12 47 11", WHT, 2.5) +
      rect(37, 43, 26, 5, 2.5, GRY) + rect(44, 54, 12, 8, 2, RED, 'stroke-width="2"')});

  const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" role="img">${body}</svg>`;
  const out = {};
  Object.keys(I).forEach(k => { out[k] = wrap(I[k]); });
  return out;
})();

// 同一个词出现在两个单元里（id 不同）时共用一张图
const ART_ALIAS = {firefighter2: "firefighter"};
const artFor = id => ART[ART_ALIAS[id] || id] || null;
(function applyArt(){
  if(typeof LESSONS === "undefined") return;
  LESSONS.forEach(l => l.items.forEach(it => { const svg = artFor(it.id); if(svg) it.emoji = svg; }));
})();
