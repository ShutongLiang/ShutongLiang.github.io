(() => {
  "use strict";
  const data = window.HOUXING_DEMO_DATA;
  if (!data) { document.body.innerHTML = "<p style='padding:2rem;color:white'>演示数据加载失败。</p>"; return; }
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const targetMap = new Map(data.targets.map((target) => [String(target.tic), target]));
  let activeTarget = null, activeCandidate = null, animationToken = 0, vaultRevealed = false;
  const ui = { form: $("#searchForm"), input: $("#ticInput"), targets: $("#demoTargets"), empty: $("#emptyState"), content: $("#resultsContent"), panel: $("#resultsPanel"), candidateList: $("#candidateList"), reveal: $("#revealButton"), toast: $("#toast") };

  function fmt(value, digits = 1) { if (value === null || value === undefined || Number.isNaN(Number(value))) return "—"; return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits }); }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char])); }
  function showToast(message) { ui.toast.textContent = message; ui.toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => ui.toast.classList.remove("show"), 2600); }

  function initTargets() {
    ui.targets.innerHTML = data.targets.map((target) => `<button class="target-chip" type="button" data-tic="${target.tic}">TIC ${target.tic} · ${escapeHtml(target.title)}</button>`).join("");
    ui.targets.addEventListener("click", (event) => { const button = event.target.closest("[data-tic]"); if (!button) return; ui.input.value = button.dataset.tic; runScan(button.dataset.tic); });
  }
  function resetPipeline() { $$("#pipeline li").forEach((item) => item.classList.remove("running", "done")); }
  async function animatePipeline(token) { resetPipeline(); for (const item of $$("#pipeline li")) { if (token !== animationToken) return false; item.classList.add("running"); await new Promise((resolve) => setTimeout(resolve, 250)); item.classList.remove("running"); item.classList.add("done"); } return token === animationToken; }
  async function runScan(rawTic) {
    const tic = String(rawTic).replace(/\D/g, ""), target = targetMap.get(tic);
    if (!target) { showToast("这个编号还没有预计算演示。请点一个示范目标。正式版会提交后台任务。"); ui.input.focus(); return; }
    animationToken += 1; const token = animationToken; ui.empty.hidden = false; ui.content.hidden = true;
    ui.empty.querySelector("h2").textContent = `正在扫描 TIC ${tic}`; ui.empty.querySelector("p").textContent = "正在重放已经完成的真实分析流程…";
    $$(".target-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.tic === tic));
    if (!(await animatePipeline(token))) return;
    activeTarget = target; activeCandidate = target.candidates[0]; renderTarget(); ui.empty.hidden = true; ui.content.hidden = false;
    if (window.innerWidth < 780) ui.panel.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  function renderTarget() {
    $("#targetName").textContent = `TIC ${activeTarget.tic}`; $("#targetLabel").textContent = `TESS TARGET / ${activeTarget.title}`; $("#targetSummary").textContent = activeTarget.summary;
    $("#targetMeta").innerHTML = `<div><span>发现观测季</span><b>${activeTarget.searchSectors.join(" · ")}</b></div><div><span>封存观测季</span><b>Sector ${activeTarget.holdoutSector}</b></div><div><span>原始候选池</span><b>${activeTarget.candidatePool} 个</b></div>`;
    ui.candidateList.innerHTML = activeTarget.candidates.map((candidate, index) => `<button class="candidate-card ${index===0?"active":""}" type="button" data-index="${index}"><small>NO. ${String(candidate.rank).padStart(2,"0")}</small><strong>${fmt(candidate.period,3)} <i>天</i></strong><span>${escapeHtml(candidate.conclusion)}</span></button>`).join("");
    ui.candidateList.onclick = (event) => { const button = event.target.closest("[data-index]"); if (!button) return; activeCandidate = activeTarget.candidates[Number(button.dataset.index)]; $$(".candidate-card").forEach((card) => card.classList.toggle("active", card===button)); renderCandidate(); };
    renderCandidate();
  }
  function plainVerdict(candidate) { if (candidate.conclusion === "很值得复查") return "多条处理路线都看见了它，后续封存数据也给出支持，值得优先人工复查。"; if (candidate.conclusion === "可能有信号") return "有重复变暗，但证据还不够完整；先保留，不急着宣布。"; return "机器看见了一些规律，但支路一致性或排假证据不足，暂时放在观察区。"; }
  function renderCandidate() {
    const c = activeCandidate; vaultRevealed = false; $("#rankBadge").textContent = String(c.rank).padStart(2,"0"); $("#periodValue").textContent = fmt(c.period,6); $("#scoreValue").textContent = fmt(c.score,2); $("#plainConclusion").textContent = plainVerdict(c); $("#holdoutSector").textContent = activeTarget.holdoutSector;
    renderReasons(c); renderChecks(c); renderExpert(c); renderFold($("#discoveryChart"), c.fold.discovery, "#ffd36d"); renderFold($("#holdoutChart"), c.fold.holdout, "#b99cff");
    $("#discoveryCaption").textContent = `发现阶段使用 Sector ${activeTarget.searchSectors.join("、")}；图中为真实光变的轻量折叠显示，共 ${c.fold.discovery.point_count.toLocaleString("zh-CN")} 个有效点。`;
    $("#vaultVerdict").hidden = true; $("#vaultVerdict").innerHTML = ""; $(".vault-chart-wrap").classList.remove("revealed"); ui.reveal.hidden = false;
  }
  function renderReasons(c) {
    const reasons = [];
    if (c.branches.length >= 3) reasons.push(["多条路线同意", `${c.branches.join("、")} 都找到相近周期。`]); else if (c.branches.length===2) reasons.push(["两条路线同意", `${c.branches.join("、")} 给出支持。`]); else reasons.push(["只有一条路线", "需要警惕某种清洗方法制造假信号。"]);
    if (c.holdoutBranches.length) reasons.push(["未来观测能对上", `封存季有 ${c.holdoutBranches.length} 条支路在预计位置看到变暗。`]); else reasons.push(["封存支持不足", "后续观测没有形成明确的独立支持。"]);
    if (c.conditioned) reasons.push(["是第二轮捞出的", "先遮住更强信号，再在残差里找到它。"]); else reasons.push(["第一轮直接找到", `搜索阶段看到约 ${c.events} 次预期事件。`]);
    $("#reasonList").innerHTML = reasons.map(([title,text]) => `<div class="reason"><i>${title.includes("不足")||title.includes("只有")?"!":"✓"}</i><div><b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span></div></div>`).join("");
    $("#branchStrip").innerHTML = `<span>发现它的支路</span><div class="branches">${c.branches.map((branch)=>`<i>${escapeHtml(branch)}</i>`).join("")||"<i>无</i>"}</div>`;
  }
  function checkCard(title,value,description,state) { return `<article class="check-card ${state}"><header><b>${escapeHtml(title)}</b><i></i></header><strong>${escapeHtml(value)}</strong><p>${escapeHtml(description)}</p></article>`; }
  function renderChecks(c) {
    const k=c.checks, odd=!k.oddEven.available?"warn":k.oddEven.veto?"bad":"good", sec=!k.secondary.available?"warn":k.secondary.veto?"bad":"good", shape=!k.vshape.available?"warn":k.vshape.veto?"bad":"good", cent=!k.centroid.available?"warn":k.centroid.veto?"bad":"good", neigh=!k.neighbor.available||k.neighbor.canMimic?"warn":k.neighbor.veto?"bad":"good";
    $("#checksGrid").innerHTML = [
      checkCard("奇偶事件",k.oddEven.available?`${fmt(k.oddEven.sigma,2)} σ`:"数据不足",k.oddEven.veto?"一深一浅，像食双星。":"没有触发奇偶深度硬警报。",odd),
      checkCard("半周期次食",k.secondary.available?`SNR ${fmt(k.secondary.snr,2)}`:"数据不足",k.secondary.veto?"半周期处有明显第二次变暗。":"没有触发明显次食警报。",sec),
      checkCard("凌日形状",k.vshape.available?`V=${fmt(k.vshape.ingressFraction,2)}`:"数据不足",k.vshape.veto?"过尖，更像掠食双星。":"形状初筛没有否决。",shape),
      checkCard("质心漂移",k.centroid.available?`${fmt(k.centroid.significance,2)} σ`:"数据不足",k.centroid.veto?"变暗时光心发生明显移动。":"未触发质心硬警报；仍不等于像素定位。",cent),
      checkCard("邻星污染",k.neighbor.available?`CROWDSAP ${fmt(k.neighbor.crowdsap,3)}`:"未检查",k.neighbor.canMimic?"理论上邻星仍可能模仿，需要像素图。":"粗略污染量不足以解释该深度。",neigh)
    ].join("");
    $("#pixelText").textContent = k.centroid.available ? `当前只有 SPOC 质心初筛（${fmt(k.centroid.significance,2)}σ），不是 TPF 差分成像。正式结论还需检查变暗究竟落在哪个像素、是否更接近 Gaia 邻星。` : "当前连可靠质心初筛都不足。正式结论还需 TPF 差分成像、多孔径深度与 Gaia 邻星定位。";
  }
  function renderExpert(c) {
    const fields=[["candidate_id",c.id],["candidate_score",fmt(c.score,3)],["period_days",fmt(c.period,6)],["epoch_btjd",fmt(c.epoch,5)],["duration_hours",fmt(c.durationHours,2)],["search_median_snr",fmt(c.searchSnr,2)],["holdout_median_snr",fmt(c.holdoutSnr,2)],["primary_depth_ppm",fmt(c.depthPpm,0)],["search_events",String(c.events)],["observed_events",String(c.observedEvents)],["holdout_expected_events",String(c.holdoutEvents)],["relative_period_scatter",fmt(c.periodScatter,7)],["candidate_source",c.source||"—"],["catalog_match_opened_dev",c.catalogPeriod?`${fmt(c.catalogPeriod,6)} d`:"none in top match"],["pixel_status",c.pixelStatus||"not_run"],["score_is_probability","false"]];
    $("#expertGrid").innerHTML=fields.map(([name,value])=>`<div class="expert-item"><span>${escapeHtml(name)}</span><b>${escapeHtml(value)}</b></div>`).join("");
  }
  function renderFold(svg,fold,color) {
    const width=760,height=280,pad={left:54,right:18,top:20,bottom:28}; svg.setAttribute("viewBox",`0 0 ${width} ${height}`);
    if (!fold||!fold.bins.length) { svg.innerHTML='<text x="50%" y="50%" fill="#88a2b4" text-anchor="middle" font-size="12">这段数据不足，无法绘图</text>'; return; }
    const values=fold.bins.map((row)=>row[1]).filter(Number.isFinite),q1=Math.min(...values),q2=Math.max(...values),extent=Math.max(180,Math.abs(q1),Math.abs(q2))*1.12,minY=-extent,maxY=extent;
    const x=(phase)=>pad.left+(phase+.5)*(width-pad.left-pad.right), y=(ppm)=>pad.top+(maxY-Math.max(minY,Math.min(maxY,ppm)))/(maxY-minY)*(height-pad.top-pad.bottom);
    const line=fold.bins.map((row,index)=>`${index?"L":"M"}${x(row[0]).toFixed(1)},${y(row[1]).toFixed(1)}`).join(" "), top=fold.bins.map((row,index)=>`${index?"L":"M"}${x(row[0]).toFixed(1)},${y(row[3]).toFixed(1)}`).join(" "), bottom=[...fold.bins].reverse().map((row)=>`L${x(row[0]).toFixed(1)},${y(row[2]).toFixed(1)}`).join(" ");
    const points=fold.points.map((row)=>`<circle cx="${x(row[0]).toFixed(1)}" cy="${y(row[1]).toFixed(1)}" r="1.2" fill="#56798a" opacity=".25"/>`).join("");
    const grids=[-.5,-.25,0,.25,.5].map((v)=>`<line x1="${x(v)}" x2="${x(v)}" y1="${pad.top}" y2="${height-pad.bottom}" stroke="rgba(126,174,197,.10)"/>`).join("")+[-extent,0,extent].map((v)=>`<line x1="${pad.left}" x2="${width-pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(126,174,197,.10)"/><text x="${pad.left-8}" y="${y(v)+3}" fill="#536f81" text-anchor="end" font-size="9">${Math.round(v)}</text>`).join("");
    svg.innerHTML=`${grids}<text x="13" y="18" fill="#536f81" font-size="9">ppm</text>${points}<path d="${top} ${bottom} Z" fill="${color}" opacity=".09"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/><line x1="${x(0)}" x2="${x(0)}" y1="${pad.top}" y2="${height-pad.bottom}" stroke="${color}" opacity=".42" stroke-dasharray="3 5"/>`;
  }
  function percentile(values,fraction){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.max(0,Math.floor((sorted.length-1)*fraction)))]||0;}
  function revealVault(){if(!activeCandidate||vaultRevealed)return;vaultRevealed=true;$(".vault-chart-wrap").classList.add("revealed");$("#vaultVerdict").hidden=false;const supported=activeCandidate.holdoutBranches.length;$("#vaultVerdict").innerHTML=supported?`<b>封存数据给出支持。</b> ${supported} 条处理支路在预测位置看到变暗，中位 SNR ${fmt(activeCandidate.holdoutSnr,2)}。这是加分证据，不是行星确认。`:`<b>封存数据未给出明确支持。</b> 目前不能说明预测通过，保留为证据不足。`;ui.reveal.hidden=true;}
  function renderMetrics(){const m=data.metrics;$("#metricStory").innerHTML=`<div><div class="metric-main"><strong>${m.generated}</strong><span>/ ${m.signals}</span></div><p>候选池里找到了 23 个已知信号中的 22 个。这里说的是“曾经生成过”，不等于都排进前五。</p></div><div class="metric-bars">${[["Top 1",m.top1],["Top 3",m.top3],["Top 5",m.top5],["Top 10",m.top10]].map(([label,value])=>`<div class="metric-row"><span>${label}</span><i style="--w:${value/m.signals*100}%"></i><b>${value} / ${m.signals}</b></div>`).join("")}</div>`;$("#blindStatus").textContent=data.reservedBlindStatus.replaceAll("_"," ");}

  ui.form.addEventListener("submit",(event)=>{event.preventDefault();runScan(ui.input.value);}); ui.reveal.addEventListener("click",revealVault);
  $("#modeSwitch").addEventListener("click",(event)=>{const pressed=event.currentTarget.getAttribute("aria-pressed")!=="true";event.currentTarget.setAttribute("aria-pressed",String(pressed));document.body.classList.toggle("expert-mode",pressed);showToast(pressed?"已切换到专业模式":"已切换到小白模式");});
  window.addEventListener("resize",()=>{if(activeCandidate){renderFold($("#discoveryChart"),activeCandidate.fold.discovery,"#ffd36d");renderFold($("#holdoutChart"),activeCandidate.fold.holdout,"#b99cff");}});
  initTargets(); renderMetrics(); runScan("354944123");
})();
