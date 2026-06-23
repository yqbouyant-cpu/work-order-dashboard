const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { URL } = require("node:url");

const ROOT = __dirname;

loadDotEnv();

const DATA_FILE = path.resolve(ROOT, cleanEnv(process.env.DATA_FILE) || path.join(".data", "shared-store.json"));
const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const ALLOWED_ORIGINS = cleanEnv(process.env.ALLOWED_ORIGINS)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const TICKET_TYPES = ["质量工单", "支持工单", "市场工单", "供应工单"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
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

const DB_TO_MANUAL = invert(MANUAL_TO_DB);
const DB_TO_PROJECT = invert(PROJECT_TO_DB);
const DB_TO_BASE_TICKET = invert(BASE_TICKET_TO_DB);
const DB_TO_IMPORT_LOG = invert(IMPORT_LOG_TO_DB);

const SUPABASE_TABLES = {
  baseTickets: "base_tickets",
  manualFields: "manual_fields",
  projectFollowups: "project_followups",
  importLogs: "import_logs",
};

const server = http.createServer(async (req, res) => {
  try {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: "server_error", message: error.message });
  }
});

server.listen(PORT, () => {
  const mode = USE_SUPABASE ? "Supabase" : "local JSON fallback";
  console.log(`工单看板服务已启动：http://localhost:${PORT}（${mode}）`);
});

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      storage: USE_SUPABASE ? "supabase" : "local-json",
      time: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tickets") {
    sendJson(res, 200, { ...(await getTicketsPayload()), storage: storageMode() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import-tickets") {
    const body = await readJson(req);
    const result = await importTickets(body);
    sendJson(res, 200, { ...result, storage: storageMode() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/import-logs") {
    sendJson(res, 200, { records: await listImportLogs(), storage: storageMode() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/manual-fields") {
    sendJson(res, 200, { records: await listManualFields(), storage: storageMode() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/manual-fields") {
    const body = await readJson(req);
    const record = await upsertManualField(body);
    sendJson(res, 200, { record, storage: storageMode() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/project-followups") {
    sendJson(res, 200, { records: await listProjectFollowups(), storage: storageMode() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/project-followups") {
    const body = await readJson(req);
    const record = await upsertProjectFollowup(body);
    sendJson(res, 200, { record, storage: storageMode() });
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/project-followups\/([^/]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    await deleteProjectFollowup(decodeURIComponent(deleteMatch[1]));
    sendJson(res, 200, { ok: true, storage: storageMode() });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const resolved = path.resolve(ROOT, `.${pathname}`);
  if (!resolved.startsWith(ROOT)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }
    const type = MIME_TYPES[path.extname(resolved).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(await fs.readFile(resolved));
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
}

async function listActiveTickets() {
  const tickets = await listAllBaseTickets();
  return tickets.filter((ticket) => !isEndedStatus(ticket.documentStatus)).map(ticketToDashboardRow);
}

async function getTicketsPayload() {
  const tickets = await listAllBaseTickets();
  const activeTickets = tickets.filter((ticket) => !isEndedStatus(ticket.documentStatus));
  return {
    records: activeTickets.map(ticketToDashboardRow),
    totalBaseTickets: tickets.length,
    activeBaseTickets: activeTickets.length,
    ticketTypes: uniqueTicketTypes(tickets),
  };
}

async function listAllBaseTickets() {
  if (USE_SUPABASE) {
    const rows = await supabaseFetch(`/rest/v1/${SUPABASE_TABLES.baseTickets}?select=*&order=last_imported_at.desc`);
    return rows.map((row) => normalizeBaseTicket(fromDb(row, DB_TO_BASE_TICKET)));
  }
  const store = await readStore();
  return store.baseTickets.map(normalizeBaseTicket);
}

async function upsertBaseTickets(records) {
  if (!records.length) return [];
  if (USE_SUPABASE) {
    const rows = await supabaseFetch(`/rest/v1/${SUPABASE_TABLES.baseTickets}?on_conflict=ticket_key`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(records.map((record) => toDb(compactRecord(record), BASE_TICKET_TO_DB))),
    });
    return rows.map((row) => normalizeBaseTicket(fromDb(row, DB_TO_BASE_TICKET)));
  }

  const store = await readStore();
  const byKey = new Map(store.baseTickets.map((item) => [item.ticketKey, item]));
  records.forEach((record) => byKey.set(record.ticketKey, compactRecord(record)));
  store.baseTickets = [...byKey.values()];
  await writeStore(store);
  return records;
}

async function listImportLogs() {
  if (USE_SUPABASE) {
    const rows = await supabaseFetch(`/rest/v1/${SUPABASE_TABLES.importLogs}?select=*&order=imported_at.desc&limit=30`);
    return rows.map((row) => fromDb(row, DB_TO_IMPORT_LOG));
  }
  const store = await readStore();
  return store.importLogs.slice().sort((a, b) => clean(b.importedAt).localeCompare(clean(a.importedAt))).slice(0, 30);
}

async function addImportLog(log) {
  if (USE_SUPABASE) {
    const [record] = await supabaseFetch(`/rest/v1/${SUPABASE_TABLES.importLogs}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([toDb(compactRecord(log), IMPORT_LOG_TO_DB)]),
    });
    return fromDb(record, DB_TO_IMPORT_LOG);
  }
  const store = await readStore();
  store.importLogs.unshift(compactRecord(log));
  store.importLogs = store.importLogs.slice(0, 80);
  await writeStore(store);
  return log;
}

async function importTickets(body) {
  const importedAt = new Date().toISOString();
  const ticketType = clean(body.ticketType);
  const importedBy = clean(body.importedBy) || "未署名";
  const fileName = clean(body.fileName);

  try {
    if (!ticketType) throw new Error("请选择工单类型");
    if (!fileName) throw new Error("缺少文件名");
    if (!body.fileBase64) throw new Error("缺少上传文件内容");

    const fileBuffer = decodeBase64File(body.fileBase64);
    const rows = parseImportRows(fileName, fileBuffer);
    const currentTickets = await listAllBaseTickets();
    const currentByKey = new Map(
      currentTickets
        .filter((ticket) => clean(ticket.ticketType) === clean(ticketType))
        .map((ticket) => [ticket.ticketKey, ticket]),
    );
    const manualKeys = new Set((await listManualFields()).map((record) => record.ticketKey).filter(Boolean));

    const normalized = filterRowsForTicketType(rows, ticketType)
      .map((row) => normalizeImportedTicket(row, { ticketType, importedBy, fileName, importedAt }))
      .filter(Boolean);
    const byKey = new Map();
    normalized.forEach((ticket) => byKey.set(ticket.ticketKey, ticket));
    const records = [...byKey.values()];

    const insertedCount = records.filter((ticket) => !currentByKey.has(ticket.ticketKey)).length;
    const updatedCount = records.length - insertedCount;
    const endedCount = records.filter((ticket) => isEndedStatus(ticket.documentStatus)).length;
    const preservedManualCount = records.filter((ticket) => manualKeys.has(ticket.ticketKey)).length;

    await upsertBaseTickets(records);
    const message = `本次导入${ticketType} ${records.length} 条：新增 ${insertedCount} 条，更新 ${updatedCount} 条，已结束剔除 ${endedCount} 条，人工维护字段保留 ${preservedManualCount} 条。`;
    const log = await addImportLog({
      id: makeId("import"),
      importedAt,
      importedBy,
      ticketType,
      fileName,
      totalRows: records.length,
      insertedCount,
      updatedCount,
      endedCount,
      preservedManualCount,
      status: "success",
      message,
    });

    return {
      summary: {
        ticketType,
        totalRows: records.length,
        insertedCount,
        updatedCount,
        endedCount,
        preservedManualCount,
        message,
      },
      log,
    };
  } catch (error) {
    await addImportLog({
      id: makeId("import"),
      importedAt,
      importedBy,
      ticketType,
      fileName,
      totalRows: 0,
      insertedCount: 0,
      updatedCount: 0,
      endedCount: 0,
      preservedManualCount: 0,
      status: "failed",
      message: error.message,
    }).catch(() => {});
    throw error;
  }
}

async function listManualFields() {
  if (USE_SUPABASE) {
    const rows = await supabaseFetch(`/rest/v1/${SUPABASE_TABLES.manualFields}?select=*&order=updated_at.desc`);
    return rows.map((row) => fromDb(row, DB_TO_MANUAL));
  }
  const store = await readStore();
  return store.manualFields;
}

async function upsertManualField(body) {
  const now = new Date().toISOString();
  const ticketKey = clean(body.ticketKey);
  if (!ticketKey) throw new Error("ticketKey is required");

  const incoming = {
    ticketKey,
    ticketType: clean(body.ticketType),
    ticketNo: clean(body.ticketNo),
    updatedBy: clean(body.updatedBy) || "未署名",
    updatedAt: now,
  };
  ["riskReason", "remark", "unclosedReason", "blocker", "nextPlan", "expectedCloseAt", "latestProgress", "hasBlocker"].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      incoming[field] = field === "hasBlocker" ? textToBoolean(body[field]) : clean(body[field]);
    }
  });

  if (USE_SUPABASE) {
    const [record] = await supabaseFetch(`/rest/v1/${SUPABASE_TABLES.manualFields}?on_conflict=ticket_key`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([toDb(compactRecord(incoming), MANUAL_TO_DB)]),
    });
    return fromDb(record, DB_TO_MANUAL);
  }

  const store = await readStore();
  const index = store.manualFields.findIndex((item) => item.ticketKey === ticketKey);
  const record = compactRecord({ ...(index >= 0 ? store.manualFields[index] : {}), ...incoming });
  if (index >= 0) store.manualFields[index] = record;
  else store.manualFields.push(record);
  await writeStore(store);
  return record;
}

async function listProjectFollowups() {
  if (USE_SUPABASE) {
    const rows = await supabaseFetch(`/rest/v1/${SUPABASE_TABLES.projectFollowups}?select=*&order=updated_at.desc`);
    return rows.map((row) => fromDb(row, DB_TO_PROJECT));
  }
  const store = await readStore();
  return store.projectFollowups;
}

async function upsertProjectFollowup(body) {
  const now = new Date().toISOString();
  const id = clean(body.id || body.relatedTickets || body.projectName);
  if (!id) throw new Error("project id is required");

  const incoming = {
    id,
    projectName: clean(body.projectName),
    relatedTickets: clean(body.relatedTickets),
    ticketType: clean(body.ticketType),
    currentStage: clean(body.currentStage),
    progress: parseProgress(body.progress),
    returnStatus: clean(body.returnStatus),
    analysisConclusion: clean(body.analysisConclusion),
    responsibilityConclusion: clean(body.responsibilityConclusion),
    onsiteSolution: clean(body.onsiteSolution),
    blocker: clean(body.blocker),
    nextAction: clean(body.nextAction),
    owner: clean(body.owner),
    expectedFinishAt: clean(body.expectedFinishAt),
    latestProgress: clean(body.latestProgress),
    updatedBy: clean(body.updatedBy) || "未署名",
    updatedAt: now,
  };

  if (USE_SUPABASE) {
    const [record] = await supabaseFetch(`/rest/v1/${SUPABASE_TABLES.projectFollowups}?on_conflict=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([toDb(compactRecord(incoming), PROJECT_TO_DB)]),
    });
    return fromDb(record, DB_TO_PROJECT);
  }

  const store = await readStore();
  const index = store.projectFollowups.findIndex((item) => item.id === id);
  const record = compactRecord({ ...(index >= 0 ? store.projectFollowups[index] : {}), ...incoming });
  if (index >= 0) store.projectFollowups[index] = record;
  else store.projectFollowups.push(record);
  await writeStore(store);
  return record;
}

async function deleteProjectFollowup(id) {
  if (USE_SUPABASE) {
    await supabaseFetch(`/rest/v1/${SUPABASE_TABLES.projectFollowups}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return;
  }
  const store = await readStore();
  store.projectFollowups = store.projectFollowups.filter((item) => item.id !== id);
  await writeStore(store);
}

function parseImportRows(fileName, buffer) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".csv") return parseCsvRecords(buffer.toString("utf-8"));
  if (extension === ".xlsx") return parseXlsxRecords(buffer);
  throw new Error("暂只支持 .xlsx 或 .csv 文件");
}

function parseCsvRecords(text) {
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

  return tabularRowsToRecords(rows);
}

function parseXlsxRecords(buffer) {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(readZipText(entries, "xl/sharedStrings.xml", ""));
  const sheetPath = findFirstSheetPath(entries);
  const sheetXml = readZipText(entries, sheetPath, "");
  if (!sheetXml) throw new Error("未找到 Excel 工作表内容");

  const rows = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    let sequentialIndex = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrValue(attrs, "r");
      const index = ref ? columnIndex(ref) : sequentialIndex;
      cells[index] = parseCellValue(attrs, body, sharedStrings);
      sequentialIndex = index + 1;
    }
    if (cells.some((cell) => clean(cell))) rows.push(cells);
  }

  return tabularRowsToRecords(rows);
}

function tabularRowsToRecords(rows) {
  const firstRowIndex = rows.findIndex((row) => row.some((cell) => clean(cell)));
  if (firstRowIndex === -1) return [];
  const headers = rows[firstRowIndex].map((header, index) => {
    const text = index === 0 ? clean(header).replace(/^\uFEFF/, "") : clean(header);
    return text || `字段${index + 1}`;
  });
  return rows.slice(firstRowIndex + 1)
    .filter((cells) => cells.some((cell) => clean(cell) !== ""))
    .map((cells) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = clean(cells[index]);
      });
      return record;
    });
}

function readZipEntries(buffer) {
  const entries = new Map();
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("Excel 文件结构异常，无法读取");
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < totalEntries; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf-8").replace(/\\/g, "/");

    if (buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = buffer.slice(dataStart, dataStart + compressedSize);
      if (method === 0) entries.set(fileName, compressed);
      else if (method === 8) entries.set(fileName, zlib.inflateRawSync(compressed));
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function findFirstSheetPath(entries) {
  const workbookXml = readZipText(entries, "xl/workbook.xml", "");
  const relsXml = readZipText(entries, "xl/_rels/workbook.xml.rels", "");
  const firstSheet = workbookXml.match(/<sheet\b[^>]*(?:r:id|id)="([^"]+)"/);
  const relationId = firstSheet?.[1];

  if (relationId && relsXml) {
    const relation = [...relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)]
      .map((match) => ({ id: attrValue(match[1], "Id"), target: attrValue(match[1], "Target") }))
      .find((item) => item.id === relationId);
    if (relation?.target) return normalizeZipPath(relation.target.startsWith("/") ? relation.target.slice(1) : `xl/${relation.target}`);
  }

  if (entries.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  const fallback = [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!fallback) throw new Error("未找到 Excel 工作表");
  return fallback;
}

function normalizeZipPath(value) {
  const parts = [];
  clean(value).replace(/\\/g, "/").split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });
  return parts.join("/");
}

function readZipText(entries, name, fallback = "") {
  const item = entries.get(name);
  return item ? item.toString("utf-8") : fallback;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const textParts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((textMatch) => decodeXml(textMatch[1]));
    return textParts.join("");
  });
}

function parseCellValue(attrs, body, sharedStrings) {
  const type = attrValue(attrs, "t");
  if (type === "inlineStr") {
    const text = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
    return text;
  }
  const value = decodeXml(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || "");
  if (type === "s") return sharedStrings[Number(value)] || "";
  return value;
}

function attrValue(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function columnIndex(ref) {
  const letters = clean(ref).match(/[A-Z]+/i)?.[0]?.toUpperCase() || "";
  return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value) {
  return clean(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
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
    ticketKey: `${context.ticketType}::${ticketNo}`,
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
    lastImportedBy: context.importedBy,
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

function decodeBase64File(value) {
  const text = clean(value);
  const base64 = text.includes(",") ? text.slice(text.indexOf(",") + 1) : text;
  return Buffer.from(base64, "base64");
}

function filterRowsForTicketType(rows, selectedType) {
  const target = normalizeTicketTypeName(selectedType);
  return (rows || []).filter((row) => {
    const detected = normalizeTicketTypeName(extractImportedTicketType(row));
    return !detected || detected === target;
  });
}

function extractImportedTicketType(row = {}) {
  return firstClean(row, ["工单类型", "类型", "业务类型", "单据类型", "客诉类型", "来源类型"]);
}

function normalizeTicketTypeName(value) {
  const text = clean(value);
  if (!text) return "";
  if (TICKET_TYPES.includes(text)) return text;
  if (text.includes("质量")) return "质量工单";
  if (text.includes("支持")) return "支持工单";
  if (text.includes("市场")) return "市场工单";
  if (text.includes("供应")) return "供应工单";
  return "";
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
  if (!date) return text;
  return formatDate(date);
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

function isEndedStatus(value) {
  return clean(value) === "已结束";
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueTicketTypes(rows) {
  return [...new Set((rows || []).map((row) => clean(row.ticketType)).filter(Boolean))];
}

async function supabaseFetch(endpoint, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${text}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function readStore() {
  try {
    return ensureStoreShape(JSON.parse(await fs.readFile(DATA_FILE, "utf-8")));
  } catch {
    return ensureStoreShape({});
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(ensureStoreShape(store), null, 2), "utf-8");
}

function ensureStoreShape(store) {
  return {
    baseTickets: Array.isArray(store?.baseTickets) ? store.baseTickets : [],
    manualFields: Array.isArray(store?.manualFields) ? store.manualFields : [],
    projectFollowups: Array.isArray(store?.projectFollowups) ? store.projectFollowups : [],
    importLogs: Array.isArray(store?.importLogs) ? store.importLogs : [],
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf-8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowed = !origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin);
  if (allowed && origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function storageMode() {
  return USE_SUPABASE ? "supabase" : "local-json";
}

function toDb(record, map) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [map[key] || key, emptyToNull(value)]));
}

function fromDb(record, map) {
  return Object.fromEntries(Object.entries(record || {}).map(([key, value]) => [map[key] || key, value ?? ""]));
}

function invert(map) {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key]));
}

function compactRecord(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null));
}

function emptyToNull(value) {
  if (value === "") return null;
  return value;
}

function clean(value) {
  return String(value ?? "").trim();
}

function textToBoolean(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  const text = clean(value).toLowerCase();
  return ["true", "t", "1", "yes", "y", "是", "有", "有卡点"].includes(text);
}

function parseProgress(value) {
  const number = Number(clean(value).replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

function cleanEnv(value) {
  const text = clean(value);
  if (!text || text.startsWith("your-")) return "";
  return text;
}

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  try {
    const lines = require("node:fs").readFileSync(envPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!process.env[key]) process.env[key] = value.replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // .env is optional.
  }
}
