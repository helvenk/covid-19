import axios from 'axios';
import { Cheerio, load, Element } from 'cheerio';
import { entries, groupBy, isEqual, set, omit, pick, find, omitBy, isNil } from 'lodash';

export const PROD_DATA_URL = '/covid/data';

export type Area = {
  province: string;
  city: string;
  region: string;
  addr: string;
  origin?: Omit<Area, 'origin'>;
};

export type AreaGroup = {
  name: string;
  level?: keyof Area;
  size: number;
  data: AreaGroup[] | Area[];
};

export type AreaFix = { data: Area; fix: Partial<Exclude<Area['origin'], undefined>> };

export type Cell = {
  span?: {
    row: [number, number];
    col: [number, number];
  };
  rowspan?: number;
  colspan?: number;
  text: string;
  count?: number;
  origin: AreaGroup | Area;
  new?: boolean;
};

export const isDev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

export const isBrowser = typeof window !== 'undefined';

export const isGithubPages = typeof process !== 'undefined' && process.env.GH_PAGES === '1';

export const isLocalDev = isGithubPages || (isDev && isBrowser);

export type CovidData = {
  high: Area[];
  middle: Area[];
  create: number;
  update: number;
  download?: boolean;
};

export type CovidDataFixes = {
  data: CovidData[];
  fixes: AreaFix[];
};

export async function fetchData() {
  const url = 'http://m.sh.bendibao.com/news/gelizhengce/fengxianmingdan.php';
  const finalUrl = isDev ? url.replace(/https?:\/\/[a-z\.]*?\//, '/') : url;

  const result = await axios.get<string>(finalUrl, {
    responseType: 'text',
    params: { t: Date.now() },
    headers: { 'cache-control': 'no-cache' },
  });
  const $ = load(result.data);

  const parseAreas = (element: Cheerio<Element>) => {
    const results: Area[] = [];

    element.find('.info-list').each((_, info) => {
      $(info)
        .find('.shi')
        .each((_, el) => {
          const $span = $(el).find('p>span');
          const province = $span.first().text().trim();
          const city = $span.last().text().trim();
          const cityReg = new RegExp(`^${city}`);
          $(el)
            .next()
            .find('li>span')
            .each((_, el) => {
              let address = $(el).text().replace(cityReg, '');
              let region = address.match(/(\S+?[市县区镇])/)?.[1] ?? '';

              // 存在括号
              if (/[(（]/.test(region)) {
                region = '';
              }

              // 以 小区、服务区结尾
              if (/(小区|服务区)$/.test(region)) {
                region = '';
              }

              results.push({
                province,
                city,
                region,
                addr: address.replace(region, ''),
              });
            });
        });
    });

    return results;
  };

  const time = $('.time').text().trim().replace('截至', '');
  const high = parseAreas($('.height.info-item'));
  const middle = parseAreas($('.middle.info-item'));

  return { create: Date.now(), update: new Date(time).getTime(), high, middle } as CovidData;
}

export function getAddress(area: Area) {
  const { province, city, region, addr } = area;
  return [province, city, region, addr].join('');
}

export function isEqualData(source: CovidData, target: CovidData) {
  const props = ['high', 'middle'];
  return isEqual(pick(source, props), pick(target, props));
}

export function isEqualAddress(area1: Area, area2: Area, deep = false) {
  return (
    getAddress(area1) === getAddress(area2) &&
    (!deep ||
      isEqual(
        pick(area1, ['province', 'city', 'region', 'addr']),
        pick(area2, ['province', 'city', 'region', 'addr']),
      ))
  );
}

export function mergeAreasWithFixes(areas: Area[], fixes: AreaFix[]) {
  return areas.map((area) => {
    const { fix } = find(fixes, ({ data }) => isEqualAddress(data, area)) ?? {};
    return { ...area, ...omitBy(fix, isNil), origin: area } as Area;
  });
}

export function mergeCovidDataFixes(data: CovidData[], fixes: AreaFix[]) {
  return data.map((item) => ({
    ...item,
    high: mergeAreasWithFixes(item.high, fixes),
    middle: mergeAreasWithFixes(item.middle, fixes),
  }));
}

export function groupAreas(data: Area[]): AreaGroup[] {
  const tree = (data: Area[], levels: (keyof Area)[]): AreaGroup[] | Area[] => {
    const [level, ...rest] = levels;
    if (level) {
      const map = groupBy(data, level);
      return entries(map).map(([name, data]) => ({
        name,
        level,
        size: data.length,
        data: tree(data, rest),
      }));
    }

    return data;
  };

  return tree(data, ['province', 'city', 'region']) as any;
}

export function parseRows(groups: AreaGroup[]) {
  const fillCols = (groupOrArea: AreaGroup | Area, cols: Cell[][], level = 0) => {
    if (!cols[level]) {
      cols[level] = [];
    }

    if ('name' in groupOrArea) {
      const { name, size, data } = groupOrArea;
      const items = Array.from({ length: size }, (_, i) =>
        i === 0
          ? { rowspan: size, text: `${name}(${size})`, origin: groupOrArea }
          : { text: '', origin: groupOrArea },
      );
      cols[level].push(...items);
      data.forEach((item) => fillCols(item, cols, level + 1));
    } else {
      const { addr } = groupOrArea;
      cols[level].push({ text: addr, origin: groupOrArea });
    }

    return cols;
  };

  const colsToRows = (cols: Cell[][]) => {
    const size = Math.max(...cols.map((col) => col.length));
    return Array.from({ length: size }, (_, i) => cols.map((col) => col[i]));
  };

  const mergeCells = (rows: Cell[][]) => {
    const mergeCell = (cells: Cell[]) => {
      cells.forEach((cell, i) => {
        const nextCell = cells[i + 1];
        if (nextCell && nextCell.text && nextCell.text === cell.text) {
          cell.colspan = (cell.colspan ?? 1) + 1;
          nextCell.text = '';
        }
      });
    };

    rows.forEach(mergeCell);
  };

  const cols: Cell[][] = [];
  groups.forEach((tree) => fillCols(tree, cols));

  const rows = colsToRows(cols);
  mergeCells(rows);
  return rows;
}

export function renderTable(rows: Cell[][], style = '') {
  const renderCell = ({ text, rowspan = 1, colspan = 1, new: isNew }: Cell) => {
    if (text) {
      const style = isNew ? ' style="color: red;"' : '';
      return `<td rowspan=${rowspan} colspan=${colspan}${style}>${text}</td>`;
    }
  };
  const renderRow = (row: Cell[]) => {
    const cells = row.map(renderCell).join('');
    return `<tr>\n${cells}\n</tr>`;
  };
  const table = rows.map(renderRow).join('\n');
  return `<table ${style}>\n${table}\n</table>`;
}

export function compareAreas(soure?: Area[], target?: Area[]) {
  if (!soure || !target) {
    return { add: [], remove: [] };
  }

  const compare = (areas1: Area[], areas2: Area[]) =>
    areas1.filter((area1) => !areas2.some((area2) => isEqualAddress(area1, area2)));

  const add = compare(target, soure);
  const remove = compare(soure, target);
  return { add, remove };
}

export function groupAreaChangesBy<T extends string>(
  changes: Record<T, { add: Area[]; remove: Area[] }>,
  key: keyof Area,
) {
  const provinceMap = {} as Record<string, typeof changes>;

  Object.keys(changes).forEach((level) => {
    const change = changes[level as T];
    const addMap = groupBy(change.add, key);
    const removeMap = groupBy(change.remove, key);

    Object.entries(addMap).forEach(([province, areas]) => {
      set(provinceMap, [province, level, 'add'], areas);
    });
    Object.entries(removeMap).forEach(([province, areas]) => {
      set(provinceMap, [province, level, 'remove'], areas);
    });
  });

  return provinceMap;
}

export function parseTable(table: string) {
  const $ = load(table);

  const fillCols = (cols: string[][]) => {
    let maxColNum = 0;

    $('tr').each((rowNum, el) => {
      const $cols = $(el).find('td');

      if (rowNum === 0) {
        maxColNum = $cols.length;
      }

      const offset = maxColNum - $cols.length;

      $cols.each((i, td) => {
        i += offset;

        if (!cols[i]) {
          cols[i] = [];
        }

        const size = Number($(td).attr('rowspan') ?? 1);
        const text = $(td)
          .text()
          .replace(/\(\d+\)$/, '');
        cols[i].push(...Array.from({ length: size }, () => text));
      });
    });
  };

  const colsToRows = (cols: string[][]) => {
    const size = Math.max(...cols.map((col) => col.length));

    return Array.from({ length: size }, (_, i) => {
      const areaCol = cols.map((col) => col[i]);
      const [level, province = '', city = '', region = '', addr = ''] = areaCol.slice();
      return { level, province, city, region, addr } as Area;
    });
  };

  const cols = [] as string[][];
  fillCols(cols);

  const rows = colsToRows(cols);
  const [high, middle] = Object.values(groupBy(rows, 'level'));
  return {
    high: high.map((item) => omit(item, 'level')),
    middle: middle.map((item) => omit(item, 'level')),
  };
}

export function downloadFile(file: Blob, name: string) {
  const link = document.createElement('a');
  link.style.display = 'none';
  link.download = name;
  link.href = URL.createObjectURL(file);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function formatDate(time: number | Date | string, format: string) {
  const date = new Date(time);

  const padZero = (value: number, len = 2) => String(value).padStart(len, '0');

  const formatMap = {
    YYYY: () => date.getFullYear(),
    M: () => date.getMonth() + 1,
    MM: () => padZero(date.getMonth() + 1),
    D: () => date.getDate(),
    DD: () => padZero(date.getDate()),
    H: () => date.getHours(),
    HH: () => padZero(date.getHours()),
    m: () => date.getMinutes(),
    mm: () => padZero(date.getMinutes()),
    s: () => date.getSeconds(),
    ss: () => padZero(date.getSeconds()),
  };

  const replacer = (keyword: string) => {
    const fn = formatMap[keyword as keyof typeof formatMap];
    return String(fn?.() ?? keyword);
  };

  return format.replace(/[a-zA-Z]+/g, replacer);
}
