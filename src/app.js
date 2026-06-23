(() => {
  const TICKET_CSV = "./data/工单统一明细_260618.csv";
  const PROJECT_CSV = "./data/项目客诉专项跟进模板.csv";
  const TICKET_STORE = "workorder-dashboard-ticket-notes-v1";
  const PROJECT_STORE = "workorder-dashboard-project-notes-v1";

  const TABS = [
    { key: "summary", label: "单日总汇总表", type: "", kicker: "总览", hint: "汇总质量、供应、市场、支持四类工单。" },
    { key: "quality", label: "质量工单", type: "质量工单", kicker: "分类模块", hint: "质量客诉、上门服务、方案回复和结案情况。" },
    { key: "supply", label: "供应工单", type: "供应工单", kicker: "分类模块", hint: "供应异常、补发处理、方案回复和最终结案。" },
    { key: "market", label: "市场工单", type: "市场工单", kicker: "分类模块", hint: "市场服务、经销商问题、分公司处理和经理审核。" },
    { key: "support", label: "支持工单", type: "支持工单", kicker: "分类模块", hint: "资质文件、支持诉求、审核状态和处理跟进。" },
    { key: "project", label: "项目专项跟进", type: "", kicker: "项目专项", hint: "手动维护项目客诉或项目型工单推进阶段。" },
    { key: "import", label: "数据导入/刷新", type: "", kicker: "数据导入", hint: "上传每日 Excel/CSV，按工单号增量更新基础数据，人工维护字段不会被覆盖。" },
  ];

  const TICKET_TYPES = ["质量工单", "支持工单", "市场工单", "供应工单"];
  const IMPORT_TICKET_TYPES = ["质量工单", "供应工单", "市场工单", "支持工单"];
  const TICKET_EDIT_FIELDS = ["未结案原因", "当前卡点", "下一步规划", "预计闭环时间", "最新进展", "有卡点", "风险原因", "备注"];
  const BLOCK_FIELDS = ["未结案原因", "当前卡点", "下一步规划", "预计闭环时间", "最新进展"];
  const PROJECT_EDIT_FIELDS = ["项目名称", "关联工单号", "工单类型", "当前阶段", "寄回状态", "分析结论", "定责结论", "现场处理方案", "当前卡点", "下一步动作", "责任人", "预计完成时间", "最新进展"];
  const STAGES = [
    ["受理建档", 10],
    ["现场排查", 25],
    ["寄回分析", 45],
    ["分析定责", 60],
    ["方案确认", 75],
    ["现场处理", 90],
    ["闭环回访", 100],
  ];

  const state = {
    activeTab: "summary",
    tickets: [],
    projects: [],
    dataDate: "",
    ownerByTab: {},
    boardFilters: {},
    saveTimers: new Map(),
    drawerRows: [],
    rawTickets: [],
    rawProjects: [],
    manualFieldsByKey: new Map(),
    manualFieldsByNo: new Map(),
    projectFollowupsById: new Map(),
    importLogs: [],
    importResult: null,
    importError: "",
    importBusy: false,
    storageMode: "loading",
    storageMessage: "正在连接协作保存服务...",
  };

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindEvents();
    try {
      initializeEditorName();
      const [rawTickets, rawProjects, importLogs] = await Promise.all([
        loadBaseTickets(),
        loadRows(PROJECT_CSV, "projects"),
        loadImportLogs(),
      ]);
      state.rawTickets = rawTickets;
      state.rawProjects = rawProjects;
      state.importLogs = importLogs;
      state.dataDate = getMaxTicketDate(rawTickets);
      await loadSharedData();
      state.tickets = rawTickets.map((row) => normalizeRecord(row, state.dataDate));
      state.projects = rawProjects.map(normalizeProject);
      $("loadState").classList.add("is-hidden");
      render();
    } catch (error) {
      renderLoadError(error);
    }
  }

  function bindEvents() {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.ownerByTab[state.activeTab] = $("ownerFilter").value;
        state.activeTab = button.dataset.tab;
        render();
      });
    });

    $("ownerFilter").addEventListener("input", () => {
      state.ownerByTab[state.activeTab] = $("ownerFilter").value;
      renderTabContent();
    });

    $("searchInput").addEventListener("input", renderTabContent);

    $("editorName").addEventListener("input", () => {
      storage().setEditorName($("editorName").value);
    });

    $("refreshSharedData").addEventListener("click", refreshSharedData);

    $("resetFilters").addEventListener("click", () => {
      state.ownerByTab[state.activeTab] = "";
      $("ownerFilter").value = "";
      $("searchInput").value = "";
      render();
    });

    $("exportNotes").addEventListener("click", exportMaintainedFields);
    $("closeDrawer").addEventListener("click", closeDrawer);
    $("drawerBackdrop").addEventListener("click", closeDrawer);

    document.addEventListener("click", (event) => {
      const importButton = event.target.closest("#importTickets");
      if (importButton) {
        handleImportTickets();
        return;
      }

      const ownerDrill = event.target.closest("[data-owner-drill]");
      if (ownerDrill) {
        openOwnerDrill(ownerDrill.dataset.owner, ownerDrill.dataset.ownerDrill);
        return;
      }

      const ranking = event.target.closest("[data-ranking-owner]");
      if (ranking) {
        const owner = ranking.dataset.rankingOwner;
        openDetailDrawer(riskRows(filteredRows(), "高风险").filter((row) => row["制单人/创建人"] === owner), `${owner} 高风险工单明细`);
        return;
      }

      const detailRow = event.target.closest("[data-ticket-detail]");
      if (detailRow && !event.target.closest("textarea,input,select,button")) {
        const row = state.tickets.find((item) => (
          item["工单号"] === detailRow.dataset.ticketDetail
          && (!detailRow.dataset.ticketType || item["工单类型"] === detailRow.dataset.ticketType)
        ));
        if (row) openDetailDrawer([row], `工单 ${row["工单号"]}`);
        return;
      }

      const drill = event.target.closest("[data-drill]");
      if (drill) openDrill(drill.dataset.drill, drill.dataset.title || drill.textContent.trim());

      const typeRisk = event.target.closest("[data-type-risk-drill]");
      if (typeRisk) {
        openTypeRiskDrill(typeRisk.dataset.ticketType, typeRisk.dataset.riskKind);
      }
    });

    document.addEventListener("input", (event) => {
      const target = event.target;
      if (target.matches("[data-board-filter]")) {
        updateBoardFilter(target);
        return;
      }
      if (target.matches("[data-ticket-field]")) scheduleTicketSave(target);
      if (target.matches("[data-project-field]")) scheduleProjectSave(target);
    });

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (target.matches("[data-board-filter]")) {
        updateBoardFilter(target);
        return;
      }
      if (target.matches("[data-ticket-field]")) scheduleTicketSave(target, 0);
      if (target.matches("[data-project-field]")) scheduleProjectSave(target, 0);
    });
  }

  function initializeEditorName() {
    $("editorName").value = storage().getEditorName();
  }

  async function loadSharedData() {
    const [manual, projects] = await Promise.all([
      storage().loadManualFields(),
      storage().loadProjectFollowups(),
    ]);
    applyManualRecords(manual.records || []);
    applyProjectRecords(projects.records || []);
    const isLocal = manual.mode === "local" || projects.mode === "local";
    state.storageMode = isLocal ? "local" : "shared";
    state.storageMessage = isLocal
      ? "当前为本地保存模式，其他人不可见；请启动后端服务或检查部署配置。"
      : "协作保存已连接，人工维护内容会同步给其他同事。";
  }

  async function refreshSharedData() {
    $("refreshSharedData").disabled = true;
    $("refreshSharedData").textContent = "刷新中...";
    try {
      const [rawTickets, importLogs] = await Promise.all([loadBaseTickets(), loadImportLogs()]);
      state.rawTickets = rawTickets;
      state.importLogs = importLogs;
      state.dataDate = getMaxTicketDate(rawTickets);
      await loadSharedData();
      state.tickets = state.rawTickets.map((row) => normalizeRecord(row, state.dataDate));
      state.projects = state.rawProjects.map(normalizeProject);
      render();
    } finally {
      $("refreshSharedData").disabled = false;
      $("refreshSharedData").textContent = "刷新协作数据";
    }
  }

  function applyManualRecords(records) {
    state.manualFieldsByKey = new Map();
    state.manualFieldsByNo = new Map();
    records.forEach((record) => {
      if (!record) return;
      const fields = record.fields || {};
      if (record.ticketKey) state.manualFieldsByKey.set(record.ticketKey, fields);
      if (record.ticketNo && !record.ticketType) state.manualFieldsByNo.set(record.ticketNo, fields);
    });
  }

  function applyProjectRecords(records) {
    state.projectFollowupsById = new Map();
    records.forEach((record) => {
      if (record?.id) state.projectFollowupsById.set(record.id, record.fields || {});
    });
  }

  function readTicketManualFields(ticketType, ticketNo) {
    const key = storage().makeTicketKey(ticketType, ticketNo);
    return {
      ...storage().readLocalTicket(ticketNo),
      ...(state.manualFieldsByNo.get(ticketNo) || {}),
      ...(state.manualFieldsByKey.get(key) || {}),
    };
  }

  function readProjectFollowupFields(id) {
    return {
      ...storage().readLocalProject(id),
      ...(state.projectFollowupsById.get(id) || {}),
    };
  }

  function storage() {
    if (!window.WorkorderStorage) throw new Error("协作存储模块未加载");
    return window.WorkorderStorage;
  }

  async function fetchText(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`无法读取 ${path}`);
    return response.text();
  }

  async function loadRows(path, embeddedKey) {
    const embedded = window.WORKORDER_EMBEDDED_DATA;
    if (window.location.protocol === "file:" && embedded && Array.isArray(embedded[embeddedKey])) {
      return embedded[embeddedKey];
    }
    try {
      return parseCsv(await fetchText(path));
    } catch (error) {
      if (embedded && Array.isArray(embedded[embeddedKey])) return embedded[embeddedKey];
      throw error;
    }
  }

  async function loadBaseTickets() {
    const response = await storage().loadTickets();
    const embeddedRows = await loadRows(TICKET_CSV, "tickets");
    if (response.records && (response.records.length || response.totalBaseTickets > 0)) {
      return mergeSharedTicketsWithEmbedded(response.records, embeddedRows, response.ticketTypes || []);
    }
    return embeddedRows;
  }

  function mergeSharedTicketsWithEmbedded(sharedRows, embeddedRows, sharedTypes = []) {
    const types = new Set((sharedTypes.length ? sharedTypes : sharedRows.map((row) => row["工单类型"])).filter(Boolean));
    const keptEmbeddedRows = embeddedRows.filter((row) => !types.has(row["工单类型"]));
    return [...sharedRows, ...keptEmbeddedRows];
  }

  async function loadImportLogs() {
    const response = await storage().loadImportLogs();
    return response.records || [];
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === "\"") {
        if (inQuotes && next === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(field);
        field = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") continue;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        continue;
      }

      field += char;
    }

    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }

    const headers = (rows.shift() || []).map((header, index) => {
      const cleanHeader = index === 0 ? header.replace(/^\uFEFF/, "") : header;
      return cleanHeader.trim();
    });

    return rows
      .filter((cells) => cells.some((cell) => clean(cell) !== ""))
      .map((cells) => {
        const record = {};
        headers.forEach((header, index) => {
          record[header] = cells[index] ?? "";
        });
        return record;
      });
  }

  function normalizeRecord(row, dataDate) {
    const id = clean(row["工单号"] || row["客诉单号"] || row["单据编号"] || row["支持单号"]);
    const ticketType = clean(row["工单类型"]);
    const notes = readTicketManualFields(ticketType, id);
    const status = clean(row["单据状态"]);
    const workStatus = clean(row["工单状态"]);
    const owner = clean(row["制单人/创建人"] || row["处理人员"] || row["制单人"] || row["创建人"] || row["CC起草人"]);
    const orderTime = clean(row["制单时间"] || row["创建时间"]);
    const flowDays = getTicketAgeDays({ ...row, "制单时间": orderTime }, dataDate);
    const area = clean(row["区域"] || row["分公司/区域"] || row["分公司"] || row["分公司名称"] || row["客户省份名称"]);
    const customer = clean(row["客户名称"]);
    const contact = clean(row["联系人"] || row["联系人名称"]);
    const problem = clean(row["问题简述"] || row["投诉内容"] || row["反馈内容"] || row["投诉/问题现象"] || row["初步/处理回复"]);
    const phenomenon = clean(row["失效现象/问题类型"] || row["失效现象"] || row["问题类型"] || row["投诉/问题现象"]);
    const materialCode = firstClean(row, ["物料代码", "物料编码", "产品编码", "产品代码", "商品编码"]);
    const materialDescription = firstClean(row, ["物料描述", "产品描述", "产品名称", "型号", "产品型号", "产品"]);

    const record = {
      ...row,
      ...notes,
      "工单号": id,
      "工单号/客诉单号": id,
      "工单类型": ticketType,
      "制单人/创建人": owner,
      "处理人员": owner,
      "制单时间": orderTime,
      "单据状态": status,
      "工单状态": workStatus,
      "已流转天数": flowDays,
      "未结案天数": flowDays,
      "区域": area,
      "客户名称": customer,
      "联系人": contact,
      "联系电话": clean(row["联系电话"] || row["联系人电话"]),
      "客户/联系人": [customer, contact].filter(Boolean).join(" / "),
      "问题简述": problem,
      "投诉/问题现象": phenomenon,
      "投诉内容": problem,
      "失效现象/问题类型": phenomenon,
      "物料代码": materialCode,
      "物料描述": materialDescription,
      materialCode,
      materialDescription,
      "产品型号": materialDescription,
      "关键字段状态": clean(row["关键字段状态"] || row["处理方案回复"] || row["最终结案/工程师结案"] || row["初步/处理回复"]),
      "有卡点": clean(notes["有卡点"] || row["有卡点"]),
      "风险原因": clean(notes["风险原因"] || row["风险原因"]),
      "备注": clean(notes["备注"] || row["备注"]),
      "更新时间": notes["更新时间"] || clean(row["更新时间"]),
    };

    record["风险等级"] = calculateRiskLevel(record);
    return record;
  }

  function normalizeProject(row) {
    const id = clean(row["项目记录ID"] || row["关联工单号"] || row["项目名称"]);
    const notes = readProjectFollowupFields(id);
    const merged = { ...row, ...notes };
    const stage = clean(merged["当前阶段"]) || "受理建档";
    const progress = stageProgress(stage) || percentToNumber(merged["项目进度"]) || 10;

    return {
      ...merged,
      "项目记录ID": id,
      "关联工单号": clean(merged["关联工单号"] || id),
      "项目名称": clean(merged["项目名称"]),
      "工单类型": clean(merged["工单类型"]),
      "处理人员": clean(merged["处理人员"] || merged["责任人"]),
      "责任人": clean(merged["责任人"] || merged["处理人员"]),
      "当前阶段": stage,
      "项目进度": `${progress}%`,
      "更新时间": notes["更新时间"] || clean(merged["更新时间"]),
    };
  }

  function render() {
    renderTabs();
    renderToolbar();
    renderTabContent();
  }

  function renderTabs() {
    const active = currentTab();
    $("pageTitle").textContent = active.label;
    $("dataDate").textContent = state.dataDate || "未知";
    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === state.activeTab);
    });
  }

  function renderToolbar() {
    const active = currentTab();
    $("moduleKicker").textContent = active.kicker;
    $("moduleTitle").textContent = active.label;
    $("moduleHint").textContent = active.hint;
    $("storageStatus").textContent = state.storageMessage;
    $("storageStatus").className = `storage-status ${state.storageMode === "local" ? "is-local" : "is-shared"}`;

    const ownerFilter = $("ownerFilter");
    const currentValue = state.ownerByTab[state.activeTab] || "";
    const owners = getOwnerList(currentTab().key === "project" ? filteredProjects(false) : scopeRows(false));
    ownerFilter.innerHTML = `<option value="">全部人员</option>${owners.map((owner) => `<option value="${escAttr(owner)}">${esc(owner)}</option>`).join("")}`;
    ownerFilter.value = owners.includes(currentValue) ? currentValue : "";
    state.ownerByTab[state.activeTab] = ownerFilter.value;
  }

  function renderTabContent() {
    const active = currentTab();
    renderToolbar();
    if (active.key === "project") {
      $("tabContent").innerHTML = renderProjectFollowUpTab(filteredProjects());
    } else if (active.key === "import") {
      $("tabContent").innerHTML = renderImportTab();
    } else if (active.key === "summary") {
      $("tabContent").innerHTML = renderSummaryTab(filteredRows());
    } else {
      $("tabContent").innerHTML = renderTypeTab(active, filteredRows());
    }
  }

  function currentTab() {
    return TABS.find((tab) => tab.key === state.activeTab) || TABS[0];
  }

  function scopeRows(includeSearchAndOwner = true) {
    const active = currentTab();
    let rows = getActiveRecords(state.tickets);
    if (active.type) rows = rows.filter((row) => row["工单类型"] === active.type);
    if (!includeSearchAndOwner) return uniqueRows(rows);
    return filterRows(rows);
  }

  function filteredRows() {
    return uniqueRows(filterRows(scopeRows(false)));
  }

  function filterRows(rows) {
    const owner = $("ownerFilter").value;
    const query = clean($("searchInput").value).toLowerCase();
    return uniqueRows(rows).filter((row) => {
      if (owner && (row["制单人/创建人"] || row["处理人员"]) !== owner) return false;
      if (!query) return true;
      return [
        row["工单类型"],
        row["工单号"],
        row["制单人/创建人"],
        row["处理人员"],
        row["客户名称"],
        row["分公司/区域"],
        row["失效现象/问题类型"],
        row["物料代码"],
        row["物料描述"],
        row.materialCode,
        row.materialDescription,
        row["投诉/问题现象"],
        row["投诉内容"],
        row["未结案原因"],
        row["当前卡点"],
        row["下一步规划"],
        row["最新进展"],
      ].join(" ").toLowerCase().includes(query);
    });
  }

  function renderSummaryTab(rows) {
    const kpis = getSummaryKpis(rows);

    return `
      <section class="card-grid summary-cards">
        ${metricCard("总工单数", kpis.total, "单据状态不等于已结束")}
        ${metricCard("质量工单数", kpis.quality, "质量工单")}
        ${metricCard("支持工单数", kpis.support, "支持工单")}
        ${metricCard("市场工单数", kpis.market, "市场工单")}
        ${metricCard("供应工单数", kpis.supply, "供应工单")}
        ${drillCard("高风险工单数", kpis.high, "已流转天数 > 10 天", "high", "高风险工单明细")}
        ${drillCard("中风险工单数", kpis.medium, "已流转天数 > 6 天", "medium", "中风险工单明细")}
        ${drillCard("有卡点工单数", kpis.blocked, "人工维护字段有内容或已标记", "blocked", "有卡点工单明细")}
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">类型对比</p>
            <h2>各类型工单风险对比</h2>
            <p class="board-note">点击工单类型或风险数字，可下探查看对应工单明细。</p>
          </div>
        </div>
        ${renderTypeRiskComparison(rows)}
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">人员维度</p>
            <h2>人员工单风险汇总</h2>
          </div>
        </div>
        ${renderOwnerRiskTable(rows)}
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">排名</p>
            <h2>人员高风险工单数排名</h2>
          </div>
        </div>
        ${renderHighRiskRanking(rows)}
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">TOP</p>
            <h2>TOP长周期未完结工单</h2>
          </div>
        </div>
        ${renderTopLongCycleTable(rows)}
      </section>
      ${renderBlockedSection(rows)}
      ${renderDetailBoard(rows)}
    `;
  }

  function renderTypeTab(tab, rows) {
    const statusStats = getTypeKpis(rows);

    return `
      <section class="card-grid status-cards">
        ${metricCard("工单总数", rows.length, "当前类型工单去重数量")}
        ${metricCard("制单", statusStats.created, "单据状态 = 制单")}
        ${metricCard("已派工", statusStats.dispatched, "工单状态 = 已派工")}
        ${metricCard(statusStats.acceptedLabel, statusStats.accepted, "按实际字段匹配")}
        ${metricCard("已预约", statusStats.appointed, "工单状态 = 已预约")}
        ${metricCard("服务中", statusStats.serving, "工单状态 = 服务中")}
        ${metricCard("暂不需上门", statusStats.noVisit, "工单状态为空或暂不需上门")}
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">风险概览</p>
            <h2>${esc(tab.label)}风险结构</h2>
          </div>
        </div>
        <div class="risk-overview">
          ${drillCard("高风险", riskRows(rows, "高风险").length, "已流转天数 > 10 天", "high", `${tab.label}高风险明细`)}
          ${drillCard("中风险", riskRows(rows, "中风险").length, "已流转天数 > 6 天", "medium", `${tab.label}中风险明细`)}
          ${drillCard("低风险", riskRows(rows, "低风险").length, "4 天内或正常周期", "low", `${tab.label}低风险明细`)}
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">排名</p>
            <h2>人员高风险工单数排名</h2>
          </div>
        </div>
        ${renderHighRiskRanking(rows)}
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">高风险</p>
            <h2>高风险工单清单</h2>
          </div>
        </div>
        ${renderHighRiskEditableList(rows)}
      </section>
      ${renderBlockedSection(rows)}
      ${renderDetailBoard(rows)}
    `;
  }

  function metricCard(label, value, note) {
    return `
      <article class="metric-card">
        <span>${esc(label)}</span>
        <b>${esc(value)}</b>
        <small>${esc(note)}</small>
      </article>
    `;
  }

  function drillCard(label, value, note, kind, title) {
    return `
      <article class="metric-card drill-card">
        <span>${esc(label)}</span>
        <b>${esc(value)}</b>
        <small>${esc(note)}</small>
        <button class="text-button" type="button" data-drill="${escAttr(kind)}" data-title="${escAttr(title)}">下探查看</button>
      </article>
    `;
  }

  function renderOwnerRiskTable(records) {
    const items = getOwnerRiskSummary(records);
    if (!items.length) return emptyState("当前筛选下没有人员数据。");

    return `
      <div class="table-wrap compact-wrap">
        <table class="compact-table">
          <thead>
            <tr><th>人员</th><th>总工单数量</th><th>高风险</th><th>中风险</th><th>低风险</th><th>卡点</th></tr>
          </thead>
          <tbody>
            ${items.map((item) => `
              <tr>
                <td><b>${esc(item.owner)}</b></td>
                <td>${drillNumber(item.total, item.owner, "all")}</td>
                <td>${drillNumber(item.high, item.owner, "high", "high")}</td>
                <td>${drillNumber(item.medium, item.owner, "medium", "medium")}</td>
                <td>${drillNumber(item.low, item.owner, "low", "low")}</td>
                <td>${drillNumber(item.blocked, item.owner, "blocked")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderHighRiskRanking(records) {
    const items = getHighRiskRanking(records);
    if (!items.length) return emptyState("当前筛选下没有高风险工单。");
    const max = Math.max(1, ...items.map((item) => item.count));
    return `
      <div class="ranking-list">
        ${items.map((item) => `
          <button class="ranking-row" type="button" data-ranking-owner="${escAttr(item.owner)}">
            <span class="ranking-name">${esc(item.owner)}</span>
            <span class="ranking-track"><i style="width:${Math.round((item.count / max) * 100)}%"></i></span>
            <b>${item.count}</b>
          </button>
        `).join("")}
      </div>
    `;
  }

  function drillNumber(value, owner, kind, riskClassName = "") {
    return `<button class="number-link ${riskClassName}" type="button" data-owner="${escAttr(owner)}" data-owner-drill="${escAttr(kind)}">${value}</button>`;
  }

  function renderTypeRiskComparison(records) {
    const items = getTypeRiskComparison(records);
    if (!items.some((item) => item.total > 0)) return emptyState("当前筛选下没有工单类型风险数据。");

    return `
      <div class="table-wrap type-risk-wrap">
        <table class="type-risk-table">
          <thead>
            <tr>
              <th>工单类型</th>
              <th>总工单数</th>
              <th>高风险</th>
              <th>中风险</th>
              <th>低风险</th>
              <th>风险占比</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item) => `
              <tr class="${item.isMostRisky ? "is-risk-focus" : ""}">
                <td>
                  <button class="type-risk-name" type="button" data-type-risk-drill data-ticket-type="${escAttr(item.type)}" data-risk-kind="total">
                    ${esc(item.label)}
                  </button>
                  ${item.isMostRisky ? `<span class="risk-focus-badge">风险最集中</span>` : ""}
                </td>
                <td>${typeRiskButton(item.total, item.type, "total")}</td>
                <td>${typeRiskButton(item.high, item.type, "high", "high")}</td>
                <td>${typeRiskButton(item.medium, item.type, "medium", "medium")}</td>
                <td>${typeRiskButton(item.low, item.type, "low", "low")}</td>
                <td>${renderRiskStack(item)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function typeRiskButton(value, type, riskKind, className = "") {
    return `<button class="number-link ${className}" type="button" data-type-risk-drill data-ticket-type="${escAttr(type)}" data-risk-kind="${escAttr(riskKind)}">${value}</button>`;
  }

  function renderRiskStack(item) {
    const segments = [
      ["high", "高", item.high],
      ["medium", "中", item.medium],
      ["low", "低", item.low],
      ["watch", "关注", item.watch],
    ];
    return `
      <div class="risk-stack" aria-label="${escAttr(item.label)}风险占比">
        ${segments.map(([kind, label, count]) => {
          const width = item.total ? Math.round((count / item.total) * 100) : 0;
          const styleWidth = count > 0 ? Math.max(width, 5) : 0;
          return `<button class="risk-stack-segment ${kind}" type="button" style="width:${styleWidth}%" title="${escAttr(`${label}风险 ${count} 单`)}" data-type-risk-drill data-ticket-type="${escAttr(item.type)}" data-risk-kind="${escAttr(kind)}">${count > 0 ? esc(label) : ""}</button>`;
        }).join("")}
      </div>
    `;
  }

  function renderTop10Table(rows) {
    if (!rows.length) return emptyState("当前筛选下没有未完结工单。");
    return `
      <div class="table-wrap">
        <table class="top-table">
          <thead>
            <tr>
              <th>工单号</th>
              <th>制单人/创建人</th>
              <th>制单时间</th>
              <th>已流转天数</th>
              <th>单据状态</th>
              <th>工单状态</th>
              <th>未结案原因</th>
              <th>当前卡点</th>
              <th>下一步规划</th>
              <th>预计闭环时间</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td><b>${esc(row["工单号"])}</b></td>
                <td>${esc(row["制单人/创建人"])}</td>
                <td>${esc(row["制单时间"])}</td>
                <td>${esc(row["已流转天数"])} 天</td>
                <td>${esc(row["单据状态"] || "-")}</td>
                <td>${esc(row["工单状态"] || "-")}</td>
                <td>${clip(row["未结案原因"])}</td>
                <td>${clip(row["当前卡点"])}</td>
                <td>${clip(row["下一步规划"])}</td>
                <td>${esc(row["预计闭环时间"] || "-")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderTopLongCycleTable(records) {
    const rows = records
      .slice()
      .sort((a, b) => {
        const aHigh = a["风险等级"] === "高风险" ? 1 : 0;
        const bHigh = b["风险等级"] === "高风险" ? 1 : 0;
        return bHigh - aHigh || Number(b["已流转天数"]) - Number(a["已流转天数"]);
      })
      .slice(0, 10);

    if (!rows.length) return emptyState("当前筛选下没有工单。");
    return `
      <div class="table-wrap">
        <table class="top-table">
          <thead>
            <tr>
              <th>工单类型</th>
              <th>工单号/客诉单号</th>
              <th>制单人/创建人</th>
              <th>制单时间</th>
              <th>已流转天数</th>
              <th>单据状态</th>
              <th>工单状态</th>
              <th>问题简述</th>
              <th>未结案原因</th>
              <th>当前卡点</th>
              <th>下一步规划</th>
              <th>预计闭环时间</th>
              <th>最新进展</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr data-ticket-detail="${escAttr(row["工单号"])}" data-ticket-type="${escAttr(row["工单类型"])}">
                <td>${esc(row["工单类型"])}</td>
                <td><b>${esc(row["工单号/客诉单号"])}</b></td>
                <td>${esc(row["制单人/创建人"])}</td>
                <td>${esc(row["制单时间"])}</td>
                <td>${esc(row["已流转天数"])} 天</td>
                <td>${esc(row["单据状态"] || "-")}</td>
                <td>${esc(row["工单状态"] || "-")}</td>
                <td>${clip(row["问题简述"])}</td>
                <td>${clip(row["未结案原因"])}</td>
                <td>${clip(row["当前卡点"])}</td>
                <td>${clip(row["下一步规划"])}</td>
                <td>${esc(row["预计闭环时间"] || "-")}</td>
                <td>${clip(row["最新进展"])}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderHighRiskEditableList(records) {
    const rows = riskRows(records, "高风险").sort((a, b) => Number(b["已流转天数"]) - Number(a["已流转天数"]));
    return `
      <div class="table-wrap">
        <table class="high-risk-table">
          <thead>
            <tr>
              <th>客诉单号</th>
              <th>制单人</th>
              <th>制单时间</th>
              <th>问题简述</th>
              <th>是否有卡点</th>
              <th>风险原因</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row) => `
              <tr class="${isBlockerTracked(row) ? "has-blocker-row" : ""}" data-ticket-detail="${escAttr(row["工单号"])}" data-ticket-type="${escAttr(row["工单类型"])}">
                <td><b>${esc(row["工单号/客诉单号"])}</b></td>
                <td>${esc(ticketCreator(row) || "-")}</td>
                <td>${esc(row["制单时间"])}</td>
                <td>${clip(row["问题简述"])}</td>
                <td>${ticketBlockCheckbox(row)}</td>
                <td>${ticketTextarea(row, "风险原因")}</td>
                <td>${ticketTextarea(row, "备注")}<span class="save-status" data-save-status data-ticket-id="${escAttr(row["工单号"])}"></span></td>
              </tr>
            `).join("") : `<tr><td colspan="7" class="muted">当前筛选下没有高风险工单。</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderDetailBoard(records) {
    const filters = currentBoardFilters();
    const filtered = applyDetailBoardFilters(records);
    const riskOptions = ["高风险", "中风险", "低风险", "关注/待观察"];
    const statusOptions = uniq(records.map((row) => row["单据状态"]));
    const workStatusOptions = uniq(records.map((row) => row["工单状态"] || "空白"));
    const areaOptions = uniq(records.map((row) => row["区域"]));

    return `
      <section class="panel detail-board">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">明细</p>
            <h2>工单明细看板</h2>
            <p class="board-note">当前仅排除单据状态为“已结束”的工单，其余工单按当前流程节点展示。</p>
          </div>
        </div>
        <div class="board-filters">
          ${boardInput("search", "搜索", "制单人、工单号、现象、物料、问题简述", filters.search)}
          ${boardSelect("risk", "风险等级", riskOptions, filters.risk)}
          ${boardSelect("status", "单据状态", statusOptions, filters.status)}
          ${boardSelect("workStatus", "工单状态", workStatusOptions, filters.workStatus)}
          ${boardSelect("area", "区域", areaOptions, filters.area)}
        </div>
        ${renderDetailBoardTable(filtered)}
      </section>
    `;
  }

  function renderDetailBoardTable(rows) {
    if (!rows.length) return emptyState("当前筛选下没有工单明细。");
    return `
      <div class="table-wrap detail-board-wrap">
        <table class="detail-board-table">
          <thead>
            <tr>
              <th>风险等级</th>
              <th>制单人</th>
              <th>工单号/客诉单号</th>
              <th>已流转天数</th>
              <th>单据状态</th>
              <th>工单状态</th>
              <th>区域</th>
              <th>失效现象/问题类型</th>
              <th>物料代码</th>
              <th>物料描述</th>
              <th>关键字段状态</th>
              <th>问题简述/投诉内容</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr data-ticket-detail="${escAttr(row["工单号"])}" data-ticket-type="${escAttr(row["工单类型"])}">
                <td>${riskBadge(row["风险等级"])}</td>
                <td>${esc(row["制单人/创建人"] || "-")}</td>
                <td><b>${esc(row["工单号/客诉单号"])}</b></td>
                <td>${esc(row["已流转天数"])} 天</td>
                <td>${esc(row["单据状态"] || "-")}</td>
                <td>${esc(row["工单状态"] || "空白")}</td>
                <td>${esc(row["区域"] || "-")}</td>
                <td>${esc(row["失效现象/问题类型"] || "-")}</td>
                <td>${esc(row["物料代码"] || "-")}</td>
                <td>${esc(row["物料描述"] || "-")}</td>
                <td>${clip(row["关键字段状态"])}</td>
                <td>${clip(row["问题简述"])}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function boardInput(field, label, placeholder, value) {
    return `
      <label>
        <span>${esc(label)}</span>
        <input type="search" data-board-filter="${escAttr(field)}" placeholder="${escAttr(placeholder)}" value="${escAttr(value || "")}" />
      </label>
    `;
  }

  function boardSelect(field, label, options, value) {
    return `
      <label>
        <span>${esc(label)}</span>
        <select data-board-filter="${escAttr(field)}">
          <option value="">全部</option>
          ${options.map((option) => `<option value="${escAttr(option)}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function updateBoardFilter(target) {
    const filters = currentBoardFilters();
    filters[target.dataset.boardFilter] = target.value;
    state.boardFilters[state.activeTab] = filters;
    renderTabContent();
  }

  function currentBoardFilters() {
    if (!state.boardFilters[state.activeTab]) {
      state.boardFilters[state.activeTab] = { search: "", risk: "", status: "", workStatus: "", area: "" };
    }
    return state.boardFilters[state.activeTab];
  }

  function applyDetailBoardFilters(records) {
    const filters = currentBoardFilters();
    const query = clean(filters.search).toLowerCase();
    return records.filter((row) => {
      if (filters.risk && row["风险等级"] !== filters.risk) return false;
      if (filters.status && row["单据状态"] !== filters.status) return false;
      if (filters.workStatus && (row["工单状态"] || "空白") !== filters.workStatus) return false;
      if (filters.area && row["区域"] !== filters.area) return false;
      if (!query) return true;
      return [
        row["制单人/创建人"],
        row["工单号/客诉单号"],
        row["客户名称"],
        row["客户/联系人"],
        row["失效现象/问题类型"],
        row["物料代码"],
        row["物料描述"],
        row.materialCode,
        row.materialDescription,
        row["关键字段状态"],
        row["问题简述"],
        row["投诉内容"],
      ].join(" ").toLowerCase().includes(query);
    });
  }

  function renderBlockedSection(rows) {
    const blocked = blockedTicketRows(rows);
    return `
      <section class="panel blocker-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">卡点</p>
            <h2>卡点工单清单</h2>
            <p class="board-note">来源于人工勾选“有卡点”或已填写当前卡点的工单，人工字段会保存到 Supabase。</p>
          </div>
          <span class="panel-count">${blocked.length} 单</span>
        </div>
        ${renderBlockedTable(blocked)}
      </section>
    `;
  }

  function renderBlockedTable(rows) {
    if (!rows.length) return emptyState("当前筛选下没有卡点工单。");
    return `
      <div class="table-wrap">
        <table class="blocked-table">
          <thead>
            <tr>
              <th>工单类型</th>
              <th>客诉单号</th>
              <th>制单人</th>
              <th>制单时间</th>
              <th>已流转天数</th>
              <th>问题简述</th>
              <th>当前卡点</th>
              <th>下一步规划</th>
              <th>预计闭环时间</th>
              <th>最新进展</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="${isBlockerFlagged(row) ? "has-blocker-row" : ""}" data-ticket-detail="${escAttr(row["工单号"])}" data-ticket-type="${escAttr(row["工单类型"])}">
                <td>${esc(row["工单类型"])}</td>
                <td><b>${esc(row["工单号/客诉单号"])}</b></td>
                <td>${esc(ticketCreator(row) || "-")}</td>
                <td>${esc(row["制单时间"] || "-")}</td>
                <td>${esc(row["已流转天数"] || "0")} 天</td>
                <td>${clip(row["问题简述"])}</td>
                <td>${ticketTextarea(row, "当前卡点")}</td>
                <td>${ticketTextarea(row, "下一步规划")}</td>
                <td>${ticketDateEditor(row, "预计闭环时间")}</td>
                <td>${ticketTextarea(row, "最新进展")}</td>
                <td>${ticketTextarea(row, "备注")}<span class="save-status" data-save-status data-ticket-id="${escAttr(row["工单号"])}"></span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderProjectSection(rows) {
    if (!rows.length) {
      return `
        <section class="panel">
          <div class="panel-heading">
            <div>
              <p class="section-kicker">项目专项</p>
              <h2>项目客诉/项目型工单进度</h2>
            </div>
          </div>
          ${emptyState("当前筛选下没有项目专项跟进记录。")}
        </section>
      `;
    }

    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">项目专项</p>
            <h2>项目客诉/项目型工单进度</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table class="project-table">
            <thead>
              <tr>
                <th>项目名称</th>
                <th>关联工单号</th>
                <th>工单类型</th>
                <th>当前阶段</th>
                <th>项目进度条</th>
                <th>寄回状态</th>
                <th>分析结论</th>
                <th>定责结论</th>
                <th>现场处理方案</th>
                <th>当前卡点</th>
                <th>下一步动作</th>
                <th>责任人</th>
                <th>预计完成时间</th>
                <th>最新进展</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td>${projectTextEditor(row, "项目名称")}</td>
                  <td>${projectTextEditor(row, "关联工单号")}</td>
                  <td>${projectTextEditor(row, "工单类型")}</td>
                  <td>${projectStageEditor(row)}</td>
                  <td>${projectProgress(row)}</td>
                  <td>${projectTextEditor(row, "寄回状态")}</td>
                  <td>${projectTextEditor(row, "分析结论")}</td>
                  <td>${projectTextEditor(row, "定责结论")}</td>
                  <td>${projectTextEditor(row, "现场处理方案")}</td>
                  <td>${projectTextEditor(row, "当前卡点")}</td>
                  <td>${projectTextEditor(row, "下一步动作")}</td>
                  <td>${projectTextEditor(row, "责任人")}</td>
                  <td>${projectDateEditor(row, "预计完成时间")}</td>
                  <td>${projectTextEditor(row, "最新进展")}<span class="save-status" data-save-status data-project-id="${escAttr(projectKey(row))}"></span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderProjectFollowUpTab(rows) {
    return renderProjectSection(rows);
  }

  function renderImportTab() {
    return `
      <section class="panel import-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">每日刷新</p>
            <h2>导入 Excel / CSV 工单表</h2>
            <p class="board-note">只更新基础工单数据；风险原因、备注、卡点、下一步规划、预计闭环时间、最新进展等人工维护字段会按工单号保留。</p>
          </div>
        </div>
        <div class="import-form">
          <label>
            <span>工单类型</span>
            <select id="importTicketType">
              ${IMPORT_TICKET_TYPES.map((type) => `<option value="${escAttr(type)}">${esc(type)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>导入人/处理人员</span>
            <input id="importedBy" type="text" value="${escAttr(currentEditorName())}" placeholder="例如：张三" />
          </label>
          <label class="file-field">
            <span>上传文件</span>
            <input id="importFile" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" />
          </label>
          <button class="button" id="importTickets" type="button">导入并刷新看板</button>
        </div>
        <div id="importResult" class="import-result ${state.importError ? "is-error" : state.importResult ? "is-success" : ""}">
          ${renderImportResult()}
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">导入记录</p>
            <h2>最近导入日志</h2>
          </div>
        </div>
        ${renderImportLogs()}
      </section>
    `;
  }

  function renderImportResult() {
    if (state.importError) return esc(state.importError);
    if (state.importResult?.message) return esc(state.importResult.message);
    return "请选择工单类型、导入人和文件后开始导入。";
  }

  function renderImportLogs() {
    if (!state.importLogs.length) return emptyState("暂无导入记录。");
    return `
      <div class="table-wrap">
        <table class="import-log-table">
          <thead>
            <tr>
              <th>导入时间</th>
              <th>导入人</th>
              <th>工单类型</th>
              <th>文件名</th>
              <th>总数</th>
              <th>新增</th>
              <th>更新</th>
              <th>已结束剔除</th>
              <th>保留人工字段</th>
              <th>状态</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            ${state.importLogs.map((log) => `
              <tr>
                <td>${esc(formatDateTimeValue(log.importedAt))}</td>
                <td>${esc(log.importedBy || "-")}</td>
                <td>${esc(log.ticketType || "-")}</td>
                <td>${esc(log.fileName || "-")}</td>
                <td>${esc(log.totalRows ?? 0)}</td>
                <td>${esc(log.insertedCount ?? 0)}</td>
                <td>${esc(log.updatedCount ?? 0)}</td>
                <td>${esc(log.endedCount ?? 0)}</td>
                <td>${esc(log.preservedManualCount ?? 0)}</td>
                <td><span class="badge ${log.status === "success" ? "risk-low" : "risk-high"}">${esc(log.status === "success" ? "成功" : "失败")}</span></td>
                <td>${clip(log.message)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  async function handleImportTickets() {
    const file = $("importFile")?.files?.[0];
    const ticketType = $("importTicketType")?.value || "";
    const importedBy = clean($("importedBy")?.value) || currentEditorName();
    const button = $("importTickets");
    const resultBox = $("importResult");

    if (!file) {
      state.importResult = null;
      state.importError = "请先选择要导入的 Excel 或 CSV 文件。";
      renderTabContent();
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = "导入中...";
    }
    if (resultBox) {
      resultBox.className = "import-result is-saving";
      resultBox.textContent = "正在导入并合并基础工单数据...";
    }

    try {
      const result = await storage().importTickets({ ticketType, importedBy, file });
      state.importResult = result.summary || result.log || { message: "导入完成。" };
      state.importError = "";

      const [rawTickets, importLogs] = await Promise.all([loadBaseTickets(), loadImportLogs()]);
      state.rawTickets = rawTickets;
      state.importLogs = importLogs;
      state.dataDate = getMaxTicketDate(rawTickets);
      await loadSharedData();
      state.tickets = state.rawTickets.map((row) => normalizeRecord(row, state.dataDate));
      state.projects = state.rawProjects.map(normalizeProject);
      render();
    } catch (error) {
      state.importResult = null;
      state.importError = `导入失败：${parseErrorMessage(error)}`;
      state.importLogs = await loadImportLogs();
      renderTabContent();
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = "导入并刷新看板";
      }
    }
  }

  function openDrill(kind, title) {
    openDetailDrawer(drillRows(kind), title || "工单明细");
  }

  function openTypeRiskDrill(type, riskKind) {
    let rows = filteredRows().filter((row) => row["工单类型"] === type);
    const labels = {
      total: "全部未结束工单",
      high: "高风险工单",
      medium: "中风险工单",
      low: "低风险工单",
      watch: "关注/待观察工单",
    };
    const riskMap = {
      high: "高风险",
      medium: "中风险",
      low: "低风险",
      watch: "关注/待观察",
    };
    if (riskMap[riskKind]) rows = riskRows(rows, riskMap[riskKind]);
    openDetailDrawer(rows, `${type} ${labels[riskKind] || "工单明细"}`);
  }

  function openOwnerDrill(owner, kind) {
    let rows = filteredRows().filter((row) => row["制单人/创建人"] === owner);
    if (kind === "high") rows = riskRows(rows, "高风险");
    if (kind === "medium") rows = riskRows(rows, "中风险");
    if (kind === "low") rows = riskRows(rows, "低风险");
    if (kind === "blocked") rows = rows.filter(hasBlocked);
    const labels = { all: "全部工单", high: "高风险工单", medium: "中风险工单", low: "低风险工单", blocked: "卡点工单" };
    openDetailDrawer(rows, `${owner} ${labels[kind] || "工单明细"}`);
  }

  function openDetailDrawer(rows, title) {
    state.drawerRows = rows;
    $("drawerTitle").textContent = title || "工单明细";
    $("drawerKicker").textContent = currentTab().label;
    $("drawerBody").innerHTML = renderEditableDetailTable(rows);
    $("detailDrawer").hidden = false;
    $("drawerBackdrop").hidden = false;
  }

  function closeDrawer() {
    $("detailDrawer").hidden = true;
    $("drawerBackdrop").hidden = true;
    state.drawerRows = [];
    renderTabContent();
  }

  function drillRows(kind) {
    const rows = filteredRows();
    if (kind === "high") return riskRows(rows, "高风险");
    if (kind === "medium") return riskRows(rows, "中风险");
    if (kind === "low") return riskRows(rows, "低风险");
    if (kind === "blocked") return rows.filter(hasBlocked);
    if (kind === "top") return topOpenRows(rows, 10);
    return rows;
  }

  function renderEditableDetailTable(rows) {
    if (!rows.length) return emptyState("当前筛选下没有对应工单。");
    return `
      <div class="table-wrap drawer-table-wrap">
        <table class="detail-table">
          <thead>
            <tr>
              <th>工单类型</th>
              <th>工单号</th>
              <th>制单人/创建人</th>
              <th>制单时间</th>
              <th>已流转天数</th>
              <th>单据状态</th>
              <th>工单状态</th>
              <th>区域</th>
              <th>客户/联系人</th>
              <th>物料代码</th>
              <th>物料描述</th>
              <th>问题简述</th>
              <th>有卡点</th>
              <th>未结案原因</th>
              <th>当前卡点</th>
              <th>下一步规划</th>
              <th>预计闭环时间</th>
              <th>最新进展</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${esc(row["工单类型"])}</td>
                <td><b>${esc(row["工单号"])}</b></td>
                <td>${esc(row["制单人/创建人"])}</td>
                <td>${esc(row["制单时间"])}</td>
                <td>${esc(row["已流转天数"])} 天</td>
                <td>${esc(row["单据状态"] || "-")}</td>
                <td>${esc(row["工单状态"] || "-")}</td>
                <td>${esc(row["区域"] || "-")}</td>
                <td>${esc(row["客户/联系人"] || "-")}</td>
                <td>${esc(row["物料代码"] || "-")}</td>
                <td>${esc(row["物料描述"] || "-")}</td>
                <td>${clip(row["问题简述"])}</td>
                <td>${ticketBlockCheckbox(row)}</td>
                <td>${ticketTextarea(row, "未结案原因")}</td>
                <td>${ticketTextarea(row, "当前卡点")}</td>
                <td>${ticketTextarea(row, "下一步规划")}</td>
                <td>${ticketDateEditor(row, "预计闭环时间")}</td>
                <td>${ticketTextarea(row, "最新进展")}<span class="save-status" data-save-status data-ticket-id="${escAttr(row["工单号"])}"></span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function statusCardStats(rows) {
    const workStatuses = rows.map((row) => clean(row["工单状态"]));
    const hasAccepted = workStatuses.includes("已接单");
    const hasSettled = workStatuses.includes("已结单");
    let acceptedLabel = "已接单/已结单";
    if (hasAccepted && !hasSettled) acceptedLabel = "已接单";
    if (!hasAccepted && hasSettled) acceptedLabel = "已结单";

    return {
      created: rows.filter((row) => clean(row["单据状态"]) === "制单").length,
      dispatched: rows.filter((row) => clean(row["工单状态"]) === "已派工").length,
      accepted: rows.filter((row) => ["已接单", "已结单"].includes(clean(row["工单状态"]))).length,
      acceptedLabel,
      appointed: rows.filter((row) => clean(row["工单状态"]) === "已预约").length,
      serving: rows.filter((row) => clean(row["工单状态"]) === "服务中").length,
      noVisit: rows.filter((row) => clean(row["工单状态"]) === "").length,
    };
  }

  function filteredProjects(includeSearchAndOwner = true) {
    const active = currentTab();
    const owner = $("ownerFilter").value;
    const query = clean($("searchInput").value).toLowerCase();
    return state.projects.filter((row) => {
      if (active.type && row["工单类型"] !== active.type) return false;
      if (!includeSearchAndOwner) return true;
      if (owner && (row["责任人"] || row["处理人员"]) !== owner) return false;
      if (!query) return true;
      return Object.values(row).join(" ").toLowerCase().includes(query);
    });
  }

  function ticketTextarea(row, field) {
    return `<textarea data-ticket-id="${escAttr(row["工单号"])}" data-ticket-type="${escAttr(row["工单类型"])}" data-ticket-field="${escAttr(field)}" placeholder="${escAttr(field)}">${esc(row[field] || "")}</textarea>`;
  }

  function ticketDateEditor(row, field) {
    return `<input type="date" data-ticket-id="${escAttr(row["工单号"])}" data-ticket-type="${escAttr(row["工单类型"])}" data-ticket-field="${escAttr(field)}" value="${escAttr(dateOnly(row[field]))}" />`;
  }

  function ticketBlockCheckbox(row) {
    const checked = isBlockerFlagged(row) ? "checked" : "";
    return `
      <label class="check-cell">
        <input type="checkbox" data-ticket-id="${escAttr(row["工单号"])}" data-ticket-type="${escAttr(row["工单类型"])}" data-ticket-field="有卡点" value="是" ${checked} />
        <span>${checked ? "有卡点" : "无卡点"}</span>
      </label>
    `;
  }

  function projectStageEditor(row) {
    return `
      <select data-project-id="${escAttr(projectKey(row))}" data-project-field="当前阶段">
        ${STAGES.map(([stage]) => `<option value="${escAttr(stage)}" ${stage === row["当前阶段"] ? "selected" : ""}>${esc(stage)}</option>`).join("")}
      </select>
    `;
  }

  function projectProgress(row) {
    const progress = stageProgress(row["当前阶段"]) || percentToNumber(row["项目进度"]) || 10;
    return `
      <div class="project-progress">
        <div class="progress-track"><i style="width:${progress}%"></i></div>
        <b>${progress}%</b>
      </div>
    `;
  }

  function projectTextEditor(row, field) {
    return `<textarea data-project-id="${escAttr(projectKey(row))}" data-project-field="${escAttr(field)}" placeholder="${escAttr(field)}">${esc(row[field] || "")}</textarea>`;
  }

  function projectDateEditor(row, field) {
    return `<input type="date" data-project-id="${escAttr(projectKey(row))}" data-project-field="${escAttr(field)}" value="${escAttr(dateOnly(row[field]))}" />`;
  }

  function scheduleTicketSave(target, delay = 260) {
    const id = target.dataset.ticketId;
    const ticketType = target.dataset.ticketType;
    const field = target.dataset.ticketField;
    const value = target.type === "checkbox" ? (target.checked ? "是" : "") : target.value;
    const key = `ticket:${ticketType || ""}:${id}:${field}`;
    clearTimeout(state.saveTimers.get(key));
    state.saveTimers.set(key, setTimeout(() => saveTicketField(id, field, value, ticketType), delay));
  }

  function saveTicketField(id, field, value, ticketType = "") {
    if (!TICKET_EDIT_FIELDS.includes(field)) return;
    const row = state.tickets.find((item) => item["工单号"] === id && (!ticketType || item["工单类型"] === ticketType));
    if (!row) return;
    row[field] = value;
    row["更新时间"] = formatDateTime(new Date());
    showSaving("ticket", id);
    storage().saveManualField({
      ticketKey: storage().makeTicketKey(row["工单类型"], id),
      ticketType: row["工单类型"],
      ticketNo: id,
      fieldName: field,
      value,
      updatedBy: currentEditorName(),
    }).then((result) => {
      mergeManualRecord(result.record);
      state.storageMode = result.mode === "local" ? "local" : "shared";
      state.storageMessage = result.mode === "local"
        ? "当前为本地保存模式，其他人不可见；请启动后端服务或检查部署配置。"
        : "协作保存已连接，人工维护内容会同步给其他同事。";
      const fields = result.record?.fields || {};
      Object.assign(row, fields);
      showSaved("ticket", id, row["更新时间"], result.mode);
      if (field === "有卡点") renderTabContent();
      else renderToolbar();
    }).catch((error) => {
      console.error("Ticket field save failed.", error);
      showSaveFailed("ticket", id, error);
    });
  }

  function scheduleProjectSave(target, delay = 260) {
    const id = target.dataset.projectId;
    const field = target.dataset.projectField;
    const value = target.value;
    const key = `project:${id}:${field}`;
    clearTimeout(state.saveTimers.get(key));
    state.saveTimers.set(key, setTimeout(() => saveProjectField(id, field, value), delay));
  }

  function saveProjectField(id, field, value) {
    if (!PROJECT_EDIT_FIELDS.includes(field)) return;
    const row = state.projects.find((item) => projectKey(item) === id);
    if (!row) return;
    row[field] = value;
    if (field === "当前阶段") row["项目进度"] = `${stageProgress(value)}%`;
    row["更新时间"] = formatDateTime(new Date());
    showSaving("project", id);
    storage().saveProjectFollowup({
      ...row,
      id,
      updatedBy: currentEditorName(),
    }).then((result) => {
      mergeProjectRecord(result.record);
      state.storageMode = result.mode === "local" ? "local" : "shared";
      state.storageMessage = result.mode === "local"
        ? "当前为本地保存模式，其他人不可见；请启动后端服务或检查部署配置。"
        : "协作保存已连接，人工维护内容会同步给其他同事。";
      Object.assign(row, result.record?.fields || {});
      showSaved("project", id, row["更新时间"], result.mode);
      if (field === "当前阶段") renderTabContent();
      else renderToolbar();
    }).catch((error) => {
      console.error("Project followup save failed.", error);
      showSaveFailed("project", id, error);
    });
  }

  function showSaving(kind, id) {
    document.querySelectorAll("[data-save-status]").forEach((element) => {
      if (matchesSaveStatus(element, kind, id)) {
        element.className = "save-status is-saving";
        element.textContent = "保存中...";
      }
    });
  }

  function showSaved(kind, id, time, mode = "shared") {
    document.querySelectorAll("[data-save-status]").forEach((element) => {
      if (matchesSaveStatus(element, kind, id)) {
        element.className = "save-status is-saved";
        element.textContent = mode === "local" ? `已本地保存 ${time}` : `已保存 ${time}`;
      }
    });
  }

  function showSaveFailed(kind, id, error) {
    const message = formatSaveFailureMessage(error);
    document.querySelectorAll("[data-save-status]").forEach((element) => {
      if (matchesSaveStatus(element, kind, id)) {
        element.className = "save-status is-error";
        element.textContent = message;
        element.title = parseErrorMessage(error);
      }
    });
  }

  function formatSaveFailureMessage(error) {
    const detail = parseErrorMessage(error);
    if (!detail || detail === "未知错误") return "保存失败，请重试";
    return `保存失败：${detail.slice(0, 90)}`;
  }

  function matchesSaveStatus(element, kind, id) {
    if (kind === "ticket") return element.dataset.ticketId === id;
    if (kind === "project") return element.dataset.projectId === id;
    return false;
  }

  function mergeManualRecord(record) {
    if (!record) return;
    if (record.ticketKey) state.manualFieldsByKey.set(record.ticketKey, record.fields || {});
    if (record.ticketNo) state.manualFieldsByNo.set(record.ticketNo, record.fields || {});
  }

  function mergeProjectRecord(record) {
    if (record?.id) state.projectFollowupsById.set(record.id, record.fields || {});
  }

  function currentEditorName() {
    return clean($("editorName").value) || "未署名";
  }

  function projectKey(row) {
    return clean(row["项目记录ID"] || row["关联工单号"] || row["项目名称"]);
  }

  function exportMaintainedFields() {
    const local = storage().collectLocalExport();
    const payload = {
      exportedAt: formatDateTime(new Date()),
      storageMode: state.storageMode,
      tickets: [...state.manualFieldsByKey.entries()].map(([ticketKey, fields]) => ({ ticketKey, fields })),
      projects: [...state.projectFollowupsById.entries()].map(([id, fields]) => ({ id, fields })),
      localFallback: local,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `工单维护字段_${formatFileDate(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function readLocalRecord(namespace, id) {
    if (!id) return {};
    try {
      return JSON.parse(localStorage.getItem(`${namespace}:${id}`) || "{}") || {};
    } catch {
      return {};
    }
  }

  function writeLocalRecord(namespace, id, record) {
    localStorage.setItem(`${namespace}:${id}`, JSON.stringify(record));
  }

  function collectStore(namespace) {
    const rows = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(`${namespace}:`)) continue;
      const id = key.replace(`${namespace}:`, "");
      rows.push({ id, fields: readLocalRecord(namespace, id) });
    }
    return rows;
  }

  function renderLoadError(error) {
    $("loadState").classList.remove("is-hidden");
    $("loadState").innerHTML = `
      <b>数据读取失败。</b>
      <span class="muted">请检查 data 目录是否完整。错误信息：${esc(error.message)}</span>
    `;
  }

  function riskRows(rows, risk) {
    return rows.filter((row) => isActiveRecord(row) && row["风险等级"] === risk);
  }

  function topOpenRows(rows, limit) {
    return rows
      .filter(isActiveRecord)
      .slice()
      .sort((a, b) => Number(b["已流转天数"]) - Number(a["已流转天数"]))
      .slice(0, limit);
  }

  function isOpen(row) {
    return isActiveRecord(row);
  }

  function isClosedRecord(record) {
    return clean(record["单据状态"]) === "已结束";
  }

  function isActiveRecord(record) {
    return !isClosedRecord(record);
  }

  function getActiveRecords(records) {
    return uniqueRows(records.filter(isActiveRecord));
  }

  function calculateRiskLevel(record) {
    const days = getTicketAgeDays(record, state.dataDate);
    if (days > 10) return "高风险";
    if (days > 6) return "中风险";
    if (days <= 4) return "低风险";
    return "关注/待观察";
  }

  function getTicketAgeDays(record, dataDate = state.dataDate) {
    const direct = toNumber(record["已流转天数"], NaN);
    if (Number.isFinite(direct)) return direct;
    const legacy = toNumber(record["未结案天数"], NaN);
    if (Number.isFinite(legacy)) return legacy;
    return diffDays(dataDate, clean(record["制单时间"] || record["创建时间"]));
  }

  function getOwnerList(records) {
    return uniq(records.map((row) => row["制单人/创建人"] || row["处理人员"] || row["责任人"]));
  }

  function getSummaryKpis(records) {
    return {
      total: records.length,
      quality: records.filter((row) => row["工单类型"] === "质量工单").length,
      support: records.filter((row) => row["工单类型"] === "支持工单").length,
      market: records.filter((row) => row["工单类型"] === "市场工单").length,
      supply: records.filter((row) => row["工单类型"] === "供应工单").length,
      high: riskRows(records, "高风险").length,
      medium: riskRows(records, "中风险").length,
      blocked: records.filter(hasBlocked).length,
    };
  }

  function getTypeKpis(records) {
    return statusCardStats(records);
  }

  function getOwnerRiskSummary(records) {
    const groups = groupBy(records, (row) => row["制单人/创建人"] || "未指定");
    return Object.entries(groups)
      .map(([owner, ownerRows]) => ({
        owner,
        total: ownerRows.length,
        high: riskRows(ownerRows, "高风险").length,
        medium: riskRows(ownerRows, "中风险").length,
        low: riskRows(ownerRows, "低风险").length,
        blocked: ownerRows.filter(hasBlocked).length,
      }))
      .sort((a, b) => b.high - a.high || b.medium - a.medium || b.total - a.total);
  }

  function getHighRiskRanking(records) {
    return getOwnerRiskSummary(records)
      .filter((item) => item.high > 0)
      .map((item) => ({ owner: item.owner, count: item.high }));
  }

  function getTypeRiskComparison(records) {
    const items = TABS
      .filter((tab) => tab.type)
      .map((tab) => {
        const rows = records.filter((row) => row["工单类型"] === tab.type);
        const high = riskRows(rows, "高风险").length;
        const medium = riskRows(rows, "中风险").length;
        const low = riskRows(rows, "低风险").length;
        const watch = riskRows(rows, "关注/待观察").length;
        const riskDensity = rows.length ? (high + medium) / rows.length : 0;
        return {
          type: tab.type,
          label: tab.label,
          total: rows.length,
          high,
          medium,
          low,
          watch,
          riskDensity,
        };
      });
    const maxDensity = Math.max(0, ...items.map((item) => item.riskDensity));
    return items.map((item) => ({
      ...item,
      isMostRisky: item.total > 0 && item.riskDensity === maxDensity && maxDensity > 0,
    }));
  }

  function hasBlocked(row) {
    if (isBlockerFlagged(row)) return true;
    return BLOCK_FIELDS.some((field) => clean(row[field]) !== "");
  }

  function isBlockerFlagged(row) {
    const value = clean(row["有卡点"]).toLowerCase();
    return ["是", "有", "有卡点", "true", "1", "yes"].includes(value);
  }

  function isBlockerTracked(row) {
    return isBlockerFlagged(row) || clean(row["当前卡点"]) !== "";
  }

  function blockedTicketRows(records) {
    return records
      .filter(isBlockerTracked)
      .sort((a, b) => Number(b["已流转天数"] || 0) - Number(a["已流转天数"] || 0));
  }

  function ticketCreator(row) {
    return clean(row["制单人/创建人"] || row["制单人"] || row["创建人"] || row.creator || row["处理人员"]);
  }

  function riskBadge(risk) {
    if (risk === "高风险") return `<span class="badge risk-high">高风险</span>`;
    if (risk === "中风险") return `<span class="badge risk-medium">中风险</span>`;
    if (risk === "低风险") return `<span class="badge risk-low">低风险</span>`;
    if (risk === "关注/待观察") return `<span class="badge risk-watch">关注/待观察</span>`;
    return `<span class="badge risk-closed">${esc(risk || "已完结")}</span>`;
  }

  function clip(value) {
    const text = clean(value);
    if (!text) return `<span class="muted">-</span>`;
    return `<div class="clip-text" title="${escAttr(text)}">${esc(text)}</div>`;
  }

  function emptyState(text) {
    return `<div class="empty-state">${esc(text)}</div>`;
  }

  function percent(part, total) {
    if (!total) return "0%";
    return `${Math.round((part / total) * 100)}%`;
  }

  function groupBy(rows, getKey) {
    return rows.reduce((result, row) => {
      const key = getKey(row) || "未指定";
      if (!result[key]) result[key] = [];
      result[key].push(row);
      return result;
    }, {});
  }

  function uniqueRows(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const key = row["工单号"] || JSON.stringify(row);
      if (!map.has(key)) map.set(key, row);
    });
    return [...map.values()];
  }

  function uniq(values) {
    return [...new Set(values.map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function firstClean(row, fields) {
    for (const field of fields) {
      const value = clean(row[field]);
      if (value) return value;
    }
    return "";
  }

  function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function getMaxTicketDate(rows) {
    const dates = rows.map((row) => parseDate(row["制单时间"])).filter(Boolean);
    if (!dates.length) return formatDate(new Date());
    return formatDate(new Date(Math.max(...dates.map((date) => date.getTime()))));
  }

  function diffDays(laterDateText, earlierDateText) {
    const later = parseDate(laterDateText);
    const earlier = parseDate(earlierDateText);
    if (!later || !earlier) return 0;
    return Math.max(0, Math.floor((stripTime(later) - stripTime(earlier)) / 86400000));
  }

  function parseDate(value) {
    const text = clean(value);
    if (!text) return null;
    const date = new Date(text.replace(/-/g, "/"));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function dateOnly(value) {
    const text = clean(value);
    const match = text.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
  }

  function percentToNumber(value) {
    const number = Number(clean(value).replace("%", ""));
    return Number.isFinite(number) ? number : 0;
  }

  function stageProgress(stage) {
    const item = STAGES.find(([name]) => name === stage);
    return item ? item[1] : 0;
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDateTime(date) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${formatDate(date)} ${hh}:${mm}`;
  }

  function formatDateTimeValue(value) {
    const date = new Date(clean(value));
    if (Number.isNaN(date.getTime())) return clean(value);
    return formatDateTime(date);
  }

  function formatFileDate(date) {
    return formatDateTime(date).replace(/[-: ]/g, "");
  }

  function parseErrorMessage(error) {
    const text = clean(error?.message || error);
    try {
      const payload = JSON.parse(text);
      return payload.message || payload.error || text;
    } catch {
      return text || "未知错误";
    }
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function escAttr(value) {
    return esc(value);
  }
})();
