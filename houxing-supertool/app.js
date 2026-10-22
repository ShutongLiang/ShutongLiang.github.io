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
  let apiBase = "";
  const foldPlots = new Map();

  const apiCandidates = ["127.0.0.1", "localhost"].includes(window.location.hostname)
    ? ["", "http://127.0.0.1:8765"]
    : ["http://127.0.0.1:8765"];

  function apiUrl(path) {
    return `${apiBase}${path}`;
  }

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
    preparing: "分折", searching: "搜索", matching: "跨折匹配", validating: "固定复测",
    ranking: "排序", vetting: "物理标注", pixel_download: "像素下载", pixel_vetting: "像素定位",
    catalog: "查重", rendering: "制图", complete: "完成", failed: "错误"
  };

  const metricNames = {
    mission: "任务", target: "目标", found: "发现产品", selected: "选用观测段",
    mode: "模式", segment: "观测段", cadence_s: "采样秒", files: "文件",
    point_cap: "单段点数上限", discovery_segments: "发现段", holdout_segment: "封存段",
    holdout_segments: "封存段", selection_used_flux: "选段是否看亮度",
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
    storage: "存储", cache: "缓存", sealed_passed: "封存通过",
    sealed_rejected: "封存未过", harmonics_added: "倍周期修正"
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
    for (const base of apiCandidates) {
      try {
        const response = await fetch(`${base}/api/health`, { cache: "no-store" });
        if (!response.ok) continue;
        const health = await response.json();
        apiBase = base;
        setEngineState(true, `VLora ${health.version || ""} 已连接 · Passport 存储`);
        ui.message.innerHTML = `<b>可以开始</b><br />真实数据将交给本机 VLora 执行层完整计算。`;
        const remembered = new URLSearchParams(window.location.search).get("job") || localStorage.getItem("vlora-live-job");
        if (remembered) pollJob(remembered, true);
        return;
      } catch (_error) {
        // Try the next loopback endpoint.
      }
    }
    setEngineState(false, "未连接 Mac 上的 VLora 执行层");
    ui.message.innerHTML = '<b>需要先启动 VLora</b><br />双击工具包里的 run_vlora_bridge.command，页面会自动连接。';
    ui.empty.querySelector("h2").textContent = "专业工作台已就绪";
    ui.empty.querySelector("p").innerHTML = '启动 Mac 上的 <code>run_vlora_bridge.command</code> 后，这个 GitHub 页面会直接提交真实 TESS 任务；科学计算不在浏览器里偷工减料。';
  }

  function stageIndex(stage) {
    if (["discovering", "starting", "queued"].includes(stage)) return 0;
    if (["downloading", "preparing"].includes(stage)) return 1;
    if (stage === "searching") return 2;
    if (["matching", "validating", "ranking", "vetting", "pixel_download", "pixel_vetting"].includes(stage)) return 3;
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
      showToast("请输入正式 TOI 名称或 TIC 编号");
      ui.input.focus();
      return;
    }
    if (ui.mode.value === "deep") {
      const confirmed = window.confirm(
        "VLora Pro Max 会对少量 FFI 观测段进行极精细的完整搜索，任务可能运行数小时。\n\n它适合 FFI 不多、需要深度复核的目标，不适合快速演示。确定继续吗？"
      );
      if (!confirmed) return;
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
      const response = await fetch(apiUrl("/api/jobs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          target_number: target,
          mission: ui.mission.value,
          mode: ui.mode.value,
          engine: ui.mode.value === "deep" ? "promax" : "core"
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法创建任务");
      currentJobId = payload.id;
      localStorage.setItem("vlora-live-job", currentJobId);
      history.replaceState(null, "", `?job=${encodeURIComponent(currentJobId)}`);
      renderProgress(payload);
      pollJob(currentJobId);
    } catch (error) {
      renderFailure(error.message);
      ui.button.disabled = false;
    } finally {
      ui.button.querySelector("span").textContent = ui.mode.value === "deep" ? "运行 Pro Max" : "运行 VLora";
    }
  }

  async function pollJob(jobId, quiet = false) {
    currentJobId = jobId;
    clearTimeout(pollTimer);
    try {
      const response = await fetch(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}`), { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 404 && quiet) {
          localStorage.removeItem("vlora-live-job");
          return;
        }
        throw new Error("读取任务状态失败");
      }
      const job = await response.json();
      renderProgress(job);
      if (job.status === "complete" && job.result) {
        localStorage.removeItem("vlora-live-job");
        ui.button.disabled = false;
        if (job.result.result_url && !job.result.candidates) {
          ui.message.innerHTML = "<b>计算完成</b><br />正在读取完整候选账本与科学图。";
          const resultResponse = await fetch(apiUrl(job.result.result_url), { cache: "no-store" });
          if (!resultResponse.ok) throw new Error("完整结果读取失败");
          renderResult(await resultResponse.json());
        } else {
          renderResult(job.result);
        }
        return;
      }
      if (job.status === "failed") {
        localStorage.removeItem("vlora-live-job");
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
    const blocks = result.temporal_blocks || [];
    const threeFold = (result.cross_validation?.folds_run || 0) === 3;
    $("#targetSummary").textContent = `这份结果由 VLora ${result.engine_version || "engine"} 现场计算。${threeFold ? "三个互不重叠的时间块分别完整搜索，跨折匹配后使用同一套星历复测。" : "候选使用锁定星历复测。"}双星与像素检查只加风险标签，不会删除、改周期或改排名。`;
    $("#targetMeta").innerHTML = [
      ["完整搜索观测段", result.search_segments?.length ? result.search_segments.join(" · ") : "—"],
      ["独立时间折", blocks.length ? blocks.map((row) => `#${row.block}: ${row.segments.join("/")}`).join(" · ") : "—"],
      ["完整保留候选", `${(result.candidates || []).length} 个`],
      ["现算用时", `${fmt((result.runtime_seconds || 0) / 60, 1)} 分钟`]
    ].map(([label, value]) => `<div><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join("");

    renderAnswers(result.catalog_answers || []);
    const candidates = result.candidates || [];
    renderReport(result, candidates);
    renderTimeline(candidates, result.timeline_segments || []);
    if (!candidates.length) {
      ui.candidateList.innerHTML = '<div class="no-candidates">当前数据没有生成可靠周期候选。这不等于证明没有行星。</div>';
      $("#candidateDetail").hidden = true;
      return;
    }
    ui.candidateList.innerHTML = candidates.map((candidate, index) => {
      const match = candidate.known_match;
      const review = candidate.vetting_summary?.label_zh || "等待复核";
      return `<button class="candidate-card ${index === 0 ? "active" : ""} ${match ? "known-hit" : ""}" type="button" data-index="${index}">
        <small>NO. ${String(candidate.rank).padStart(2, "0")}</small>
        <strong>${fmt(candidate.period_days, 4)} <i>天</i></strong>
        <em class="candidate-answer ${match ? "hit" : "unknown"}">${match ? `✓ 对上 ${escapeHtml(match.name)}` : escapeHtml(review)}</em>
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

  function reportFilename(extension) {
    const identity = currentResult?.object || currentResult?.target || currentResult?.tic_id || "target";
    const safe = String(identity).trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "target";
    return `VLora-${safe}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  }

  function downloadBlob(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function csvValue(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  }

  function candidateReportRow(candidate) {
    const features = candidate.features || {};
    const validation = candidate.cross_validation || {};
    const repeatability = candidate.holdout_verification?.event_repeatability || {};
    const significance = candidate.detection_significance || {};
    const summary = candidate.vetting_summary || {};
    const foldNumbers = validation.matched_fold_numbers || [];
    const support = Number(repeatability.support_fraction);
    const riskFlags = summary.risk_flags || [];
    return {
      rank: candidate.rank ?? "—",
      period: candidate.period_days,
      epoch: candidate.epoch_btjd,
      duration: candidate.duration_hours,
      searchSnr: features.median_search_snr,
      mesLike: significance.null_calibrated_mes_like,
      depth: features.primary_depth_ppm,
      folds: foldNumbers.length ? foldNumbers.join("/") : `${validation.folds_measured || 0} 折`,
      eventSupport: Number.isFinite(support) ? `${(support * 100).toFixed(1)}%` : "—",
      vetting: summary.label_zh || summary.review_status || "待复核",
      risk: riskFlags.length > 0,
      catalog: candidate.known_match?.name || "未找到对应记录",
      candidateId: candidate.candidate_id || candidate.proposal_id || "—",
      physicalFlags: (summary.physical_flags || []).join(" | "),
      pixelStatus: summary.pixel_status || candidate.pixel_status || "not_run",
      significanceStatus: significance.status || "not_computed",
    };
  }

  function renderReport(result, candidates) {
    const algorithm = result.algorithm || {};
    const source = result.lightcurve_source || result.source_kind || result.photometry_branch || "—";
    const reportFields = [
      ["报告目标", result.object || result.target || "—"],
      ["TIC", result.tic_id || String(result.target || "").replace(/\D/g, "") || "—"],
      ["观测任务", result.mission || "TESS"],
      ["数据 / 测光来源", typeof source === "string" ? source : JSON.stringify(source)],
      ["VLora 引擎", result.engine_version || algorithm.version || ui.mode.value],
      ["完整观测段", (result.search_segments || []).join(" / ") || "—"],
      ["全部保留候选", `${candidates.length} 组`],
      ["任务 / 生成时间", `${currentJobId || "local"} · ${new Date().toLocaleString("zh-CN", { hour12: false })}`],
    ];
    $("#reportMeta").innerHTML = reportFields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`).join("");
    $("#ledgerRows").innerHTML = candidates.map((candidate) => {
      const row = candidateReportRow(candidate);
      const vettingClass = row.risk ? "risk" : "good";
      return `<tr>
        <td>${escapeHtml(row.rank)}</td><td>${fmt(row.period, 7)}</td><td>${fmt(row.epoch, 6)}</td><td>${fmt(row.duration, 3)}</td>
        <td>${fmt(row.searchSnr, 3)}</td><td>${fmt(row.mesLike, 3)}</td><td>${fmt(row.depth, 1)}</td>
        <td>${escapeHtml(row.folds)}</td><td>${escapeHtml(row.eventSupport)}</td>
        <td><span class="ledger-flag ${vettingClass}" title="${escapeHtml(`${row.vetting} / ${row.pixelStatus}`)}">${escapeHtml(row.vetting)}</span></td>
        <td>${escapeHtml(row.catalog)}</td>
      </tr>`;
    }).join("") || '<tr><td colspan="11">本次未生成可列入账本的周期候选。</td></tr>';
  }

  function exportCandidateCsv() {
    if (!currentResult) return;
    const header = ["rank", "candidate_id", "period_days", "epoch_btjd", "duration_hours", "median_search_snr", "red_noise_mes_like", "depth_ppm", "matched_folds", "event_support", "significance_status", "vetting_label", "physical_flags", "pixel_status", "catalog_match"];
    const rows = (currentResult.candidates || []).map((candidate) => {
      const row = candidateReportRow(candidate);
      return [row.rank, row.candidateId, row.period, row.epoch, row.duration, row.searchSnr, row.mesLike, row.depth, row.folds, row.eventSupport, row.significanceStatus, row.vetting, row.physicalFlags, row.pixelStatus, row.catalog].map(csvValue).join(",");
    });
    downloadBlob(`\ufeff${header.map(csvValue).join(",")}\n${rows.join("\n")}\n`, "text/csv;charset=utf-8", reportFilename("csv"));
  }

  function exportCompleteJson() {
    if (!currentResult) return;
    downloadBlob(JSON.stringify(currentResult, null, 2), "application/json;charset=utf-8", reportFilename("json"));
  }

  async function exportAuditLog() {
    const auditUrl = latestJob?.result?.audit_url;
    if (!auditUrl) {
      showToast("这个旧任务没有可下载的审计文件");
      return;
    }
    try {
      const response = await fetch(apiUrl(auditUrl), { cache: "no-store" });
      if (!response.ok) throw new Error("审计文件读取失败");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = reportFilename("audit.json.gz");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    } catch (error) {
      showToast(error.message);
    }
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
    const annotation = candidate.vetting_summary?.label_zh;
    if (candidate.known_match) return `这个周期对上了已知目录中的 ${candidate.known_match.name}。对照是候选和风险标签全部锁定后才做的。${annotation ? ` 后处理标注：${annotation}。` : ""}`;
    if (candidate.cross_validation?.passed) return `这个周期由不同时间折独立找到，并用同一套周期和历元在三折复测。${annotation ? ` 后处理标注：${annotation}。` : ""}`;
    if (candidate.holdout_verification?.passed) return "这个周期在没参与搜索的封存观测段中按时复现，已有资格进入正式候选排名。";
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
    const sealed = currentResult.holdout_segments || [currentResult.holdout_segment].filter((value) => value !== null && value !== undefined);
    $("#holdoutLabel").textContent = candidate.cross_validation?.passed ? "三折统一星历复测" : "固定星历复测";
    renderCatalogMatch(candidate);
    renderReasons(candidate);
    renderChecks(candidate);
    renderExpert(candidate);
    renderFold($("#discoveryChart"), candidate.fold?.discovery, "#ffd36d");
    renderFold($("#holdoutChart"), candidate.fold?.holdout, "#b99cff");
    const points = candidate.fold?.discovery?.point_count || 0;
    $("#discoveryCaption").textContent = candidate.cross_validation?.passed
      ? `系统先让三个时间折独立搜索，再锁定统一星历；图中展示 ${points.toLocaleString("zh-CN")} 个有效点。`
      : `仅使用发现段 ${currentResult.search_segments.join("、")} 搜索；这张相位图叠加了 ${points.toLocaleString("zh-CN")} 个有效点。`;
    $("#vaultVerdict").hidden = true;
    $("#vaultVerdict").innerHTML = "";
    $(".vault-chart-wrap").classList.remove("revealed");
    ui.reveal.hidden = false;
    ui.reveal.disabled = !candidate.fold?.holdout?.bins?.length;
    ui.reveal.querySelector("span").textContent = candidate.cross_validation?.passed ? "打开三折固定复测" : "打开固定复测";
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
    const sealedProof = candidate.holdout_verification || {};
    const reasons = [];
    reasons.push([
      branches.length >= 2 ? "多条路线互相印证" : "支持路线较少",
      branches.length ? `${branches.length} 条处理路线找到这个周期。` : "没有可读取的支路信息。",
      branches.length >= 2
    ]);
    reasons.push([
      sealedProof.passed ? "封存段按时变暗" : "封存支持不明确",
      currentResult.strict_holdout ? (sealedProof.passed ? `${sealedProof.sealed_segments_with_strong_support || 1} 个独立封存段在预测窗口复现了变暗。` : "封存观测段没有通过严格复现检查。") : "只有一个观测段，无法独立封存验证。",
      Boolean(sealedProof.passed)
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
      checkCard("奇偶事件", odd.available ? `${fmt(odd.difference_sigma, 2)} σ` : "数据不足", odd.veto ? "一深一浅，标记为可能食双星。" : "未触发奇偶深度风险标记。", state(odd)),
      checkCard("半周期次食", secondary.available ? `SNR ${fmt(secondary.snr, 2)}` : "数据不足", secondary.veto ? "半周期处有明显第二次变暗。" : "未触发次食风险标记。", state(secondary)),
      checkCard("凌日形状", shape.available ? `V=${fmt(shape.ingress_fraction, 2)}` : "数据不足", shape.veto ? "形状过尖，标记为可能掠食双星。" : "未触发形状风险标记。", state(shape)),
      checkCard("质心漂移", centroid.available ? `${fmt(centroid.significance, 2)} σ` : "数据不足", centroid.veto ? "变暗时光心明显移动。" : "未触发质心偏移风险标记。", state(centroid)),
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

  function renderFold(container, fold, color) {
    if (foldPlots.has(container.id)) {
      foldPlots.get(container.id).destroy();
      foldPlots.delete(container.id);
    }
    container.replaceChildren();
    if (!fold || !fold.bins || !fold.bins.length) {
      container.innerHTML = '<p class="plot-empty">这段数据不足，无法绘图</p>';
      return;
    }
    if (!window.uPlot) {
      container.innerHTML = '<p class="plot-empty">专业绘图组件 uPlot 加载失败</p>';
      return;
    }
    const bins = fold.bins
      .map((row) => row.slice(0, 4).map(Number))
      .filter((row) => row.every(Number.isFinite))
      .sort((a, b) => a[0] - b[0]);
    const values = bins.flatMap((row) => [row[1], row[2], row[3]]);
    const lower = percentile(values, 0.02), upper = percentile(values, 0.98);
    const center = (lower + upper) / 2;
    const extent = Math.max(150, (upper - lower) * 0.65);
    const minY = center - extent, maxY = center + extent;
    const phaseZeroPlugin = {
      hooks: {
        draw: [(plot) => {
          const x = Math.round(plot.valToPos(0, "x", true));
          const { ctx, bbox } = plot;
          ctx.save();
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.42;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.moveTo(x, bbox.top);
          ctx.lineTo(x, bbox.top + bbox.height);
          ctx.stroke();
          ctx.restore();
        }],
      },
    };
    const plot = new window.uPlot({
      width: Math.max(280, container.clientWidth || 760),
      height: container.id === "holdoutChart" ? 250 : 280,
      padding: [12, 10, 0, 4],
      scales: { x: { time: false, range: [-0.5, 0.5] }, y: { range: [minY, maxY] } },
      axes: [
        { stroke: "#6f8999", grid: { stroke: "rgba(126,174,197,.11)", width: 1 }, ticks: { stroke: "rgba(126,174,197,.18)" }, label: "Orbital phase", labelSize: 18, size: 34 },
        { stroke: "#6f8999", grid: { stroke: "rgba(126,174,197,.11)", width: 1 }, ticks: { stroke: "rgba(126,174,197,.18)" }, label: "Relative flux / ppm", labelSize: 18, size: 58 },
      ],
      series: [
        {},
        { label: "Binned median", stroke: color, width: 2.2, points: { show: false } },
        { label: "16th percentile", stroke: "rgba(0,0,0,0)", width: 0, points: { show: false } },
        { label: "84th percentile", stroke: "rgba(0,0,0,0)", width: 0, points: { show: false } },
      ],
      bands: [{ series: [2, 3], fill: color === "#ffd36d" ? "rgba(255,211,109,.12)" : "rgba(185,156,255,.12)" }],
      cursor: { drag: { x: true, y: false, setScale: false } },
      legend: { show: false },
      plugins: [phaseZeroPlugin],
    }, [bins.map((row) => row[0]), bins.map((row) => row[1]), bins.map((row) => row[2]), bins.map((row) => row[3])], container);
    foldPlots.set(container.id, plot);
  }

  function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
  }

  function revealVault() {
    if (!activeCandidate || vaultRevealed || !activeCandidate.fold?.holdout?.bins?.length) return;
    vaultRevealed = true;
    $(".vault-chart-wrap").classList.add("revealed");
    $("#vaultVerdict").hidden = false;
    const branches = activeCandidate.holdout_supporting_branches || [];
    const proof = activeCandidate.holdout_verification || {};
    const measurements = proof.block_measurements || [];
    $("#vaultVerdict").innerHTML = proof.passed
      ? `<b>统一星历在三折固定复测通过。</b> ${measurements.length || 3} 个时间块都使用同一周期和历元，未分折移动。这是候选证据，仍不等于确认行星。`
      : "<b>统一星历复测没有给出明确支持。</b> 候选仍保留在完整账本中，不会由后处理自动删除。";
    ui.reveal.hidden = true;
  }

  ui.form.addEventListener("submit", (event) => { event.preventDefault(); createJob(); });
  $$(".target-chip").forEach((chip) => chip.addEventListener("click", () => {
    ui.input.value = chip.dataset.target;
    ui.mission.value = chip.dataset.mission;
    showToast("已填入正式天文目标；点“运行 VLora”开始完整计算。");
  }));
  ui.mode.addEventListener("change", () => {
    const proMax = ui.mode.value === "deep";
    const hint = $("#engineHint");
    hint.dataset.engine = proMax ? "promax" : "core";
    hint.querySelector("b").textContent = proMax
      ? "VLora Pro Max · 非常耗时"
      : "VLora Core · 默认基础版";
    hint.querySelector("span").textContent = proMax
      ? "适合只有少量 FFI 观测段、需要极精细逐测光视图复核的目标；一次任务可能运行数小时。"
      : "使用全部可用观测段运行完整多折搜索，适合标准演示和日常目标。";
    ui.button.querySelector("span").textContent = proMax ? "运行 Pro Max" : "运行 VLora";
    if (proMax) showToast("Pro Max 是精细长任务，适合少量 FFI 观测段。");
  });
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
  $("#printReport").addEventListener("click", () => {
    if (!currentResult) return;
    window.print();
  });
  $("#downloadCsv").addEventListener("click", exportCandidateCsv);
  $("#downloadJson").addEventListener("click", exportCompleteJson);
  $("#downloadAudit").addEventListener("click", exportAuditLog);
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
