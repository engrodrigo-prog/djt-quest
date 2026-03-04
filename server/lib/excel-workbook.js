import ExcelJS from 'exceljs';

const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const hasXlsxSignature = (buffer) =>
  Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.subarray(0, 4).equals(XLSX_SIGNATURE);

const cellValueToString = (value) => {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => cellValueToString(item)).join(', ');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.result !== 'undefined') return cellValueToString(value.result);
    if (typeof value.hyperlink === 'string' && typeof value.text === 'string') return value.text;
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => String(part?.text || '')).join('');
    }
    if (typeof value.formula === 'string' && typeof value.result === 'undefined') return value.formula;
  }
  return String(value);
};

const worksheetToRows = (worksheet, options = {}) => {
  const maxRows = Number.isFinite(options.maxRows) ? Math.max(1, Number(options.maxRows)) : null;
  const maxColumns = Number.isFinite(options.maxColumns) ? Math.max(1, Number(options.maxColumns)) : null;
  const rowLimit = maxRows ? Math.min(worksheet.rowCount || 0, maxRows) : worksheet.rowCount || 0;
  const columnLimitBase = worksheet.columnCount || worksheet.actualColumnCount || 0;
  const rows = [];

  for (let rowIndex = 1; rowIndex <= rowLimit; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const rowColumnCount = Math.max(columnLimitBase, row.cellCount || 0, row.actualCellCount || 0);
    const columnLimit = maxColumns ? Math.min(rowColumnCount, maxColumns) : rowColumnCount;
    const out = [];
    for (let colIndex = 1; colIndex <= columnLimit; colIndex += 1) {
      out.push(cellValueToString(row.getCell(colIndex).value).trim());
    }
    rows.push(out);
  }

  return rows;
};

export async function readWorkbookRows(buffer, options = {}) {
  if (!hasXlsxSignature(buffer)) {
    throw new Error('Formato XLS legado não suportado. Converta a planilha para XLSX.');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets?.[0];
  if (!worksheet) return { sheetName: null, rows: [] };

  return {
    sheetName: String(worksheet.name || '').trim() || null,
    rows: worksheetToRows(worksheet, options),
  };
}

export async function buildWorkbookBuffer({ sheetName = 'Sheet1', rows = [] } = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(String(sheetName || 'Sheet1'));
  for (const row of Array.isArray(rows) ? rows : []) {
    worksheet.addRow(Array.isArray(row) ? row : []);
  }
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
