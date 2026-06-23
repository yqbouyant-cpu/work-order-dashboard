(() => {
  async function parseFile(file) {
    const name = String(file?.name || "").toLowerCase();
    if (name.endsWith(".csv")) return parseCsv(await file.text());
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseWorkbook(file);
    throw new Error("暂只支持 .xlsx / .xls / .csv 文件");
  }

  async function parseWorkbook(file) {
    if (!window.XLSX?.read) {
      throw new Error("Excel 解析库未加载，请检查网络后重试，或先把文件另存为 CSV 再导入");
    }
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    return rows.map(normalizeRecord);
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

    return rowsToRecords(rows);
  }

  function rowsToRecords(rows) {
    const firstRowIndex = rows.findIndex((item) => item.some((cell) => clean(cell)));
    if (firstRowIndex === -1) return [];
    const headers = rows[firstRowIndex].map((header, index) => {
      const text = index === 0 ? clean(header).replace(/^\uFEFF/, "") : clean(header);
      return text || `字段${index + 1}`;
    });

    return rows
      .slice(firstRowIndex + 1)
      .filter((cells) => cells.some((cell) => clean(cell)))
      .map((cells) => {
        const record = {};
        headers.forEach((header, index) => {
          record[header] = clean(cells[index]);
        });
        return record;
      });
  }

  function normalizeRecord(row) {
    const record = {};
    Object.entries(row || {}).forEach(([key, value]) => {
      record[clean(key)] = normalizeValue(value);
    });
    return record;
  }

  function normalizeValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, "0");
      const d = String(value.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return clean(value);
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  window.WorkorderImportParser = { parseFile, parseCsv };
})();
