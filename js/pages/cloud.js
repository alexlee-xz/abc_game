/* ============ 云同步页面：家长页“账户与备份”里的☁️云同步区、欢迎页的“用同步码加入”、加入链接确认页 ============
   数据和同步逻辑在 core/sync.js；这里只画页面、处理点击。依赖 account.js（accWhere、copyFrom、escName、clearHash…）和 parent.js。 */

const cloudUrlInput = () => SYNC_URL ? "" :
  `<div class="note">云服务地址（部署 Cloudflare Worker 后得到的网址）：</div>
   <input id="cu" class="nm" type="url" placeholder="https://abc-sync.xxx.workers.dev" value="${escName(SYNC.url)}" autocomplete="off" autocapitalize="off" spellcheck="false">`;
const cloudCodeInput = () =>
  `<input id="cc" class="nm" type="text" placeholder="同步码，或粘贴“加入链接”" autocomplete="off" autocapitalize="characters" spellcheck="false">`;

function cloudSection(){
  if(!syncOn()){
    return `<div class="sec"><h3>☁️ 云同步</h3>
      <div class="note" style="margin-top:0">开启后，同一个家庭的几台手机 / 平板会<b>自动同步</b>学习记录：孩子答题后几秒内上传，打开页面时自动更新；没网也能照常玩，网络恢复后自动补传。用“同步码”识别家庭，不需要注册账号。</div>
      ${cloudUrlInput()}
      <button class="small-btn" data-act="c-create">开启云同步（新建家庭）</button>
      <details data-keep="cjoin"${keepOpen("cjoin")} style="margin-top:10px">
        <summary class="note" style="cursor:pointer">已经在别的设备开启了？用同步码加入</summary>
        ${cloudCodeInput()}
        <button class="small-btn" data-act="c-join">加入</button>
      </details>
    </div>`;
  }
  return `<div class="sec"><h3>☁️ 云同步</h3>
      <div class="note" id="syncst" style="margin-top:0">${escName(syncStatusText())}</div>
      <div class="note">同步码：<b style="letter-spacing:1px">${fmtCode(SYNC.code)}</b><br>知道同步码的人能看到并修改这个家庭的学习记录，请只发给家人。</div>
      <button class="small-btn" data-act="c-now">🔄 立即同步</button>
      <button class="small-btn" data-act="c-link">🔗 复制加入链接</button>
      <textarea id="cl" readonly placeholder="点“复制加入链接”后显示在这里。发到另一台设备打开，就能加入"></textarea>
      <div class="note">在另一台设备上：打开游戏，家长页 → 账户与备份 → 用同步码加入（或直接打开上面的加入链接）。每台设备最多 ${PROF_MAX} 个小朋友，开启后会一起同步。</div>
      <details data-keep="cdanger"${keepOpen("cdanger")} style="margin-top:8px">
        <summary>⚠️ 退出 / 删除云端数据</summary>
        <div><button class="small-btn ghost" data-act="c-leave">在这台设备上退出云同步</button></div>
        <div><button class="small-btn ghost" data-act="c-wipe">删除云端全部数据</button></div>
        <div class="note warn">删除云端数据后，其他还开着云同步的设备会把各自的记录重新传上去，请先在那些设备上退出云同步。本机的学习记录不会被删。</div>
      </details>
    </div>`;
}
// 欢迎页（还没有小朋友账户）里的入口：新设备直接用同步码把记录拉下来
function cloudJoinBlock(){
  if(syncOn()) return "";
  return `<div class="sec" style="text-align:center"><details>
      <summary class="note" style="cursor:pointer">☁️ 家里其他设备开启了云同步？用同步码加入</summary>
      ${cloudUrlInput()}${cloudCodeInput()}
      <button class="small-btn" data-act="c-join">加入</button>
    </details></div>`;
}

/* ---------- 加入链接 ---------- */
let pendingSync = null;
function incomingSyncLink(){
  if(hashHandled) return null;
  let m = null;
  try{ m = typeof location !== "undefined" && /[#&]s=([A-Za-z0-9_-]+)/.exec(location.hash || ""); }catch(e){}
  if(!m) return null;
  const p = parseSyncInput("#s=" + m[1]);
  clearHash();
  if(!p){ alert("加入链接不完整（可能被截断了），请重新复制整条链接"); return null; }
  if(syncOn() && SYNC.code === p.code) return null;       // 已经加入过了
  return p;
}
function syncJoinPage(p){
  session++; token++; try{ player.pause(); }catch(e){}
  accWhere = "welcome"; pendingSync = p;
  app.innerHTML = `
    <h1>☁️ 加入云同步</h1>
    <div class="sec" style="text-align:center">
      <div class="note">加入后，这台设备上的学习记录会和云端<b>合并</b>（同名的小朋友会自动对上，不会丢记录），以后会自动同步。</div>
      ${syncOn() ? `<div class="note warn">这台设备现在已经在用另一个家庭的云同步，加入新的会替换掉它（本机的学习记录不受影响）。</div>` : ""}
      <button class="big green" data-act="c-hash-join">加入</button>
      <button class="big" data-act="c-hash-cancel">先不加入</button>
    </div>`;
  return true;
}

/* ---------- 动作 ---------- */
// 开启 / 加入之后：先同步一次，再回到合适的页面
async function cloudFinish(joined){
  const r = await syncNow();
  if(r.err) alert("已保存设置，但这次同步没成功：" + r.err + "\n网络好了会自动重试，记录先保存在本机。");
  else if(joined && !r.cloudKids) alert("已加入，但云端还没有这个家庭的记录。如果你是想把别的设备的记录同步过来，请检查同步码有没有输错。");
  if(accWhere === "welcome") boot(); else parentRefresh();
  return r;
}
function cloudUrlFrom(p){
  const el = document.getElementById("cu");
  return SYNC_URL || (p && p.url) || cleanUrl(el ? el.value : "") || SYNC.url;
}
// 开启 / 加入前先试一下能不能连上云服务；连不上就把原因和能做的事告诉家长（返回 true 表示通了）
async function cloudReachable(url){
  const r = await syncPing(url);
  if(r.ok) return true;
  alert(`连不上这个云服务地址：${r.why}。\n\n地址：${url}\n\n请先确认手机有网；再用这台设备的浏览器直接打开“${url}/api/ping”，如果也打不开，说明这个地址在当前网络下被屏蔽了（国内常见），换 Wi-Fi / 流量试试，或者给云服务绑一个自己的域名。`);
  return false;
}
async function cloudCreate(){
  const url = cloudUrlFrom();
  if(!url){ alert("请先填写云服务地址（以 https:// 开头）"); return null; }
  if(!(await cloudReachable(url))) return null;
  syncEnable(url, newSyncCode());
  return cloudFinish(false);
}
async function cloudJoin(){
  const el = document.getElementById("cc");
  const p = parseSyncInput(el ? el.value : "");
  if(!p){ alert("没有识别出同步码：应该是 20 位字母和数字（可以带横线），或者一整条加入链接"); return null; }
  const url = cloudUrlFrom(p);
  if(!url){ alert("请先填写云服务地址（以 https:// 开头）"); return null; }
  if(!(await cloudReachable(url))) return null;
  syncEnable(url, p.code);
  return cloudFinish(true);
}

// 每次同步结束：更新状态文字；当前小朋友的记录被别的设备更新了，就刷新正在看的页面
function onSyncDone(res){
  const st = document.getElementById("syncst");
  if(st) st.textContent = syncStatusText();
  if(!res || res.err || res.skip || res.busy) return;
  if(res.removed && !PROFS.list.length){ boot(); return; }
  if(!res.pulled && !res.removed && !res.changedCur) return;
  if(typeof document.querySelector !== "function") return;
  if(document.querySelector(".ptabs")){
    if(parentTab === "view") parentRefresh();
    else if(parentTab === "acct"){
      const bk = document.getElementById("bk"), cc = document.getElementById("cc");
      if(!(bk && bk.value) && !(cc && cc.value)) parentRefresh();
    }
  }else if(document.querySelector('[data-act="lesson"]')) home();
}

document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if(!t) return;
  switch(t.dataset.act){
    case "c-create": cloudCreate(); break;
    case "c-join":   cloudJoin(); break;
    case "c-now": {
      const st = document.getElementById("syncst");
      if(st) st.textContent = "🔄 正在同步…";
      syncNow();
      break;
    }
    case "c-link": {
      const lk = document.getElementById("cl");
      if(!lk) break;
      lk.value = syncLink();
      copyFrom("cl", "已复制加入链接。发到另一台设备（比如微信的“文件传输助手”），在那边打开就能加入。");
      break;
    }
    case "c-leave":
      if(confirm("在这台设备上退出云同步吗？本机的学习记录不受影响，云端的记录也还在，之后可以用同步码重新加入。")){ syncLeave(); parentRefresh(); }
      break;
    case "c-wipe":
      if(confirm("确定删除云端的全部学习记录吗？不能撤销。（本机的记录不会被删，但其他设备需要先退出云同步，否则会把记录重新传上去。）")){
        syncApi("DELETE", "/api/family").then(r => {
          if(!r.ok){ alert("删除失败：" + syncErr(r).message); return; }
          syncLeave(); alert("云端数据已删除，这台设备已退出云同步。"); parentRefresh();
        });
      }
      break;
    case "c-hash-join": {
      const p = pendingSync;
      if(!p) break;
      const url = SYNC_URL || p.url || SYNC.url;
      if(!url){ alert("这条链接里没有云服务地址，请到家长页 → 账户与备份里，填上地址后用同步码加入"); boot(); break; }
      pendingSync = null;
      syncEnable(url, p.code);
      cloudFinish(true);
      break;
    }
    case "c-hash-cancel": pendingSync = null; boot(); break;
  }
});
