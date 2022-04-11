import React, { useEffect, useState } from 'react';
import { utils, writeFile } from 'xlsx';
import { fetchData, renderTable, parseTrees, parseAreas } from './utils';

export default () => {
  const [data, setData] = useState('');

  useEffect(() => {
    fetchData().then((d) => {
      const trees = parseTrees([...d.high]);
      const table = renderTable(trees, 'border="1"');
      setData(table);
    });
  }, []);

  const handleExport = () => {
    const table = document.getElementById('table')?.querySelector('table');
    if (table) {
      // const workbook = utils.table_to_book(table);
      // writeFile(workbook, 'a.xlsx');
      console.log(parseAreas(table.outerHTML))
    }
  };

  return (
    <div>
      <button onClick={handleExport}>导出</button>
      <div id="table" dangerouslySetInnerHTML={{ __html: data }} />
    </div>
  );
};
