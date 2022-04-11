import React, { FC, ChangeEvent, useEffect, useState, useRef } from 'react';
import { find, last, reject, sumBy, debounce } from 'lodash';
import {
  Statistic,
  statistic,
  toExcel,
  downloadExcel,
  getLatestData,
  markAsExported,
  TableHeaders,
  syncAreaFixes,
} from './covid';
import { formatDate, CovidData, Cell, Area, AreaGroup, AreaFix, getAddress } from './utils';

const EditCell: FC<{ defaultValue?: string; onChange?: (value: string) => void }> = ({
  defaultValue = '',
  onChange,
}) => {
  const handleChange = debounce((value: string) => {
    onChange?.(value);
  }, 100);

  return (
    <input
      style={{
        width: '100%',
        boxSizing: 'border-box',
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 1.2,
      }}
      defaultValue={defaultValue}
      onChange={(e) => handleChange(e.target.value)}
      autoComplete="new-password"
    />
  );
};

function renderTable(
  rows: Cell[][],
  {
    markEmpty = false,
    onEdit = (origin: Area | AreaGroup | undefined, value: [keyof Area, string]) => {},
  } = {},
) {
  const header = TableHeaders.map(({ value }) => <th key={value}>{value}</th>);
  const props = { border: '1' };

  return (
    <table {...props} style={{ textAlign: 'center', borderCollapse: 'collapse' }}>
      <thead>
        <tr>{header}</tr>
      </thead>
      <tbody>
        {rows.map((col, i) => (
          <tr key={i}>
            {col.map(({ text, rowspan = 1, colspan = 1, new: isNew, origin }, j) => {
              const style = isNew ? { color: 'red' } : {};
              const borderStyle = { color: '#f759ab', border: '3px dashed' };
              const isArea = 'addr' in origin;

              if (markEmpty) {
                if (isArea && !origin.region) {
                  Object.assign(style, borderStyle, { borderLeftColor: 'transparent' });
                  return (
                    <td key={j} rowSpan={rowspan} colSpan={colspan} style={style}>
                      <EditCell
                        defaultValue={text}
                        onChange={(value) => onEdit(last(col)?.origin, ['addr', value])}
                      />
                    </td>
                  );
                }

                if (isArea && origin.region) {
                  Object.assign(style, { display: 'none' });
                }

                if (!isArea && !origin.name && origin.level === 'region') {
                  Object.assign(style, borderStyle, { borderRightColor: 'transparent' });
                  return (
                    <td key={j} colSpan={colspan} style={style}>
                      <EditCell
                        onChange={(value) => onEdit(last(col)?.origin, [origin.level!, value])}
                      />
                    </td>
                  );
                }
              }

              if (text) {
                return (
                  <td key={j} rowSpan={rowspan} colSpan={colspan} style={style}>
                    {text}
                  </td>
                );
              }

              return null;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default () => {
  const [stat, setStat] = useState<
    Statistic & { options: CovidData[]; data: CovidData[]; current: CovidData; emptySize: number }
  >();
  const [selected, setSelected] = useState<CovidData>();
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({ markEmpty: false });
  const modifiedAreas = useRef<AreaFix[]>([]);

  useEffect(() => {
    const compare = async () => {
      setLoading(true);
      const data = stat?.data ?? (await getLatestData());
      const current = last(data)!;
      const options = reject(data, current);
      const prev = selected ?? last(options);
      const results = statistic(current, prev);
      setStat({
        ...results,
        options,
        data,
        current,
        emptySize: sumBy([...current.high, ...current.middle], (o) => Number(!o.region)),
      });
      setSelected(prev);
      setLoading(false);
    };

    compare();
  }, [selected, stat?.data]);

  useEffect(() => {
    modifiedAreas.current = [];
  }, [config.markEmpty]);

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

  const handleEdit = (data: Area | AreaGroup | undefined, [key, value]: [string, string]) => {
    if (!data || !key) {
      return;
    }

    if ('addr' in data) {
      const target = find(modifiedAreas.current, { data });
      if (target) {
        Object.assign(target.fix, { [key]: value });
      } else {
        modifiedAreas.current.push({ data, fix: { [key]: value } });
      }
    }
  };

  const handleModify = async () => {
    const updates = modifiedAreas.current.map(
      ({ data, fix }, i) => `${i + 1}. ${getAddress(data)}\n→${getAddress({ ...data, ...fix })}`,
    );
    if (updates.length <= 0) {
      window.alert('没有修正任何数据！');
      return;
    }

    if (window.confirm(`是否确认修正以下 ${updates.length} 个地区：\n${updates.join('\n')}`)) {
      await syncAreaFixes(
        modifiedAreas.current.map(({ data, fix }) => ({ data: data.origin ?? data, fix })),
      );
      window.location.reload();
    }
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
          {stat.emptySize > 0 && (
            <p>
              <span>
                <input
                  id="markEmpty"
                  type="checkbox"
                  checked={config.markEmpty}
                  onChange={(e) => setConfig({ markEmpty: !!e.target.checked })}
                />
                <label htmlFor="markEmpty">修正不完整地区 (共{stat.emptySize}个)</label>
              </span>
              {config.markEmpty && (
                <button style={{ marginLeft: 24, whiteSpace: 'nowrap' }} onClick={handleModify}>
                  保存修改
                </button>
              )}
            </p>
          )}
          <div id="table">{renderTable(stat.groupRows, { ...config, onEdit: handleEdit })}</div>
        </>
      )}
    </div>
  );
};
