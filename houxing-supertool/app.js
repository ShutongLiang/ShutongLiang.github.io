(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const palette = ["#79e7df", "#ffd36d", "#b99cff", "#86e3a7", "#ff8f9c"];
  const ui = {
    form: $("#searchForm"), input: $("#ticInput"), mission: $("#missionSelect"),
    mode: $("#runMode"), button: $("#scanButton"), status: $("#engineStatus"),
    empty: $("#emptyState"), content: $("#resultsContent"), panel: $("#resultsPanel"),
    message: $("#jobMessage"), progress: $("#progressBar"), progressNumber: $("#progressNumber"),
    candidateList: $("#candidateList"), reveal: $("#revealButton"), toast: $("#toast"),
    agent: $("#agentConsole"), agentBody: $("#agentConsoleBody"), agentState: $("#agentState"),
    agentNarrative: $("#agentNarrative"), agentLog: $("#agentLog"), agentElapsed: $("#agentElapsed"),
    agentActions: $("#agentActions"), agentPercent: $("#agentPercent")
  };
  let pollTimer = null;
  let currentJobId = null;
  let currentResult = null;
  let activeCandidate = null;
  let vaultRevealed = false;
  let latestJob = null;
  let renderedLogJob = null;
  let renderedLogSequence = 0;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function fmt(value, digits = 1) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  const stageNames = {
    queued: "队列", starting: "启动", discovering: "档案", downloading: "下载",
    preparing: "封存", searching: "搜索", ranking: "排序", vetting: "排假",
    catalog: "查重", rendering: "制图", complete: "完成", failed: "错误"
  };

  const metricNames = {
    mission: "任务", target: "目标", found: "发现产品", selected: "选用观测段",
    mode: "模式", segment: "观测段", cadence_s: "采样秒", files: "文件",
    point_cap: "单段点数上限", discovery_segments: "发现段", holdout_segment: "封存段",
    period_max_days: "最长周期/天", duration_templates: "时长模板", branches: "支路",
    passes_each: "每支路扫描", points: "处理点数", cadences: "光度点", pass: "轮次",
    new_candidates: "新增假设", branch_total: "支路累计", periodic: "周期假设",
    single: "单次事件", double: "双次事件", raw: "原始假设", groups: "候选组",
    masked_signals: "已遮挡信号", masks: "遮挡数", residual: "残差假设",
    appended_groups: "追加候选组", holdout: "封存段", measured_groups: "已回测组",
    branch_candidates: "支路假设", candidate_groups: "融合候选组", fused_groups: "融合组",
    review_candidates: "复核候选", checks_each: "检查项", tic_id: "TIC",
    ranked_candidates: "已排名", candidates: "候选", folds: "折叠图",
    page_candidates: "页面候选", candidate_pool: "候选池", runtime_s: "用时秒",
    storage: "存储", cache: "缓存"
  };

  function formatElapsed(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function eventTime(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "--:--:--" : parsed.toLocaleTimeString("zh-CN", { hour12: false });
  }

  function metricValue(value) {
    if (value === null || value === undefined) return "—";
    if (typeof value === "number") return value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function updateAgentClock() {
    if (!latestJob || ui.agent.hidden) return;
    const created = new Date(latestJob.created_at).getTime();
    const liveSeconds = Number.isFinite(created) ? (Date.now() - created) / 1000 : 0;
    const elapsed = latestJob.status === "complete" && latestJob.result?.runtime_seconds !== undefined
      ? latestJob.result.runtime_seconds
      : liveSeconds;
    ui.agentElapsed.textContent = formatElapsed(elapsed);
  }

  function renderAgentConsole(job) {
    latestJob = job;
    ui.agent.hidden = false;
    ui.agent.className = `agent-console ${job.status || "running"}`;
    ui.agentState.textContent = job.status === "complete"
      ? "分析完成 · 科学结果已锁定"
      : job.status === "failed"
        ? "任务停止 · 已保留错误现场"
        : job.status === "queued"
          ? "已排队 · 等待研究代理接管"
          : `${job.target || "目标"} · ${stageNames[job.stage] || "计算中"}`;
    ui.agentNarrative.textContent = job.message || "正在等待下一条真实计算事件";
    ui.agentPercent.textContent = `${Math.round(Number(job.percent) || 0)}%`;
    const events = Array.isArray(job.events) ? job.events : [];
    ui.agentActions.textContent = events.length.toLocaleString("zh-CN");
    updateAgentClock();

    if (renderedLogJob !== job.id) {
      renderedLogJob = job.id;
      renderedLogSequence = 0;
      ui.agentLog.innerHTML = '<div class="terminal-wait"><span>$</span> 正在接收后台真实事件…</div>';
    }
    const nearBottom = ui.agentLog.scrollHeight - ui.agentLog.scrollTop - ui.agentLog.clientHeight < 90;
    const additions = events.filter((event) => Number(event.seq || 0) > renderedLogSequence);
    if (additions.length) ui.agentLog.querySelector(".terminal-wait")?.remove();
    additions.forEach((event) => {
      const metrics = Object.entries(event.metrics || {}).filter(([, value]) => value !== null && value !== undefined);
      const command = event.command
        ? `<code><i>$</i><span>${escapeHtml(event.command)}</span></code>`
        : "";
      const metricHtml = metrics.length
        ? `<div class="terminal-metrics">${metrics.map(([key, value]) => `<span><i>${escapeHtml(metricNames[key] || key)}</i><b>${escapeHtml(metricValue(value))}</b></span>`).join("")}</div>`
        : "";
      const message = event.message && event.message !== event.title
        ? `<p>${escapeHtml(event.message)}</p>`
        : "";
      ui.agentLog.insertAdjacentHTML("beforeend", `<article class="terminal-entry level-${escapeHtml(event.level || "info")}" data-seq="${Number(event.seq) || 0}">
        <div class="terminal-line"><time>${escapeHtml(eventTime(event.at))}</time><span>${escapeHtml(stageNames[event.stage] || event.stage || "任务")}</span><b>${escapeHtml(event.title || event.message || "执行动作")}</b></div>
        ${message}${command}${metricHtml}
      </article>`);
      renderedLogSequence = Math.max(renderedLogSequence, Number(event.seq) || 0);
    });
    if (nearBottom || job.status === "running" || job.status === "queued") {
      ui.agentLog.scrollTop = ui.agentLog.scrollHeight;
    }
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => ui.toast.classList.remove("show"), 3000);
  }

  function setEngineState(ok, text) {
    ui.status.classList.toggle("online", ok);
    ui.status.classList.toggle("offline", !ok);
    ui.status.innerHTML = `<span class="live-dot"></span> ${escapeHtml(text)}`;
    ui.button.disabled = !ok;
  }

  async function checkHealth() {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("backend unavailable");
      const health = await response.json();
      setEngineState(true, "实时计算引擎已连接 · Passport 存储");
      ui.message.innerHTML = `<b>可以开始</b><br />数据与结果将放在 ${escapeHtml(health.storage)}`;
      const remembered = new URLSearchParams(window.location.search).get("job") || localStorage.getItem("houxing-live-job");
      if (remembered) pollJob(remembered, true);
    } catch (_error) {
      setEngineState(false, "未连接实时计算引擎");
      ui.message.innerHTML = '<b>需要先启动后台</b><br />双击项目里的 start_live_supertool.command，然后<a href="http://127.0.0.1:8765/">打开本机实时版</a>。';
      ui.empty.querySelector("h2").textContent = "页面已打开，但计算引擎没启动";
      ui.empty.querySelector("p").innerHTML = 'GitHub 页面只能显示界面；Lightkurve 下载和科学计算需要这台电脑上的后台。<br /><a href="http://127.0.0.1:8765/">后台启动后点这里进入实时版</a>';
    }
  }

  function stageIndex(stage) {
    if (["discovering", "starting", "queued"].includes(stage)) return 0;
    if (["downloading", "preparing"].includes(stage)) return 1;
    if (stage === "searching") return 2;
    if (["ranking", "vetting"].includes(stage)) return 3;
    if (["catalog", "rendering", "complete"].includes(stage)) return 4;
    return -1;
  }

  function renderProgress(job) {
    renderAgentConsole(job);
    const index = stageIndex(job.stage);
    $$("#pipeline li").forEach((item, itemIndex) => {
      item.classList.toggle("done", job.status === "complete" || itemIndex < index);
      item.classList.toggle("running", job.status === "running" && itemIndex === index);
    });
    const percent = Math.max(0, Math.min(100, Number(job.percent) || 0));
    ui.progress.style.width = `${percent}%`;
    ui.progressNumber.textContent = `${Math.round(percent)}%`;
    const prefix = job.status === "failed" ? "计算失败" : job.status === "complete" ? "计算完成" : "正在现场计算";
    ui.message.innerHTML = `<b>${prefix}</b><br />${escapeHtml(job.message || "请稍候")}`;
  }

  async function createJob() {
    const target = ui.input.value.trim();
    if (!target) {
      showToast("请输入 TIC、KIC、EPIC 编号或星名");
      ui.input.focus();
      return;
    }
    clearTimeout(pollTimer);
    currentResult = null;
    activeCandidate = null;
    latestJob = null;
    renderedLogJob = null;
    renderedLogSequence = 0;
    ui.agent.hidden = true;
    ui.button.disabled = true;
    ui.button.querySelector("span").textContent = "提交中…";
    ui.content.hidden = true;
    ui.empty.hidden = false;
    ui.empty.classList.remove("failed");
    ui.empty.querySelector("h2").textContent = `正在启动 ${target}`;
    ui.empty.querySelector("p").textContent = "先去档案馆找数据，然后现场下载和计算。";
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, mission: ui.mission.value, mode: ui.mode.value })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法创建任务");
      currentJobId = payload.id;
      localStorage.setItem("houxing-live-job", currentJobId);
      history.replaceState(null, "", `?job=${encodeURIComponent(currentJobId)}`);
      renderProgress(payload);
      pollJob(currentJobId);
    } catch (error) {
      renderFailure(error.message);
      ui.button.disabled = false;
    } finally {
      ui.button.querySelector("span").textContent = "实时扫描";
    }
  }

  async function pollJob(jobId, quiet = false) {
    currentJobId = jobId;
    clearTimeout(pollTimer);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 404 && quiet) {
          localStorage.removeItem("houxing-live-job");
          return;
        }
        throw new Error("读取任务状态失败");
      }
      const job = await response.json();
      renderProgress(job);
      if (job.status === "complete" && job.result) {
        localStorage.removeItem("houxing-live-job");
        ui.button.disabled = false;
        renderResult(job.result);
        return;
      }
      if (job.status === "failed") {
        localStorage.removeItem("houxing-live-job");
        ui.button.disabled = false;
        renderFailure(job.message || job.error || "计算失败");
        return;
      }
      ui.button.disabled = true;
      ui.empty.hidden = true;
      ui.content.hidden = true;
      pollTimer = setTimeout(() => pollJob(jobId), 1600);
    } catch (error) {
      if (!quiet) renderFailure(error.message);
      ui.button.disabled = false;
    }
  }

  function renderFailure(message) {
    ui.empty.hidden = false;
    ui.content.hidden = true;
    ui.empty.classList.add("failed");
    ui.empty.querySelector("h2").textContent = "这次没有算完";
    ui.empty.querySelector("p").textContent = message;
    ui.message.innerHTML = `<b>任务失败</b><br />${escapeHtml(message)}`;
    showToast(message);
  }

  function renderResult(result) {
    currentResult = result;
    ui.empty.hidden = true;
    ui.content.hidden = false;
    ui.content.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#targetName").textContent = result.object || result.target;
    $("#targetLabel").textContent = `${result.mission} / LIVE RESULT`;
    $("#targetSummary").textContent = `这份结果刚刚由 Lightkurve 找数据，并由候星 ${result.engine_version || "v0.8"} 现场计算。最后观测段${result.strict_holdout ? "没有参与搜索，用于封存检验" : "不足，无法做独立封存检验"}。`;
    $("#targetMeta").innerHTML = [
      ["发现观测段", result.search_segments?.length ? result.search_segments.join(" · ") : "—"],
      ["封存观测段", result.holdout_segment ?? "无"],
      ["原始候选池", `${result.candidate_pool_total ?? 0} 个`],
      ["现算用时", `${fmt((result.runtime_seconds || 0) / 60, 1)} 分钟`]
    ].map(([label, value]) => `<div><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join("");

    renderAnswers(result.catalog_answers || []);
    const candidates = (result.candidates || []).slice(0, 5);
    renderTimeline(candidates, result.timeline_segments || []);
    if (!candidates.length) {
      ui.candidateList.innerHTML = '<div class="no-candidates">当前数据没有生成可靠周期候选。这不等于证明没有行星。</div>';
      $("#candidateDetail").hidden = true;
      return;
    }
    ui.candidateList.innerHTML = candidates.map((candidate, index) => {
      const match = candidate.known_match;
      return `<button class="candidate-card ${index === 0 ? "active" : ""} ${match ? "known-hit" : ""}" type="button" data-index="${index}">
        <small>NO. ${String(candidate.rank).padStart(2, "0")}</small>
        <strong>${fmt(candidate.period_days, 4)} <i>天</i></strong>
        <em class="candidate-answer ${match ? "hit" : "unknown"}">${match ? `✓ 对上 ${escapeHtml(match.name)}` : "未对上当前已知 TOI"}</em>
      </button>`;
    }).join("");
    ui.candidateList.onclick = (event) => {
      const button = event.target.closest("[data-index]");
      if (!button) return;
      activeCandidate = candidates[Number(button.dataset.index)];
      $$(".candidate-card").forEach((card) => card.classList.toggle("active", card === button));
      renderCandidate();
    };
    activeCandidate = candidates[0];
    $("#candidateDetail").hidden = false;
    renderCandidate();
  }

  function renderAnswers(answers) {
    const board = $("#answerBoard");
    if (!answers.length) {
      board.hidden = true;
      return;
    }
    board.hidden = false;
    $("#answerGrid").innerHTML = answers.map((answer, index) => {
      const hit = answer.matchedRank !== null && answer.matchedRank !== undefined;
      const generated = answer.generatedRank !== null && answer.generatedRank !== undefined;
      return `<article class="answer-card ${hit ? "hit" : generated ? "later" : "miss"}" style="--signal:${palette[index % palette.length]}">
        <div class="answer-orb"><i></i></div><div><span>${escapeHtml(answer.status)}</span><h4>${escapeHtml(answer.name)}</h4>
        <p>目录周期 ${fmt(answer.period, 6)} 天</p><small>${generated ? `算法周期 ${fmt(answer.algorithmPeriod, 6)} 天${answer.matchedAsAlternate ? "（被并入倍频组）" : ""}` : "整个候选池都没有对上"}</small></div>
        <b>${hit ? `命中第 ${answer.matchedRank} 组${answer.matchedAsAlternate ? "，正确周期作为备选" : ""}` : generated ? `已生成，但排在第 ${answer.generatedRank} 组` : "本次未找到"}</b>
      </article>`;
    }).join("");
  }

  function renderTimeline(candidates, segments) {
    const svg = $("#timelineChart");
    if (!candidates.length || !segments.length) {
      svg.setAttribute("viewBox", "0 0 900 150");
      svg.innerHTML = '<text x="450" y="75" text-anchor="middle" fill="#88a2b4" font-size="12">没有可绘制的时间轴</text>';
      return;
    }
    const width = 1100, left = 104, right = 24, top = 38, lane = 43;
    const height = top + candidates.length * lane + 37;
    const minTime = Math.min(...segments.map((row) => Number(row.start)));
    const maxTime = Math.max(...segments.map((row) => Number(row.end)));
    const span = Math.max(1, maxTime - minTime);
    const x = (time) => left + (Number(time) - minTime) / span * (width - left - right);
    const segmentRects = segments.map((segment) => {
      const holdout = segment.kind === "holdout";
      const x1 = x(segment.start), x2 = x(segment.end);
      return `<rect x="${x1.toFixed(1)}" y="22" width="${Math.max(2, x2 - x1).toFixed(1)}" height="${height - 42}" rx="3" fill="${holdout ? "rgba(185,156,255,.12)" : "rgba(121,231,223,.055)"}" stroke="${holdout ? "rgba(185,156,255,.35)" : "rgba(121,231,223,.13)"}"/>
        <text x="${((x1 + x2) / 2).toFixed(1)}" y="14" text-anchor="middle" fill="${holdout ? "#b99cff" : "#536f81"}" font-size="9">${holdout ? "封存 " : ""}${escapeHtml(segment.segment)}</text>`;
    }).join("");
    const lanes = candidates.map((candidate, index) => {
      const y = top + index * lane + 18;
      const color = palette[index % palette.length];
      const events = (candidate.events || []).map((event) => `<circle cx="${x(event.time).toFixed(1)}" cy="${y}" r="${event.kind === "holdout" ? 5 : 3.4}" fill="${event.kind === "holdout" ? "#b99cff" : color}" stroke="#061018" stroke-width="1.4"><title>第 ${event.cycle} 轮 · ${fmt(event.time, 3)} BTJD</title></circle>`).join("");
      const label = candidate.known_match ? `#${candidate.rank} ✓ ${candidate.known_match.name}` : `#${candidate.rank} ${fmt(candidate.period_days, 3)}d`;
      return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" stroke="${color}" stroke-opacity=".28" stroke-dasharray="3 7"/>
        <text x="${left - 10}" y="${y + 4}" text-anchor="end" fill="${color}" font-size="10">${escapeHtml(label)}</text>${events}`;
    }).join("");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.minWidth = segments.length > 5 ? "980px" : "760px";
    svg.innerHTML = `${segmentRects}${lanes}<text x="${left}" y="${height - 8}" fill="#536f81" font-size="9">BTJD ${fmt(minTime, 1)}</text><text x="${width - right}" y="${height - 8}" text-anchor="end" fill="#536f81" font-size="9">BTJD ${fmt(maxTime, 1)}</text>`;
  }

  function plainVerdict(candidate) {
    if (candidate.known_match) return `这个周期对上了已知目录中的 ${candidate.known_match.name}。对照是排名完成后才做的。`;
    if ((candidate.holdout_supporting_branches || []).length) return "多条处理路线找到了它，而且封存观测段也在预计时间看到变暗，值得优先复查。";
    if ((candidate.supporting_branches || []).length >= 2) return "不同处理路线看到了相近周期，但封存支持还不明确，先保留为候选。";
    return "机器看到了可能的规律，但独立证据不足，暂时属于证据不足。";
  }

  function renderCandidate() {
    const candidate = activeCandidate;
    vaultRevealed = false;
    $("#rankBadge").textContent = String(candidate.rank).padStart(2, "0");
    $("#periodValue").textContent = fmt(candidate.period_days, 6);
    $("#scoreValue").textContent = fmt(candidate.candidate_score, 2);
    $("#plainConclusion").textContent = plainVerdict(candidate);
    $("#holdoutLabel").textContent = currentResult.strict_holdout ? `封存段 ${currentResult.holdout_segment}` : "无独立封存段";
    renderCatalogMatch(candidate);
    renderReasons(candidate);
    renderChecks(candidate);
    renderExpert(candidate);
    renderFold($("#discoveryChart"), candidate.fold?.discovery, "#ffd36d");
    renderFold($("#holdoutChart"), candidate.fold?.holdout, "#b99cff");
    const points = candidate.fold?.discovery?.point_count || 0;
    $("#discoveryCaption").textContent = `仅使用发现段 ${currentResult.search_segments.join("、")} 搜索；这张相位图叠加了 ${points.toLocaleString("zh-CN")} 个有效点。`;
    $("#vaultVerdict").hidden = true;
    $("#vaultVerdict").innerHTML = "";
    $(".vault-chart-wrap").classList.remove("revealed");
    ui.reveal.hidden = false;
    ui.reveal.disabled = !currentResult.strict_holdout;
    ui.reveal.querySelector("span").textContent = currentResult.strict_holdout ? "打开封存结果" : "没有可开的封存段";
  }

  function renderCatalogMatch(candidate) {
    const box = $("#catalogMatch");
    if (candidate.known_match) {
      const match = candidate.known_match;
      box.className = "catalog-match hit";
      box.innerHTML = `<i>✓</i><div><b>排名后查重：对上 ${escapeHtml(match.name)}（${escapeHtml(match.status)}）</b><span>目录周期 ${fmt(match.period, 7)} 天；算法匹配周期 ${fmt(match.matchedPeriod || candidate.period_days, 7)} 天${match.matchedAsAlternate ? "（该候选组的备选周期）" : ""}；相差 ${fmt(match.periodErrorMinutes, 2)} 分钟。</span></div>`;
    } else {
      box.className = "catalog-match unmatched";
      box.innerHTML = "<i>?</i><div><b>没有对上当前 TOI 目录</b><span>它可能是新候选，也可能是假信号；不能因为“没查到”就宣布新行星。</span></div>";
    }
  }

  function renderReasons(candidate) {
    const branches = candidate.supporting_branches || [];
    const holdout = candidate.holdout_supporting_branches || [];
    const reasons = [];
    reasons.push([
      branches.length >= 2 ? "多条路线互相印证" : "支持路线较少",
      branches.length ? `${branches.length} 条处理路线找到这个周期。` : "没有可读取的支路信息。",
      branches.length >= 2
    ]);
    reasons.push([
      holdout.length ? "封存段按时变暗" : "封存支持不明确",
      currentResult.strict_holdout ? (holdout.length ? `${holdout.length} 条路线在没参与搜索的数据中给出支持。` : "独立的最后观测段没有形成明确支持。") : "只有一个观测段，无法独立封存验证。",
      holdout.length > 0
    ]);
    (candidate.reasons_zh || []).slice(0, 2).forEach((reason) => reasons.push(["排名器证据", String(reason), true]));
    $("#reasonList").innerHTML = reasons.map(([title, text, good]) => `<div class="reason"><i>${good ? "✓" : "!"}</i><div><b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span></div></div>`).join("");
    $("#branchStrip").innerHTML = `<span>发现它的支路</span><div class="branches">${branches.length ? branches.map((branch) => `<i>${escapeHtml(branch)}</i>`).join("") : "<i>无</i>"}</div>`;
  }

  function checkCard(title, value, description, state) {
    return `<article class="check-card ${state}"><header><b>${escapeHtml(title)}</b><i></i></header><strong>${escapeHtml(value)}</strong><p>${escapeHtml(description)}</p></article>`;
  }

  function renderChecks(candidate) {
    const evidence = candidate.physical_vetting || {};
    const odd = evidence.odd_even || {};
    const secondary = evidence.secondary_eclipse || {};
    const shape = evidence.v_shape || {};
    const centroid = evidence.centroid_motion || {};
    const neighbor = evidence.neighbor_contamination || {};
    const state = (row) => !row.available ? "warn" : row.veto ? "bad" : "good";
    $("#checksGrid").innerHTML = [
      checkCard("奇偶事件", odd.available ? `${fmt(odd.difference_sigma, 2)} σ` : "数据不足", odd.veto ? "一深一浅，像食双星。" : "没有触发奇偶深度否决。", state(odd)),
      checkCard("半周期次食", secondary.available ? `SNR ${fmt(secondary.snr, 2)}` : "数据不足", secondary.veto ? "半周期处有明显第二次变暗。" : "没有触发次食否决。", state(secondary)),
      checkCard("凌日形状", shape.available ? `V=${fmt(shape.ingress_fraction, 2)}` : "数据不足", shape.veto ? "形状过尖，更像掠食双星。" : "形状初筛没有否决。", state(shape)),
      checkCard("质心漂移", centroid.available ? `${fmt(centroid.significance, 2)} σ` : "数据不足", centroid.veto ? "变暗时光心明显移动。" : "没有触发质心否决。", state(centroid)),
      checkCard("邻星污染", neighbor.available ? `CROWDSAP ${fmt(neighbor.crowdsap, 3)}` : "未检查", neighbor.neighbor_can_mimic ? "邻星理论上可能模仿，需要像素图。" : "粗略污染量不足以解释深度。", state(neighbor))
    ].join("");
  }

  function renderExpert(candidate) {
    const features = candidate.features || {};
    const fields = [
      ["candidate_id", candidate.candidate_id], ["candidate_score", fmt(candidate.candidate_score, 3)],
      ["period_days", fmt(candidate.period_days, 7)], ["epoch_btjd", fmt(candidate.epoch_btjd, 6)],
      ["duration_hours", fmt(candidate.duration_hours, 3)], ["median_search_snr", fmt(features.median_search_snr, 3)],
      ["primary_depth_ppm", fmt(features.primary_depth_ppm, 1)], ["supporting_branches", (candidate.supporting_branches || []).length],
      ["holdout_supporting_branches", (candidate.holdout_supporting_branches || []).length],
      ["candidate_source", candidate.candidate_source || "—"], ["alias_group_size", candidate.alias_group_size ?? "—"],
      ["pixel_status", candidate.pixel_status || "not_run"], ["known_catalog_match", candidate.known_match?.name || "none"],
      ["score_is_probability", "false"]
    ];
    $("#expertGrid").innerHTML = fields.map(([name, value]) => `<div class="expert-item"><span>${escapeHtml(name)}</span><b>${escapeHtml(value)}</b></div>`).join("");
  }

  function renderFold(svg, fold, color) {
    const width = 760, height = 280, pad = { left: 54, right: 18, top: 20, bottom: 28 };
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    if (!fold || !fold.bins || !fold.bins.length) {
      svg.innerHTML = '<text x="50%" y="50%" fill="#88a2b4" text-anchor="middle" font-size="12">这段数据不足，无法绘图</text>';
      return;
    }
    const values = fold.bins.flatMap((row) => [Number(row[1]), Number(row[2]), Number(row[3])]).filter(Number.isFinite);
    const lower = percentile(values, 0.02), upper = percentile(values, 0.98);
    const center = (lower + upper) / 2;
    const extent = Math.max(150, (upper - lower) * 0.65);
    const minY = center - extent, maxY = center + extent;
    const x = (phase) => pad.left + (Number(phase) + 0.5) * (width - pad.left - pad.right);
    const y = (ppm) => pad.top + (maxY - Math.max(minY, Math.min(maxY, Number(ppm)))) / (maxY - minY) * (height - pad.top - pad.bottom);
    const line = fold.bins.map((row, index) => `${index ? "L" : "M"}${x(row[0]).toFixed(1)},${y(row[1]).toFixed(1)}`).join(" ");
    const top = fold.bins.map((row, index) => `${index ? "L" : "M"}${x(row[0]).toFixed(1)},${y(row[3]).toFixed(1)}`).join(" ");
    const bottom = [...fold.bins].reverse().map((row) => `L${x(row[0]).toFixed(1)},${y(row[2]).toFixed(1)}`).join(" ");
    const points = (fold.points || []).map((row) => `<circle cx="${x(row[0]).toFixed(1)}" cy="${y(row[1]).toFixed(1)}" r="1.15" fill="#56798a" opacity=".22"/>`).join("");
    const vertical = [-0.5, -0.25, 0, 0.25, 0.5].map((value) => `<line x1="${x(value)}" x2="${x(value)}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="rgba(126,174,197,.10)"/>`).join("");
    const horizontal = [minY, center, maxY].map((value) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}" stroke="rgba(126,174,197,.10)"/><text x="${pad.left - 8}" y="${y(value) + 3}" fill="#536f81" text-anchor="end" font-size="9">${Math.round(value)}</text>`).join("");
    svg.innerHTML = `${vertical}${horizontal}<text x="13" y="18" fill="#536f81" font-size="9">ppm</text>${points}<path d="${top} ${bottom} Z" fill="${color}" opacity=".09"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/><line x1="${x(0)}" x2="${x(0)}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="${color}" opacity=".42" stroke-dasharray="3 5"/>`;
  }

  function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
  }

  function revealVault() {
    if (!activeCandidate || vaultRevealed || !currentResult.strict_holdout) return;
    vaultRevealed = true;
    $(".vault-chart-wrap").classList.add("revealed");
    $("#vaultVerdict").hidden = false;
    const branches = activeCandidate.holdout_supporting_branches || [];
    $("#vaultVerdict").innerHTML = branches.length
      ? `<b>封存数据给出支持。</b> ${branches.length} 条处理支路在预测位置看到变暗。这是周期可外推的加分证据，不是行星确认。`
      : "<b>封存数据没有给出明确支持。</b> 这个周期的外推还没通过，应保留为证据不足。";
    ui.reveal.hidden = true;
  }

  ui.form.addEventListener("submit", (event) => { event.preventDefault(); createJob(); });
  $$(".target-chip").forEach((chip) => chip.addEventListener("click", () => {
    ui.input.value = chip.dataset.target;
    ui.mission.value = chip.dataset.mission;
    showToast("已填入示例目标；点“实时扫描”才会现场计算。");
  }));
  ui.reveal.addEventListener("click", revealVault);
  $("#consoleToggle").addEventListener("click", (event) => {
    const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
    event.currentTarget.setAttribute("aria-expanded", String(!expanded));
    event.currentTarget.querySelector("span").textContent = expanded ? "展开过程" : "收起过程";
    event.currentTarget.querySelector("i").textContent = expanded ? "+" : "−";
    ui.agentBody.hidden = expanded;
  });
  $("#copyAgentLog").addEventListener("click", async () => {
    const events = Array.isArray(latestJob?.events) ? latestJob.events : [];
    const text = events.map((event) => {
      const command = event.command ? `\n$ ${event.command}` : "";
      const metrics = Object.entries(event.metrics || {}).map(([key, value]) => `${key}=${metricValue(value)}`).join(" ");
      return `[${eventTime(event.at)}] [${stageNames[event.stage] || event.stage}] ${event.title}\n${event.message || ""}${command}${metrics ? `\n${metrics}` : ""}`;
    }).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("真实计算日志已复制");
    } catch (_error) {
      showToast("浏览器不允许复制，请手动选择日志");
    }
  });
  $("#modeSwitch").addEventListener("click", (event) => {
    const pressed = event.currentTarget.getAttribute("aria-pressed") !== "true";
    event.currentTarget.setAttribute("aria-pressed", String(pressed));
    document.body.classList.toggle("expert-mode", pressed);
    showToast(pressed ? "已切换到专业模式" : "已切换到小白模式");
  });
  window.addEventListener("resize", () => {
    if (activeCandidate) {
      renderFold($("#discoveryChart"), activeCandidate.fold?.discovery, "#ffd36d");
      renderFold($("#holdoutChart"), activeCandidate.fold?.holdout, "#b99cff");
    }
  });

  checkHealth();
  setInterval(updateAgentClock, 1000);
})();
