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
              const lastCellArea = last(col)!.origin as Area;

              if (markEmpty) {
                if (isArea && (!origin.region || !origin.addr)) {
                  Object.assign(style, borderStyle, { borderLeftColor: 'transparent' });
                  return (
                    <td key={j} rowSpan={rowspan} colSpan={colspan} style={style}>
                      <EditCell
                        defaultValue={origin.addr}
                        onChange={(value) => onEdit(lastCellArea, ['addr', value])}
                      />
                    </td>
                  );
                }

                if (isArea && origin.region) {
                  Object.assign(style, { display: 'none' });
                }

                if (!isArea && origin.level === 'region' && (!origin.name || !lastCellArea.addr)) {
                  Object.assign(style, borderStyle, { borderRightColor: 'transparent' });
                  return (
                    <td key={j} colSpan={colspan} style={style}>
                      <EditCell
                        defaultValue={origin.name}
                        onChange={(value) => onEdit(lastCellArea, [origin.level!, value])}
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

function renderDiff({ changes }: Statistic) {
  const props = { border: '1' };

  const renderArea = (add: string[] = [], remove: string[] = []) => {
    return (
      <td>
        {remove.map((o) => (
          <div key={o} style={{ color: '#aaa', textDecoration: 'line-through' }}>
            {o}
          </div>
        ))}
        {add.map((o) => (
          <div key={o} style={{ color: 'red' }}>
            {o}
          </div>
        ))}
      </td>
    );
  };

  return (
    <table {...props} style={{ textAlign: 'center', borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <td style={{ width: 100 }}>???/???</td>
          <td>???????????????</td>
          <td>???????????????</td>
        </tr>
      </thead>
      <tbody>
        {Object.entries(changes).map(([p, { high = {}, middle = {} }]) => (
          <tr key={p}>
            <td>{p}</td>
            {renderArea(high.add, high.remove)}
            {renderArea(middle.add, middle.remove)}
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

  const [diff, setDiff] = useState<Statistic>();

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
        emptySize: sumBy([...current.high, ...current.middle], (o) => Number(!o.region || !o.addr)),
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
        shouldDownload = window.confirm('??????????????????????????????????????????');
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
      ({ data, fix }, i) => `${i + 1}. ${getAddress(data)}\n???${getAddress({ ...data, ...fix })}`,
    );
    if (updates.length <= 0) {
      window.alert('???????????????????????????');
      return;
    }

    if (window.confirm(`???????????????????????? ${updates.length} ????????????\n${updates.join('\n')}`)) {
      await syncAreaFixes(
        modifiedAreas.current.map(({ data, fix }) => ({ data: data.origin ?? data, fix })),
      );
      window.location.reload();
    }
  };

  const handleDiff = () => {
    setDiff(stat);
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
            <span>??????????????? </span>
            <select
              style={{ padding: 4, fontSize: 14 }}
              value={selected?.create}
              onChange={handleSelect}
            >
              {stat.options.map((data) => (
                <option key={data.create} value={data.create}>
                  {formatDate(data.create, 'M???D???HH:mm')}
                  {data.download && ' (?????????) '}
                </option>
              ))}
            </select>
          </div>
          <button style={{ whiteSpace: 'nowrap', margin: '0 8px' }} onClick={handleDiff}>
            ????????????
          </button>
          <button style={{ whiteSpace: 'nowrap' }} onClick={handleExport}>
            ????????? Excel
          </button>
        </div>
      )}
      {loading && <div>??????????????????...</div>}
      {stat && !loading && (
        <>
          <p>
            <span>?????? {formatDate(stat.createdAt, 'M???D???HH:mm')}???</span>
            <span>??????????????? {stat.highSize} ??????</span>
            <span>??????????????? {stat.middleSize} ??????</span>
          </p>
          {stat.summary && <p style={{ marginTop: 16, lineHeight: 1.6 }}>{stat.summary}???</p>}
          {stat.emptySize > 0 && (
            <p>
              <span>
                <input
                  id="markEmpty"
                  type="checkbox"
                  checked={config.markEmpty}
                  onChange={(e) => setConfig({ markEmpty: !!e.target.checked })}
                />
                <label htmlFor="markEmpty">????????????????????? (???{stat.emptySize}???)</label>
              </span>
              {config.markEmpty && (
                <button style={{ marginLeft: 24, whiteSpace: 'nowrap' }} onClick={handleModify}>
                  ????????????
                </button>
              )}
            </p>
          )}
          <div id="table">{renderTable(stat.groupRows, { ...config, onEdit: handleEdit })}</div>
        </>
      )}
      {diff && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setDiff(undefined)}
        >
          <div
            style={{
              width: '60vw',
              background: 'white',
              height: '70vh',
              padding: 24,
              borderRadius: 10,
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderDiff(stat!)}
          </div>
        </div>
      )}
    </div>
  );
};
