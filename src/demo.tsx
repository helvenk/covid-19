import React, { ChangeEvent, useEffect, useState } from 'react';
import { find, last, reject } from 'lodash';
import {
  renderHtml,
  Statistic,
  statistic,
  toExcel,
  downloadExcel,
  CovidData,
  getLatestData,
} from './covid';
import { formatDate } from './utils';

export default () => {
  const [stat, setStat] = useState<Statistic & { options: CovidData[] }>();
  const [selected, setSelected] = useState<CovidData>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const compare = async () => {
      setLoading(true);
      const data = await getLatestData();
      const current = last(data)!;
      const options = reject(data, current);
      const prev = selected ?? last(options);
      const stat = await statistic(current, prev);
      setStat({ ...stat, options });
      setSelected(prev);
      setLoading(false);
    };

    compare();
  }, [selected]);

  const handleExport = async () => {
    if (stat) {
      let shouldDownload = true;
      if (!stat.summary) {
        shouldDownload = window.confirm('数据没有变化，确定要导出吗？');
      }
      if (shouldDownload) {
        downloadExcel(await toExcel(stat));
      }
    }
  };

  const handleSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    setSelected(find(stat?.options, { create: Number(e.target.value) }));
  };

  return (
    <div style={{ margin: 'auto', maxWidth: 1080 }}>
      {stat && (
        <p style={{ display: 'flex', alignItems: 'center' }}>
          <span>对比数据： </span>
          <select
            style={{ padding: 4, fontSize: 14 }}
            value={selected?.create}
            onChange={handleSelect}
          >
            {stat.options.map((data) => (
              <option key={data.create} value={data.create}>
                创建于{formatDate(data.create, 'M月D日HH:mm')}（更新于{formatDate(data.update, 'M月D日HH:mm')}）
              </option>
            ))}
          </select>
          <button style={{ marginLeft: 48 }} onClick={handleExport}>
            导出为 Excel
          </button>
        </p>
      )}
      {loading && <div>正在获取数据...</div>}
      {stat && !loading && (
        <>
          <p>
            <span>截至 {formatDate(stat.createdAt, 'M月D日HH:mm')}，</span>
            <span>高风险地区 {stat.highSize} 个，</span>
            <span>中风险地区 {stat.middleSize} 个。</span>
          </p>
          {stat.summary && <p style={{ marginTop: 16, lineHeight: 1.6 }}>{stat.summary}。</p>}
          <div id="table" dangerouslySetInnerHTML={{ __html: renderHtml(stat.groupRows) }} />
        </>
      )}
    </div>
  );
};
