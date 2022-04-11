import React, { ChangeEvent, useEffect, useState } from 'react';
import { find, last, reject } from 'lodash';
import {
  renderHtml,
  Statistic,
  statistic,
  toExcel,
  downloadExcel,
  getLatestData,
  markAsExported,
} from './covid';
import { formatDate, CovidData } from './utils';

export default () => {
  const [stat, setStat] = useState<
    Statistic & { options: CovidData[]; data: CovidData[]; current: CovidData }
  >();
  const [selected, setSelected] = useState<CovidData>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const compare = async () => {
      setLoading(true);
      const data = stat?.data ?? (await getLatestData());
      const current = last(data)!;
      const options = reject(data, current);
      const prev = selected ?? last(options);
      const results = statistic(current, prev);
      setStat({ ...results, options, data, current });
      setSelected(prev);
      setLoading(false);
    };

    compare();
  }, [selected, stat?.data]);

  const handleExport = async () => {
    if (stat) {
      let shouldDownload = true;
      if (!stat.summary) {
        shouldDownload = window.confirm('数据没有变化，确定要导出吗？');
      }
      if (shouldDownload) {
        downloadExcel(await toExcel(stat));
        const nextData = await markAsExported(stat.data, stat.current.create);
        setStat((prev) => ({ ...prev, data: nextData } as any));
      }
    }
  };

  const handleSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    setSelected(find(stat?.options, { create: Number(e.target.value) }));
  };

  return (
    <div style={{ margin: 'auto', maxWidth: 1080 }}>
      {stat && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            maxWidth: 420,
            margin: '1em 0',
          }}
        >
          <div>
            <span>对比数据： </span>
            <select
              style={{ padding: 4, fontSize: 14 }}
              value={selected?.create}
              onChange={handleSelect}
            >
              {stat.options.map((data) => (
                <option key={data.create} value={data.create}>
                  {formatDate(data.create, 'M月D日HH:mm')}
                  {data.download && ' (已导出) '}
                </option>
              ))}
            </select>
          </div>
          <button style={{ whiteSpace: 'nowrap' }} onClick={handleExport}>
            导出为 Excel
          </button>
        </div>
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
