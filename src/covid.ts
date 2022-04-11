import { sumBy, isEqual, map, uniqBy, sortBy, reject, flatten, compact, size } from 'lodash';
import { Workbook, Font, Alignment } from 'exceljs';
import axios from 'axios';
import {
  Area,
  fetchData,
  renderTable,
  groupAreas,
  downloadFile,
  parseRows,
  compareAreas,
  formatDate,
  groupAreaChangesBy,
  isBrowser,
  isDev,
  PROD_DATA_URL,
  Cell,
} from './utils';
import { getData, saveData } from './cache';

const TableHeaders = [
  { key: 'level', value: '风险等级', width: 15 },
  { key: 'province', value: '省', width: 12 },
  { key: 'city', value: '市', width: 12 },
  { key: 'region', value: '县/区', width: 30 },
  { key: 'addr', value: '风险地区', width: 60 },
];

const TableStyle = 'border="1" style="text-align:center;border-collapse:collapse;"';

export type CovidData = {
  high: Area[];
  middle: Area[];
  update: number;
  create: number;
};

export async function getLatestData(limit = 10) {
  let data = getData<CovidData[]>() ?? [];
  if (isBrowser && !isDev) {
    try {
      const response = await axios.get<CovidData[]>(PROD_DATA_URL, {
        params: { size: 10 },
        timeout: 1000 * 10,
      });
      data = data.concat(response.data);
    } catch (err) {}
  } else {
    const response = await fetchData();
    data = reject(data, { update: response.time.getTime() });
    data.push({
      high: response.high,
      middle: response.middle,
      update: response.time.getTime(),
      create: Date.now(),
    });
  }

  data = uniqBy(data, 'update');
  data = sortBy(data, 'create');
  data = data.filter((item) => !!item.update);
  data = data.slice(-limit);
  saveData(data);

  return data;
}

export async function statistic(current: CovidData, source?: CovidData) {
  const highAreas = groupAreas(current.high);
  const middleAreas = groupAreas(current.middle);
  const groups = [
    { name: '高风险地区', size: sumBy(highAreas, 'size'), data: highAreas },
    { name: '中风险地区', size: sumBy(middleAreas, 'size'), data: middleAreas },
  ];

  const highChanges = compareAreas(source?.high, current.high);
  const middleChanges = compareAreas(source?.middle, current.middle);
  const provinceChanges = groupAreaChangesBy(
    { high: highChanges, middle: middleChanges },
    'province',
  );

  const getDesc = () => {
    const provinceMap: string[] = [];
    Object.entries(provinceChanges).forEach(([province, { high = {}, middle = {} }]) => {
      let text = province;
      const cities = compact(
        uniqBy(flatten([high.add, high.remove, middle.add, high.remove]), 'city'),
      );
      if (cities.length === 1) {
        const { city } = cities[0];
        text += city === province ? '' : city;
      }

      const notes: string[] = [];

      const highAdd = size(high.add);
      const highRemove = size(high.remove);
      const midAdd = size(middle.add);
      const midRemove = size(middle.remove);

      if (highAdd) {
        notes.push(`增加${highAdd}个高风险地区`);
      }
      if (highRemove) {
        notes.push(`减少${highRemove}个高风险地区`);
      }
      if (midAdd) {
        notes.push(`增加${midAdd}个中风险地区`);
      }
      if (midRemove) {
        notes.push(`减少${midRemove}个中风险地区`);
      }

      provinceMap.push(text + notes.join('，'));
    });
    return provinceMap.join('；');
  };

  const getRows = () => {
    const totalAdd = [...highChanges.add, ...middleChanges.add];
    const groupRows = parseRows(groups);
    groupRows.forEach((row) => {
      row.forEach((cell) => {
        if (totalAdd.find((area) => isEqual(area, cell.origin))) {
          cell.new = true;
        }
      });
    });

    return groupRows;
  };

  return {
    highSize: current.high.length,
    middleSize: current.middle.length,
    updatedAt: new Date(current.update),
    createdAt: new Date(current.create),
    groups,
    groupRows: getRows(),
    summary: getDesc(),
  };
}

export type Statistic = Awaited<ReturnType<typeof statistic>>;

export function renderHtml(rows: Cell[][], style = TableStyle) {
  const table = renderTable(rows, style);
  const tableHeader = TableHeaders.map(({ value }) => `<th>${value}</th>`).join('');
  return table.replace('<tr>', `<tr>${tableHeader}</tr>\n<tr>`);
}

export async function toExcel(stat: Statistic) {
  const { highSize, middleSize, groupRows, createdAt, summary } = stat;

  const workbook = new Workbook();
  workbook.creator = 'Limmio';
  workbook.created = new Date(createdAt);

  const sheet = workbook.addWorksheet();

  const baseFont: Partial<Font> = { size: 12 };
  const titleFont: Partial<Font> = { size: 18 };
  const alignment: Partial<Alignment> = {
    vertical: 'middle',
    horizontal: 'center',
    wrapText: true,
  };
  const rowHeight = sheet.properties.defaultRowHeight;
  const wordsOfLine = 40;

  const columns = [
    { key: 'level', value: '风险等级', width: 15 },
    { key: 'province', value: '省', width: 12 },
    { key: 'city', value: '市', width: 12 },
    { key: 'region', value: '县/区', width: 30 },
    { key: 'addr', value: '风险地区', width: 60 },
  ];

  // 表头行
  const headerRow = sheet.addRow(map(columns, 'value'));
  headerRow.height = 32;

  columns.forEach(({ width }, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = width;
    column.alignment = alignment;
    column.font = baseFont;

    const cell = headerRow.getCell(i + 1);
    cell.font = { ...baseFont, bold: true };
  });

  // 第一行
  const title = '全国疫情中高风险地区（实时更新）';
  const titleRow = sheet.insertRow(1, [title]);
  titleRow.height = 55;
  titleRow.font = titleFont;
  titleRow.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.mergeCells('A1:E1');

  // 第二行
  // prettier-ignore
  const note = `截止${formatDate(createdAt, 'M月D日HH:mm')}，${summary}。目前，国内共有${highSize}个高风险地区，${middleSize}个中风险地区。`;
  const noteRow = sheet.insertRow(2, [note]);
  noteRow.height = Math.max(55, Math.ceil((note.length / wordsOfLine) * rowHeight));
  noteRow.font = baseFont;
  noteRow.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  sheet.mergeCells('A2:E2');

  const rowOffset = sheet.actualRowCount;
  // 插入表格
  groupRows.forEach((groupRow) => {
    sheet.addRow(map(groupRow, 'text'));
  });
  // 合并表格单元、样式
  groupRows.forEach((groupRow, rowIndex) => {
    groupRow.forEach(({ rowspan = 1, colspan = 1, text, new: isNew }, colIndex) => {
      if (!text) {
        return;
      }

      const rowStart = rowOffset + rowIndex + 1;
      const colStart = colIndex + 1;

      if (rowspan > 1) {
        const rowEnd = rowStart + rowspan - 1;
        const colEnd = colStart + colspan - 1;
        sheet.mergeCells(rowStart, colStart, rowEnd, colEnd);
      }

      if (isNew) {
        const cell = sheet.getCell(rowStart, colStart);
        if (cell) {
          cell.font = { ...cell.font, color: { argb: 'FFFF0000' } };
        }
      }
    });
  });

  // 添加边框
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });
  });

  return workbook;
}

export async function downloadExcel(workbook: Workbook, name?: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = name ?? `${formatDate(workbook.created, 'M月D日')}全国中高风险地区明细.xlsx`;
  downloadFile(new Blob([buffer]), filename);
}
