import axios from 'axios';
import { Cheerio, load, Element } from 'cheerio';
import { entries, groupBy, compact } from 'lodash';

export type Area = {
  province: string;
  city: string;
  region: string;
  addr: string;
};

export type AreaTree = {
  name: string;
  size: number;
  data: AreaTree[] | Area[];
};

export async function fetchData() {
  const url = 'http://m.sh.bendibao.com/news/gelizhengce/fengxianmingdan.php';
  const isDev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
  const finalUrl = isDev ? url.replace(/https?:\/\/[a-z\.]*?\//, '/') : url;

  const result = await axios.get<string>(finalUrl, { responseType: 'text' });
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
          $(el)
            .next()
            .find('li>span')
            .each((_, el) => {
              const address = $(el).text();
              const region = address.match(/(\S*?[区县市镇])/)?.[1] ?? '';
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

  return { time: new Date(time), high, middle };
}

export function parseTrees(data: Area[]): AreaTree[] {
  const tree = (data: Area[], keys: (keyof Area)[]): any => {
    const [key, ...rest] = keys;
    if (key) {
      const map = groupBy(data, key);
      return entries(map).map(([name, data]) => ({
        name,
        size: data.length,
        data: tree(data, rest),
      }));
    }

    return data;
  };

  return tree(data, ['province', 'city', 'region']);
}

export function renderTable(trees: AreaTree[], style = '') {
  const fillCols = (tree: AreaTree | Area, cols: (string | undefined)[][], level = 0) => {
    if (!cols[level]) {
      cols[level] = [];
    }

    if ('name' in tree) {
      const { name, size, data } = tree;
      const items = Array.from({ length: size }, (_, i) =>
        i === 0 ? `<td rowspan="${size}">${name}(${size})</td>` : undefined,
      );
      cols[level].push(...items);

      data.forEach((item) => fillCols(item, cols, level + 1));
    } else {
      const { addr } = tree;
      cols[level].push(`<td>${addr}</td>`);
    }

    return cols;
  };

  const colsToRows = (cols: (string | undefined)[][]) => {
    const size = Math.max(...cols.map((col) => col.length));
    return Array.from({ length: size }, (_, i) => {
      const row = compact(cols.map((col) => col[i]));
      return row;
    });
  };

  const cols: (string | undefined)[][] = [];
  trees.forEach((tree) => fillCols(tree, cols));

  const rows = colsToRows(cols);
  const table = rows.map((row) => `<tr>\n${row.join('')}\n</tr>`).join('\n');
  return `<table ${style}>\n${table}\n</table>`;
}

export function parseAreas(table: string) {
  const $ = load(table);
  const cols = [] as (string | undefined)[][];
  $('tr').each((_, el) => {
    $(el)
      .find('td')
      .each((i, td) => {
        if (!cols[i]) {
          cols[i] = [];
        }

        const size = Number($(td).attr('rowspan') ?? 1);
        const text = $(td).text();
        cols[i].push(...Array.from({ length: size }, () => text));
      });
  });
  return cols;
}
