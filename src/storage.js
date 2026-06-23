(() => {
  const TICKET_STORE = "workorder-dashboard-ticket-notes-v1";
  const PROJECT_STORE = "workorder-dashboard-project-notes-v1";
  const EDITOR_STORE = "workorder-dashboard-editor-name";

  const TABLES = {
    baseTickets: "base_tickets",
    manualFields: "manual_fields",
    projectFollowups: "project_followups",
    importLogs: "import_logs",
  };

  const TICKET_FIELD_TO_API = {
    "风险原因": "riskReason",
    "备注": "remark",
    "未结案原因": "unclosedReason",
    "当前卡点": "blocker",
    "下一步规划": "nextPlan",
    "预计闭环时间": "expectedCloseAt",
    "最新进展": "latestProgress",
    "有卡点": "hasBlocker",
  };

  const PROJECT_FIELD_TO_API = {
    "项目名称": "projectName",
    "关联工单号": "relatedTickets",
    "工单类型": "ticketType",
    "当前阶段": "currentStage",
    "项目进度": "progress",
    "寄回状态": "returnStatus",
    "分析结论": "analysisConclusion",
    "定责结论": "responsibilityConclusion",
    "现场处理方案": "onsiteSolution",
    "当前卡点": "blocker",
    "下一步动作": "nextAction",
    "责任人": "owner",
    "预计完成时间": "expectedFinishAt",
    "最新进展": "latestProgress",
  };

  const MANUAL_TO_DB = {
    ticketKey: "ticket_key",
    ticketType: "ticket_type",
    ticketNo: "ticket_no",
    riskReason: "risk_reason",
    remark: "remark",
    unclosedReason: "unclosed_reason",
    blocker: "blocker",
    nextPlan: "next_plan",
    expectedCloseAt: "expected_close_at",
    latestProgress: "latest_progress",
    hasBlocker: "has_blocker",
    updatedBy: "updated_by",
    updatedAt: "updated_at",
  };

  const PROJECT_TO_DB = {
    id: "id",
    projectName: "project_name",
    relatedTickets: "related_tickets",
    ticketType: "ticket_type",
    currentStage: "current_stage",
    progress: "progress",
    returnStatus: "return_status",
    analysisConclusion: "analysis_conclusion",
    responsibilityConclusion: "responsibility_conclusion",
    onsiteSolution: "onsite_solution",
    blocker: "blocker",
    nextAction: "next_action",
    owner: "owner",
    expectedFinishAt: "expected_finish_at",
    latestProgress: "latest_progress",
    updatedBy: "updated_by",
    updatedAt: "updated_at",
  };

  const BASE_TICKET_TO_DB = {
    ticketKey: "ticket_key",
    ticketType: "ticket_type",
    ticketNo: "ticket_no",
    creator: "creator",
    createTime: "create_time",
    documentStatus: "document_status",
    workOrderStatus: "work_order_status",
    region: "region",
    issueSummary: "issue_summary",
    materialCode: "material_code",
    materialDescription: "material_description",
    ageDays: "age_days",
    rawData: "raw_data",
    lastImportedAt: "last_imported_at",
    lastImportedBy: "last_imported_by",
    sourceFileName: "source_file_name",
  };

  const IMPORT_LOG_TO_DB = {
    id: "id",
    importedAt: "imported_at",
    importedBy: "imported_by",
    ticketType: "ticket_type",
    fileName: "file_name",
    totalRows: "total_rows",
    insertedCount: "inserted_count",
    updatedCount: "updated_count",
    endedCount: "ended_count",
    preservedManualCount: "preserved_manual_count",
    status: "status",
    message: "message",
  };

  const API_TO_TICKET_FIELD = invert(TICKET_FIELD_TO_API);
  const API_TO_PROJECT_FIELD = invert(PROJECT_FIELD_TO_API);
  const DB_TO_MANUAL = invert(MANUAL_TO_DB);
  const DB_TO_PROJECT = invert(PROJECT_TO_DB);
  const DB_TO_BASE_TICKET = invert(BASE_TICKET_TO_DB);
  const DB_TO_IMPORT_LOG = invert(IMPORT_LOG_TO_DB);

  let clientCache = null;

  async function loadTickets() {
    const client = supabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from(TABLES.baseTickets)
          .select("*")
          .order("last_imported_at", { ascending: false, nullsFirst: false });
        if (error) throw error;
        const allTickets = (data || []).map((row) => normalizeBaseTicket(fromDb(row, DB_TO_BASE_TICKET)));
        const activeTickets = allTickets.filter((ticket) => clean(ticket.documentStatus) !== "已结束");
        return {
          mode: "supabase",
          records: activeTickets.map(ticketToDashboardRow),
          totalBaseTickets: allTickets.length,
          activeBaseTickets: activeTickets.length,
        };
      } catch (error) {
        console.warn("Supabase tickets load failed, falling back to local data.", error);
      }
    }

    if (supabaseRestAvailable()) {
      try {
        const data = await supabaseRestSelect(TABLES.baseTickets, "select=*");
        const allTickets = (data || [])
          .map((row) => normalizeBaseTicket(fromDb(row, DB_TO_BASE_TICKET)))
          .sort((a, b) => new Date(b.lastImportedAt || 0) - new Date(a.lastImportedAt || 0));
        const activeTickets = allTickets.filter((ticket) => clean(ticket.documentStatus) !== "已结束");
        return {
          mode: "supabase-rest",
          records: activeTickets.map(ticketToDashboardRow),
          totalBaseTickets: allTickets.length,
          activeBaseTickets: activeTickets.length,
        };
      } catch (error) {
        console.warn("Supabase REST tickets load failed.", error);
      }
    }

    try {
      const payload = await requestJson("/api/tickets");
      return {
        mode: payload.storage || "shared",
        records: payload.records || [],
        totalBaseTickets: Number(payload.totalBaseTickets || 0),
        activeBaseTickets: Number(payload.activeBaseTickets || 0),
      };
    } catch (error) {
      return { mode: "local", error, records: null, totalBaseTickets: 0, activeBaseTickets: 0 };
    }
  }

  async function importTickets({ ticketType, importedBy, file }) {
    if (!file) throw new Error("请先选择要导入的 Excel 或 CSV 文件");
    const client = supabaseClient();
    if (client) return importTicketsToSupabase(client, { ticketType, importedBy, file });
    if (supabaseRestAvailable()) return importTicketsToSupabaseRest({ ticketType, importedBy, file });

    const fileBase64 = await readFileAsBase64(file);
    return requestJson("/api/import-tickets", {
      method: "POST",
      body: JSON.stringify({ ticketType, importedBy, fileName: file.name, fileBase64 }),
    });
  }

  async function importTicketsToSupabase(client, { ticketType, importedBy, file }) {
    const importedAt = new Date().toISOString();
    const rows = await parseImportFile(file);
    const currentTickets = await loadAllBaseTickets(client);
    const currentByKey = new Map(currentTickets.map((ticket) => [ticket.ticketKey, ticket]));
    const manual = await loadManualFields();
    const manualKeys = new Set((manual.records || []).map((record) => record.ticketKey).filter(Boolean));
    const normalized = rows
      .map((row) => normalizeImportedTicket(row, { ticketType, importedBy, fileName: file.name, importedAt }))
      .filter(Boolean);
    const byKey = new Map();
    normalized.forEach((ticket) => byKey.set(ticket.ticketKey, ticket));
    const records = [...byKey.values()];

    const insertedCount = records.filter((ticket) => !currentByKey.has(ticket.ticketKey)).length;
    const updatedCount = records.length - insertedCount;
    const endedCount = records.filter((ticket) => clean(ticket.documentStatus) === "已结束").length;
    const preservedManualCount = records.filter((ticket) => manualKeys.has(ticket.ticketKey)).length;

    if (records.length) {
      const { error } = await client
        .from(TABLES.baseTickets)
        .upsert(records.map((record) => toDb(compactRecord(record), BASE_TICKET_TO_DB)), { onConflict: "ticket_key" });
      if (error) throw error;
    }

    const message = `本次导入${ticketType} ${records.length} 条：新增 ${insertedCount} 条，更新 ${updatedCount} 条，已结束剔除 ${endedCount} 条，人工维护字段保留 ${preservedManualCount} 条。`;
    const log = {
      id: makeId("import"),
      importedAt,
      importedBy: clean(importedBy) || "未署名",
      ticketType,
      fileName: file.name,
      totalRows: records.length,
      insertedCount,
      updatedCount,
      endedCount,
      preservedManualCount,
      status: "success",
      message,
    };
    const { error: logError } = await client.from(TABLES.importLogs).insert(toDb(log, IMPORT_LOG_TO_DB));
    if (logError) throw logError;

    return { storage: "supabase", summary: { ...log, message }, log };
  }

  async function importTicketsToSupabaseRest({ ticketType, importedBy, file }) {
    const importedAt = new Date().toISOString();
    const rows = await parseImportFile(file);
    const currentTickets = await loadAllBaseTicketsRest();
    const currentByKey = new Map(currentTickets.map((ticket) => [ticket.ticketKey, ticket]));
    const manual = await loadManualFields();
    const manualKeys = new Set((manual.records || []).map((record) => record.ticketKey).filter(Boolean));
    const normalized = rows
      .map((row) => normalizeImportedTicket(row, { ticketType, importedBy, fileName: file.name, importedAt }))
      .filter(Boolean);
    const byKey = new Map();
    normalized.forEach((ticket) => byKey.set(ticket.ticketKey, ticket));
    const records = [...byKey.values()];

    const insertedCount = records.filter((ticket) => !currentByKey.has(ticket.ticketKey)).length;
    const updatedCount = records.length - insertedCount;
    const endedCount = records.filter((ticket) => clean(ticket.documentStatus) === "已结束").length;
    const preservedManualCount = records.filter((ticket) => manualKeys.has(ticket.ticketKey)).length;

    if (records.length) {
      await supabaseRestUpsert(
        TABLES.baseTickets,
        records.map((record) => toDb(compactRecord(record), BASE_TICKET_TO_DB)),
        "ticket_key",
      );
    }

    const message = `本次导入${ticketType} ${records.length} 条：新增 ${insertedCount} 条，更新 ${updatedCount} 条，已结束剔除 ${endedCount} 条，人工维护字段保留 ${preservedManualCount} 条。`;
    const log = {
      id: makeId("import"),
      importedAt,
      importedBy: clean(importedBy) || "未署名",
      ticketType,
      fileName: file.name,
      totalRows: records.length,
      insertedCount,
      updatedCount,
      endedCount,
      preservedManualCount,
      status: "success",
      message,
    };
    await supabaseRestUpsert(TABLES.importLogs, toDb(log, IMPORT_LOG_TO_DB), "id");

    return { storage: "supabase-rest", summary: { ...log, message }, log };
  }

  async function loadAllBaseTickets(client) {
    const { data, error } = await client.from(TABLES.baseTickets).select("*");
    if (error) throw error;
    return (data || []).map((row) => normalizeBaseTicket(fromDb(row, DB_TO_BASE_TICKET)));
  }

  async function loadAllBaseTicketsRest() {
    const data = await supabaseRestSelect(TABLES.baseTickets, "select=*");
    return (data || []).map((row) => normalizeBaseTicket(fromDb(row, DB_TO_BASE_TICKET)));
  }

  async function loadImportLogs() {
    const client = supabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from(TABLES.importLogs)
          .select("*")
          .order("imported_at", { ascending: false })
          .limit(30);
        if (error) throw error;
        return { mode: "supabase", records: (data || []).map((row) => fromDb(row, DB_TO_IMPORT_LOG)) };
      } catch (error) {
        console.warn("Supabase import logs load failed.", error);
      }
    }

    if (supabaseRestAvailable()) {
      try {
        const data = await supabaseRestSelect(TABLES.importLogs, "select=*&order=imported_at.desc&limit=30");
        return { mode: "supabase-rest", records: (data || []).map((row) => fromDb(row, DB_TO_IMPORT_LOG)) };
      } catch (error) {
        console.warn("Supabase REST import logs load failed.", error);
        if (mustUseSupabase()) return { mode: "shared", error, records: [] };
      }
    }

    if (mustUseSupabase()) {
      return { mode: "shared", error: new Error(supabaseUnavailableMessage("import_logs 读取失败")), records: [] };
    }

    try {
      const payload = await requestJson("/api/import-logs");
      return { mode: payload.storage || "shared", records: payload.records || [] };
    } catch (error) {
      return { mode: "local", error, records: [] };
    }
  }

  async function loadManualFields() {
    const client = supabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from(TABLES.manualFields)
          .select("*")
          .order("updated_at", { ascending: false });
        if (error) throw error;
        return { mode: "supabase", records: (data || []).map((row) => normalizeTicketRecord(fromDb(row, DB_TO_MANUAL))) };
      } catch (error) {
        console.warn("Supabase manual fields load failed.", error);
      }
    }

    if (supabaseRestAvailable()) {
      try {
        const data = await supabaseRestSelect(TABLES.manualFields, "select=*&order=updated_at.desc");
        return { mode: "supabase-rest", records: (data || []).map((row) => normalizeTicketRecord(fromDb(row, DB_TO_MANUAL))) };
      } catch (error) {
        console.warn("Supabase REST manual fields load failed.", error);
        if (mustUseSupabase()) return { mode: "shared", error, records: [] };
      }
    }

    if (mustUseSupabase()) {
      return { mode: "shared", error: new Error(supabaseUnavailableMessage("manual_fields 读取失败")), records: [] };
    }

    try {
      const payload = await requestJson("/api/manual-fields");
      return { mode: payload.storage || "shared", records: (payload.records || []).map(normalizeTicketRecord) };
    } catch (error) {
      return { mode: "local", error, records: collectLocalTicketRecords() };
    }
  }

  async function saveManualField({ ticketKey, ticketType, ticketNo, fieldName, value, updatedBy }) {
    const apiField = TICKET_FIELD_TO_API[fieldName];
    if (!apiField) throw new Error(`不支持的字段：${fieldName}`);
    const base = {
      ticketKey,
      ticketType,
      ticketNo,
      updatedBy: clean(updatedBy) || "未署名",
      updatedAt: new Date().toISOString(),
      [apiField]: value,
    };

    const client = supabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from(TABLES.manualFields)
          .upsert(toDb(compactRecord(base), MANUAL_TO_DB), { onConflict: "ticket_key" })
          .select()
          .single();
        if (error) throw error;
        return { mode: "supabase", record: normalizeTicketRecord(fromDb(data, DB_TO_MANUAL)) };
      } catch (error) {
        console.error("Supabase manual_fields save failed.", error);
        throw enrichSupabaseError(error, "manual_fields 保存失败");
      }
    }

    if (supabaseRestAvailable()) {
      try {
        const rows = await supabaseRestUpsert(
          TABLES.manualFields,
          toDb(compactRecord(base), MANUAL_TO_DB),
          "ticket_key",
        );
        return { mode: "supabase-rest", record: normalizeTicketRecord(fromDb(rows?.[0] || {}, DB_TO_MANUAL)) };
      } catch (error) {
        console.error("Supabase REST manual_fields save failed.", error);
        throw enrichSupabaseError(error, "manual_fields 保存失败");
      }
    }

    if (mustUseSupabase()) {
      throw new Error(supabaseUnavailableMessage("manual_fields 保存失败"));
    }

    try {
      const payload = await requestJson("/api/manual-fields", {
        method: "POST",
        body: JSON.stringify(base),
      });
      return { mode: payload.storage || "shared", record: normalizeTicketRecord(payload.record) };
    } catch (error) {
      return localManualSaveFallback({ ticketKey, ticketType, ticketNo, fieldName, value, updatedBy, error });
    }
  }

  async function loadProjectFollowups() {
    const client = supabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from(TABLES.projectFollowups)
          .select("*")
          .order("updated_at", { ascending: false });
        if (error) throw error;
        return { mode: "supabase", records: (data || []).map((row) => normalizeProjectRecord(fromDb(row, DB_TO_PROJECT))) };
      } catch (error) {
        console.warn("Supabase project followups load failed.", error);
      }
    }

    if (supabaseRestAvailable()) {
      try {
        const data = await supabaseRestSelect(TABLES.projectFollowups, "select=*&order=updated_at.desc");
        return { mode: "supabase-rest", records: (data || []).map((row) => normalizeProjectRecord(fromDb(row, DB_TO_PROJECT))) };
      } catch (error) {
        console.warn("Supabase REST project followups load failed.", error);
        if (mustUseSupabase()) return { mode: "shared", error, records: [] };
      }
    }

    if (mustUseSupabase()) {
      return { mode: "shared", error: new Error(supabaseUnavailableMessage("project_followups 读取失败")), records: [] };
    }

    try {
      const payload = await requestJson("/api/project-followups");
      return { mode: payload.storage || "shared", records: (payload.records || []).map(normalizeProjectRecord) };
    } catch (error) {
      return { mode: "local", error, records: collectLocalProjectRecords() };
    }
  }

  async function saveProjectFollowup(project) {
    const body = {};
    Object.entries(project || {}).forEach(([field, value]) => {
      body[PROJECT_FIELD_TO_API[field] || field] = value;
    });
    body.id = clean(body.id || body.relatedTickets || body.projectName);
    body.updatedBy = clean(body.updatedBy || project["更新人"]) || "未署名";
    body.updatedAt = new Date().toISOString();

    const client = supabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from(TABLES.projectFollowups)
          .upsert(toDb(compactRecord(body), PROJECT_TO_DB), { onConflict: "id" })
          .select()
          .single();
        if (error) throw error;
        return { mode: "supabase", record: normalizeProjectRecord(fromDb(data, DB_TO_PROJECT)) };
      } catch (error) {
        console.error("Supabase project_followups save failed.", error);
        throw enrichSupabaseError(error, "project_followups 保存失败");
      }
    }

    if (supabaseRestAvailable()) {
      try {
        const rows = await supabaseRestUpsert(
          TABLES.projectFollowups,
          toDb(compactRecord(body), PROJECT_TO_DB),
          "id",
        );
        return { mode: "supabase-rest", record: normalizeProjectRecord(fromDb(rows?.[0] || {}, DB_TO_PROJECT)) };
      } catch (error) {
        console.error("Supabase REST project_followups save failed.", error);
        throw enrichSupabaseError(error, "project_followups 保存失败");
      }
    }

    if (mustUseSupabase()) {
      throw new Error(supabaseUnavailableMessage("project_followups 保存失败"));
    }

    try {
      const payload = await requestJson("/api/project-followups", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { mode: payload.storage || "shared", record: normalizeProjectRecord(payload.record) };
    } catch (error) {
      return localProjectSaveFallback(project, body.id, error);
    }
  }

  async function deleteProjectFollowup(id) {
    const client = supabaseClient();
    if (client) {
      const { error } = await client.from(TABLES.projectFollowups).delete().eq("id", id);
      if (!error) return { mode: "supabase" };
    }

    if (supabaseRestAvailable()) {
      try {
        await supabaseRestDelete(TABLES.projectFollowups, `id=eq.${encodeURIComponent(id)}`);
        return { mode: "supabase-rest" };
      } catch (error) {
        console.error("Supabase REST project_followups delete failed.", error);
        throw enrichSupabaseError(error, "project_followups 删除失败");
      }
    }

    try {
      await requestJson(`/api/project-followups/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { mode: "shared" };
    } catch (error) {
      localStorage.removeItem(`${PROJECT_STORE}:${id}`);
      return { mode: "local", error };
    }
  }

  function normalizeImportedTicket(row, context) {
    const ticketNo = firstClean(row, ["工单号", "客诉单号", "工单号/客诉单号", "单据编号", "支持单号", "单号"]);
    if (!ticketNo) return null;

    const creator = firstClean(row, ["制单人/创建人", "处理人员", "制单人", "创建人", "起草人", "CC起草人"]) || context.importedBy;
    const createTime = normalizeDateText(firstClean(row, ["制单时间", "创建时间", "起草时间", "客诉产生时间", "单据日期"]));
    const documentStatus = firstClean(row, ["单据状态", "状态"]);
    const workOrderStatus = firstClean(row, ["工单状态", "服务状态"]);
    const region = firstClean(row, ["区域", "分公司/区域", "分公司", "分公司名称", "客户省份名称", "客户地址省"]);
    const issueSummary = firstClean(row, ["问题简述", "投诉内容", "反馈内容", "投诉内容描述", "投诉/问题现象", "初步回复", "处理回复", "客服初步回复"]);
    const materialCode = firstClean(row, ["物料代码", "物料编码", "产品编码", "产品代码", "商品编码"]);
    const materialDescription = firstClean(row, ["物料描述", "产品描述", "产品名称", "型号", "产品型号", "产品"]);
    const ageDays = parseAgeDays(firstClean(row, ["已流转天数", "未结案天数", "流转天数"]), createTime, context.importedAt);

    return {
      ticketKey: makeTicketKey(context.ticketType, ticketNo),
      ticketType: context.ticketType,
      ticketNo,
      creator,
      createTime,
      documentStatus,
      workOrderStatus,
      region,
      issueSummary,
      materialCode,
      materialDescription,
      ageDays,
      rawData: row,
      lastImportedAt: context.importedAt,
      lastImportedBy: clean(context.importedBy) || "未署名",
      sourceFileName: context.fileName,
    };
  }

  function normalizeBaseTicket(record) {
    const rawData = typeof record.rawData === "string" ? safeJsonParse(record.rawData, {}) : (record.rawData || {});
    return {
      ...record,
      ticketKey: clean(record.ticketKey),
      ticketType: clean(record.ticketType),
      ticketNo: clean(record.ticketNo),
      creator: clean(record.creator),
      createTime: normalizeDateText(record.createTime),
      documentStatus: clean(record.documentStatus),
      workOrderStatus: clean(record.workOrderStatus),
      region: clean(record.region),
      issueSummary: clean(record.issueSummary),
      materialCode: clean(record.materialCode),
      materialDescription: clean(record.materialDescription),
      ageDays: parseNullableNumber(record.ageDays),
      rawData,
      lastImportedAt: clean(record.lastImportedAt),
      lastImportedBy: clean(record.lastImportedBy),
      sourceFileName: clean(record.sourceFileName),
    };
  }

  function ticketToDashboardRow(ticket) {
    const raw = ticket.rawData || {};
    const ageDays = ticket.ageDays ?? "";
    return {
      ...raw,
      "工单类型": ticket.ticketType,
      "工单号": ticket.ticketNo,
      "工单号/客诉单号": ticket.ticketNo,
      "客诉单号": raw["客诉单号"] || ticket.ticketNo,
      "处理人员": ticket.creator,
      "制单人/创建人": ticket.creator,
      "制单人": raw["制单人"] || ticket.creator,
      "创建人": raw["创建人"] || ticket.creator,
      "制单时间": ticket.createTime,
      "创建时间": raw["创建时间"] || ticket.createTime,
      "单据状态": ticket.documentStatus,
      "工单状态": ticket.workOrderStatus,
      "区域": ticket.region,
      "分公司/区域": raw["分公司/区域"] || ticket.region,
      "问题简述": ticket.issueSummary,
      "投诉内容": raw["投诉内容"] || ticket.issueSummary,
      "物料代码": ticket.materialCode,
      "物料描述": ticket.materialDescription,
      "已流转天数": ageDays === null ? "" : String(ageDays),
      "未结案天数": ageDays === null ? "" : String(ageDays),
      "最后导入时间": ticket.lastImportedAt,
      "最后导入人": ticket.lastImportedBy,
      "来源文件": ticket.sourceFileName,
    };
  }

  function normalizeTicketRecord(record = {}) {
    const fields = {};
    Object.entries(TICKET_FIELD_TO_API).forEach(([uiField, apiField]) => {
      if (record[apiField] !== undefined && record[apiField] !== null) fields[uiField] = record[apiField];
    });
    if (record.updatedAt) fields["更新时间"] = formatDateTime(record.updatedAt);
    if (record.updatedBy) fields["更新人"] = record.updatedBy;
    return {
      ticketKey: clean(record.ticketKey),
      ticketType: clean(record.ticketType),
      ticketNo: clean(record.ticketNo),
      fields,
      updatedBy: clean(record.updatedBy),
      updatedAt: clean(record.updatedAt),
    };
  }

  function normalizeProjectRecord(record = {}) {
    const fields = {};
    Object.entries(PROJECT_FIELD_TO_API).forEach(([uiField, apiField]) => {
      if (record[apiField] !== undefined && record[apiField] !== null) fields[uiField] = record[apiField];
    });
    if (record.updatedAt) fields["更新时间"] = formatDateTime(record.updatedAt);
    if (record.updatedBy) fields["更新人"] = record.updatedBy;
    return {
      id: clean(record.id || record.relatedTickets || record.projectName),
      fields,
      updatedBy: clean(record.updatedBy),
      updatedAt: clean(record.updatedAt),
    };
  }

  function localManualSaveFallback({ ticketKey, ticketType, ticketNo, fieldName, value, updatedBy, error }) {
    const record = readLocalRecord(TICKET_STORE, ticketNo);
    record[fieldName] = value;
    record["更新时间"] = formatDateTime(new Date());
    record["更新人"] = updatedBy || "未署名";
    writeLocalRecord(TICKET_STORE, ticketNo, record);
    return {
      mode: "local",
      error,
      record: { ticketKey, ticketType, ticketNo, fields: record, updatedBy: record["更新人"], updatedAt: record["更新时间"] },
    };
  }

  function localProjectSaveFallback(project, id, error) {
    const local = readLocalRecord(PROJECT_STORE, id);
    Object.assign(local, project, {
      "更新时间": formatDateTime(new Date()),
      "更新人": project.updatedBy || project["更新人"] || "未署名",
    });
    writeLocalRecord(PROJECT_STORE, id, local);
    return { mode: "local", error, record: { id, fields: local, updatedBy: local["更新人"], updatedAt: local["更新时间"] } };
  }

  function supabaseClient() {
    if (clientCache) return clientCache;
    const { url, anonKey } = supabaseConfig();
    const { hasLibrary } = supabaseStatus();
    if (!url || !anonKey || !hasLibrary) return null;
    clientCache = window.supabase.createClient(url, anonKey);
    return clientCache;
  }

  function supabaseRestAvailable() {
    const status = supabaseStatus();
    return Boolean(status.hasUrl && status.hasAnonKey && window.fetch);
  }

  async function supabaseRestSelect(table, query) {
    return supabaseRestRequest(`${table}?${query}`, { method: "GET" });
  }

  async function supabaseRestUpsert(table, record, onConflict) {
    return supabaseRestRequest(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(record),
    });
  }

  async function supabaseRestDelete(table, query) {
    return supabaseRestRequest(`${table}?${query}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    });
  }

  async function supabaseRestRequest(path, options = {}) {
    const { url, anonKey } = supabaseConfig();
    if (!url || !anonKey) throw new Error(supabaseUnavailableMessage("Supabase REST 请求失败"));
    const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    const payload = text ? safeJsonParse(text, text) : null;
    if (!response.ok) {
      const message = typeof payload === "string"
        ? payload
        : [payload?.message, payload?.details, payload?.hint, payload?.code].map(clean).filter(Boolean).join(" | ");
      throw new Error(message || `HTTP ${response.status}`);
    }
    return payload || [];
  }

  function supabaseConfig() {
    const config = window.WORKORDER_SUPABASE_CONFIG || {};
    return {
      url: clean(config.supabaseUrl || config.url),
      anonKey: clean(config.supabaseAnonKey || config.anonKey),
    };
  }

  function supabaseStatus() {
    const { url, anonKey } = supabaseConfig();
    return {
      hasConfigObject: Boolean(window.WORKORDER_SUPABASE_CONFIG),
      hasUrl: Boolean(url),
      hasAnonKey: Boolean(anonKey),
      hasLibrary: Boolean(window.supabase?.createClient),
      host: window.location.host,
      protocol: window.location.protocol,
      isStaticHosted: isStaticHosted(),
      urlPreview: url ? `${url.slice(0, 24)}...` : "",
      anonKeyPreview: anonKey ? `${anonKey.slice(0, 10)}...` : "",
      willUseSupabase: Boolean(url && anonKey && (window.supabase?.createClient || window.fetch)),
      willUseSupabaseJs: Boolean(url && anonKey && window.supabase?.createClient),
      willUseSupabaseRest: Boolean(url && anonKey && window.fetch),
    };
  }

  function mustUseSupabase() {
    const status = supabaseStatus();
    return status.isStaticHosted || status.hasConfigObject || status.hasUrl || status.hasAnonKey;
  }

  function isStaticHosted() {
    const host = window.location.hostname;
    return window.location.protocol === "https:" && !["localhost", "127.0.0.1", ""].includes(host);
  }

  function supabaseUnavailableMessage(prefix) {
    const status = supabaseStatus();
    if (!status.hasConfigObject) return `${prefix}：未加载 src/config.js 或 WORKORDER_SUPABASE_CONFIG`;
    if (!status.hasUrl) return `${prefix}：src/config.js 缺少 supabaseUrl`;
    if (!status.hasAnonKey) return `${prefix}：src/config.js 缺少 supabaseAnonKey / Publishable key`;
    if (!status.hasLibrary) return `${prefix}：Supabase JS 客户端未加载，请检查 CDN 网络`;
    return `${prefix}：Supabase 未连接`;
  }

  function enrichSupabaseError(error, prefix) {
    const detail = [
      error?.message,
      error?.details,
      error?.hint,
      error?.code,
    ].map(clean).filter(Boolean).join(" | ");
    return new Error(`${prefix}：${detail || "请检查 Supabase 配置和 RLS policy"}`);
  }

  function makeTicketKey(ticketType, ticketNo) {
    return `${clean(ticketType) || "未分类"}::${clean(ticketNo)}`;
  }

  function getEditorName() {
    return clean(localStorage.getItem(EDITOR_STORE));
  }

  function setEditorName(name) {
    localStorage.setItem(EDITOR_STORE, clean(name));
  }

  function collectLocalExport() {
    return { tickets: collectStore(TICKET_STORE), projects: collectStore(PROJECT_STORE) };
  }

  function collectLocalTicketRecords() {
    return collectStore(TICKET_STORE).map((item) => ({
      ticketKey: makeTicketKey("", item.id),
      ticketNo: item.id,
      ticketType: "",
      fields: item.fields,
      updatedBy: clean(item.fields["更新人"]),
      updatedAt: clean(item.fields["更新时间"]),
    }));
  }

  function collectLocalProjectRecords() {
    return collectStore(PROJECT_STORE).map((item) => ({
      id: item.id,
      fields: item.fields,
      updatedBy: clean(item.fields["更新人"]),
      updatedAt: clean(item.fields["更新时间"]),
    }));
  }

  function readLocalTicket(id) {
    return readLocalRecord(TICKET_STORE, id);
  }

  function readLocalProject(id) {
    return readLocalRecord(PROJECT_STORE, id);
  }

  async function requestJson(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: options.body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `请求失败：${response.status}`);
    }
    return response.json();
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
      reader.readAsDataURL(file);
    });
  }

  async function parseImportFile(file) {
    if (!window.WorkorderImportParser?.parseFile) throw new Error("导入解析模块未加载");
    return window.WorkorderImportParser.parseFile(file);
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

  function firstClean(row, fields) {
    for (const field of fields) {
      const value = clean(row[field]);
      if (value) return value;
    }
    return "";
  }

  function parseAgeDays(value, createTime, importedAt) {
    const direct = parseNullableNumber(value);
    if (direct !== null) return direct;
    const createDate = parseDateLoose(createTime);
    const importDate = parseDateLoose(importedAt) || new Date();
    if (!createDate) return null;
    return Math.max(0, Math.floor((stripTime(importDate) - stripTime(createDate)) / 86400000));
  }

  function normalizeDateText(value) {
    const text = clean(value);
    if (!text) return "";
    const date = parseDateLoose(text);
    return date ? formatDate(date) : text;
  }

  function parseDateLoose(value) {
    const text = clean(value);
    if (!text) return null;
    const number = Number(text);
    if (Number.isFinite(number) && number > 20000 && number < 80000) {
      return new Date(Date.UTC(1899, 11, 30) + number * 86400000);
    }
    const date = new Date(text.replace(/-/g, "/"));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return clean(value);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${formatDate(date)} ${hh}:${mm}`;
  }

  function parseNullableNumber(value) {
    const text = clean(value);
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function toDb(record, map) {
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [map[key] || key, emptyToNull(value)]));
  }

  function fromDb(record, map) {
    return Object.fromEntries(Object.entries(record || {}).map(([key, value]) => [map[key] || key, value ?? ""]));
  }

  function compactRecord(record) {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null));
  }

  function emptyToNull(value) {
    return value === "" ? null : value;
  }

  function invert(map) {
    return Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key]));
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  window.WorkorderStorage = {
    makeTicketKey,
    loadTickets,
    importTickets,
    loadImportLogs,
    loadManualFields,
    saveManualField,
    loadProjectFollowups,
    saveProjectFollowup,
    deleteProjectFollowup,
    collectLocalExport,
    readLocalTicket,
    readLocalProject,
    getEditorName,
    setEditorName,
    debugSupabase: supabaseStatus,
    fields: {
      ticket: TICKET_FIELD_TO_API,
      project: PROJECT_FIELD_TO_API,
      apiToTicket: API_TO_TICKET_FIELD,
      apiToProject: API_TO_PROJECT_FIELD,
    },
  };
})();
