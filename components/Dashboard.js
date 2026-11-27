'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Filler
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import {
  fmtEur, fmtPct, fmtNum, MONTHS, HOUSES_META,
} from '@/lib/format';
import { BRAND } from '@/config/brand';
import CanaliView from '@/components/Canali';
import { avvisiMisura } from '@/lib/canali';
import { prezziInVendita } from '@/lib/prezzi-vendita';
import { PREZZI_VENDITA_SOGLIE } from '@/config/prezzi-vendita';
import {
  kpiForHouseYear, kpiAggregatedYear, monthlySeries, availableYears,
  channelMix, topCountries, losByHouse, losDistribution,
  avgPartyByHouse, leadTimeStats, forwardBooking, filterReservations,
  pickupStats, orphanNights, channelMixForward, cancellationStats,
  lastPopulatedMonthIndex, kpiForHouseYearRange, kpiAggregatedRange, ALL_HOUSES,
} from '@/lib/aggregators';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Filler
);
ChartJS.defaults.color = BRAND.colors.inkMuted;
ChartJS.defaults.borderColor = 'rgba(85,107,88,0.14)';
ChartJS.defaults.font.family = 'Roboto, -apple-system, system-ui, sans-serif';

const PALETTE = BRAND.palette;
const C = BRAND.colors;
const CHART_OPTS_NO_LEGEND = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
const CHART_OPTS_LEGEND_BOTTOM = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } };

export default function Dashboard({ initialData, refreshAction }) {
  const [view, setView] = useState('overview');
  const [year, setYear] = useState(() => {
    const years = availableYears(initialData, 'all');
    return years[years.length - 1] || '2026';
  });
  // Multi-selezione case: array di houseId. Default = tutte.
  const [houses, setHouses] = useState(ALL_HOUSES);
  const [month, setMonth] = useState('all'); // 'all' | '0'..'11'
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);

  const allYears = availableYears(data, 'all');
  const reservations = data?.reservations || [];
  const monthIdx = month === 'all' ? null : parseInt(month, 10);

  // Helper: con 1 sola casa usa i KPI per-casa; con più (o nessuna) usa l'aggregato.
  const totals = useMemo(() => {
    if (houses.length === 0) return null;
    if (houses.length === 1) return kpiForHouseYear(data, houses[0], year, monthIdx);
    return kpiAggregatedYear(data, year, monthIdx, houses);
  }, [data, year, houses, monthIdx]);

  const totalsPrevYear = useMemo(() => {
    if (houses.length === 0) return null;
    const prev = String(parseInt(year, 10) - 1);
    // Mese specifico selezionato → confronto stesso mese vs stesso mese (già omogeneo)
    if (monthIdx != null) {
      return houses.length === 1 ? kpiForHouseYear(data, houses[0], prev, monthIdx) : kpiAggregatedYear(data, prev, monthIdx, houses);
    }
    // "Tutti i mesi" → confronta l'anno precedente SOLO sulla stessa finestra di mesi
    // popolati nell'anno corrente (YTD vs YTD). Per un anno completo = anno intero.
    const endIdx = lastPopulatedMonthIndex(data, houses, year);
    if (endIdx < 0) return null;
    return houses.length === 1 ? kpiForHouseYearRange(data, houses[0], prev, endIdx) : kpiAggregatedRange(data, prev, endIdx, houses);
  }, [data, year, houses, monthIdx]);

  async function handleRefresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/data?refresh=1', { cache: 'no-store' });
      if (res.ok) {
        const fresh = await res.json();
        setData(fresh);
      }
    } catch (e) {}
    setLoading(false);
  }

  return (
    <div className="min-h-screen">
      <Header
        data={data}
        year={year} setYear={setYear}
        houses={houses} setHouses={setHouses}
        month={month} setMonth={setMonth}
        years={allYears}
        loading={loading}
        onRefresh={handleRefresh}
        generatedAt={data?.generatedAt}
        cacheStatus={data?._cache}
      />
      <div className="max-w-[1600px] mx-auto px-6 lg:px-8 py-6">
        {data?._cache === 'stale' && (
          <div className="note mb-4"><strong>Dati non aggiornati.</strong> Guesty non ha risposto ({data._error}); mostro l'ultimo dato valido del {data.generatedAt && new Date(data.generatedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}.</div>
        )}
        {Array.isArray(data?.warnings) && data.warnings.length > 0 && (
          <div className="note mb-4"><strong>Avvisi sui dati:</strong> {data.warnings.join(' · ')}</div>
        )}
        <Tabs view={view} setView={setView} badges={{ canali: avvisiMisura(data, houses).length }} />

        {view === 'overview' && <OverviewView data={data} year={year} houses={houses} monthIdx={monthIdx} totals={totals} totalsPrev={totalsPrevYear} reservations={reservations} />}
        {view === 'trend' && <TrendView data={data} houses={houses} years={allYears} />}
        {view === 'forward' && <ForwardView data={data} houses={houses} />}
        {view === 'cancel' && <CancellationsView data={data} houses={houses} />}
        {view === 'audience' && <AudienceView data={data} reservations={reservations} houses={houses} year={year} monthIdx={monthIdx} />}
        {view === 'houses' && <HousesView data={data} year={year} monthIdx={monthIdx} houses={houses} setView={setView} setHouses={setHouses} />}
        {view === 'canali' && <CanaliView data={data} houses={houses} year={year} monthIdx={monthIdx} />}
      </div>
    </div>
  );
}

// ============================================================================
// HEADER + CONTROLS
// ============================================================================
function Header({ data, year, setYear, houses, setHouses, month, setMonth, years, loading, onRefresh, generatedAt, cacheStatus }) {
  return (
    <header className="brand-header">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-8 py-5 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <img src={BRAND.logoMark} alt={BRAND.name} className="h-12 w-auto" />
          <div>
            <div className="brand-sub">{BRAND.tagline}</div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="brand-title">{BRAND.name}</h1>
              <VersionTabs current="v2" />
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
              {ALL_HOUSES.length} strutture · dati live da Guesty dal {data?.startYear || 2025} · {generatedAt && `aggiornato ${new Date(generatedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`}
              {cacheStatus === 'hit' && <span className="ml-2 pill gray">cache</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={year} onChange={(e) => setYear(e.target.value)} className="ctl">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="ctl">
            <option value="all">Tutti i mesi</option>
            {MONTHS.map((m, i) => <option key={i} value={String(i)}>{m}</option>)}
          </select>
          <HouseMultiSelect houses={houses} setHouses={setHouses} />
          <button onClick={onRefresh} disabled={loading} className="ctl">
            {loading ? 'Aggiorno...' : 'Ricarica dati'}
          </button>
          <form action="/api/logout" method="POST">
            <button type="submit" className="px-3 py-2 text-sm hover:underline" style={{ color: 'var(--text-dim)' }} formMethod="post" onClick={async (e) => { e.preventDefault(); await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login'; }}>
              Esci
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

// Switch tra le due dashboard: V1 (fogli contabilità, storico completo) e V2 (Guesty live).
const V1_URL = 'https://dashboard.colosseumholidays.com';
const V2_URL = 'https://v2.dashboard.colosseumholidays.com';
function VersionTabs({ current }) {
  const base = { padding: '4px 12px', fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-sans)' };
  const on = { ...base, background: 'var(--brand)', color: '#faf6ee' };
  const off = { ...base, background: 'var(--panel)', color: 'var(--text-dim)' };
  return (
    <div className="inline-flex rounded overflow-hidden" style={{ border: '1px solid var(--border-strong)' }} title="Passa da una versione all'altra">
      <a href={V1_URL} style={current === 'v1' ? on : off}>V1 · Fogli</a>
      <a href={V2_URL} style={current === 'v2' ? on : off}>V2 · Guesty</a>
    </div>
  );
}

function HouseMultiSelect({ houses, setHouses }) {
  const [open, setOpen] = useState(false);
  const allSel = houses.length === ALL_HOUSES.length;
  const label = allSel
    ? 'Tutte le case'
    : houses.length === 0
      ? 'Nessuna casa'
      : houses.length === 1
        ? HOUSES_META[houses[0]].short
        : `${houses.length} case selezionate`;
  const toggle = (id) => setHouses(houses.includes(id) ? houses.filter(x => x !== id) : [...houses, id]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="ctl flex items-center gap-2 min-w-[180px] justify-between"
      >
        <span>{label}</span>
        <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 right-0 mt-1 panel p-2 min-w-[240px]" style={{ padding: 8 }}>
            <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm font-medium">
              <input type="checkbox" checked={allSel} onChange={() => setHouses(allSel ? [] : [...ALL_HOUSES])} />
              Tutte le case
            </label>
            <div className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
            {ALL_HOUSES.map(id => (
              <label key={id} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm">
                <input type="checkbox" checked={houses.includes(id)} onChange={() => toggle(id)} />
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: HOUSES_META[id].color }} />
                {HOUSES_META[id].name}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tabs({ view, setView, badges = {} }) {
  const tabs = [
    ['overview',  'Panoramica'],
    ['trend',     'Andamento storico'],
    ['forward',   'Forward booking'],
    ['cancel',    'Cancellazioni'],
    ['audience',  'Ospiti'],
    ['houses',    'Performance per casa'],
    // Misura, simulatore «Parità OTA» e avvisi per portale (components/Canali.js).
    ['canali',    'Canali'],
  ];
  return (
    <div className="flex gap-1 mb-6 overflow-x-auto" style={{ borderBottom: '1px solid var(--border)' }}>
      {tabs.map(([k, label]) => (
        <button key={k} className={`tab-btn whitespace-nowrap ${view === k ? 'active' : ''}`} onClick={() => setView(k)}>
          {label}
          {badges[k] > 0 && <span className="pill red ml-2" title="Avvisi sulle prenotazioni vere">{badges[k]}</span>}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// OVERVIEW VIEW
// ============================================================================
function OverviewView({ data, year, houses, monthIdx, totals, totalsPrev, reservations }) {
  const scopeName = houses.length === ALL_HOUSES.length ? 'aggregato'
    : houses.length === 0 ? 'nessuna casa selezionata'
    : houses.length === 1 ? HOUSES_META[houses[0]].name
    : `${houses.length} case`;
  if (!totals) return <EmptyState message={`Nessun dato per ${scopeName} nel ${year}${monthIdx != null ? ' (' + MONTHS[monthIdx] + ')' : ''}.`} />;

  // Etichetta del periodo di confronto: rende esplicito che il raffronto è omogeneo
  // (es. "vs gen–mag 2025" quando l'anno corrente ha dati solo fino a maggio).
  const prevY = parseInt(year, 10) - 1;
  let cmpLabel;
  if (monthIdx != null) {
    cmpLabel = `vs ${MONTHS[monthIdx]} ${prevY}`;
  } else {
    const endIdx = lastPopulatedMonthIndex(data, houses, year);
    cmpLabel = (endIdx >= 0 && endIdx < 11)
      ? `vs gen–${MONTHS[endIdx].toLowerCase()} ${prevY}`
      : `vs ${prevY}`;
  }

  const yoy = (cur, prev) => (prev && prev !== 0) ? (cur - prev) / prev * 100 : null;
  const dRev = totalsPrev ? yoy(totals.revenue, totalsPrev.revenue) : null;
  const dNig = totalsPrev ? yoy(totals.nights, totalsPrev.nights) : null;
  const dOcc = (totalsPrev?.occ != null && totals.occ != null) ? totals.occ - totalsPrev.occ : null;
  const dAdr = totalsPrev ? yoy(totals.adr, totalsPrev.adr) : null;

  // Dettagli al passaggio del mouse: periodo selezionato vs stesso periodo dell'anno prima
  const curLabel = monthIdx != null ? `${MONTHS[monthIdx]} ${year}` : cmpLabel.replace(/^vs /, '').replace(String(prevY), String(year));
  const prevLabel = cmpLabel.replace(/^vs /, '');
  const diffEur = (a, b) => `${a - b >= 0 ? '+' : '−'}${fmtEur(Math.abs(a - b))}`;
  const diffNum = (a, b) => `${a - b >= 0 ? '+' : ''}${fmtNum(a - b)}`;
  const cmpRows = (cur, prev, f, diff) => [
    [curLabel, f(cur)],
    ...(totalsPrev ? [[prevLabel, f(prev)], ['Differenza', prev != null && cur != null ? diff(cur, prev) : '—', true]] : []),
  ];
  const tips = {
    revenue: { title: 'Ricavi', rows: cmpRows(totals.revenue, totalsPrev?.revenue, fmtEur, diffEur), note: 'Prezzo dei soggiorni senza tassa di soggiorno, diviso per notte fra i mesi.' },
    net: { title: 'Ricavi netti OTA', rows: [
      ['Ricavi', fmtEur(totals.revenue)],
      ['Commissioni dei portali', totals.netRevenue != null ? `−${fmtEur(totals.revenue - totals.netRevenue)}` : '—'],
      ['Netto', fmtEur(totals.netRevenue), true],
      ...(totalsPrev?.netRevenue != null ? [[`Netto ${prevLabel}`, fmtEur(totalsPrev.netRevenue)]] : []),
    ], note: 'Booking: ricavi meno la commissione misurata (19,5% Marco Aurelio e Prestige, 24,5% le altre). Airbnb: l’accredito. Diretti: nessuna commissione.' },
    nights: { title: 'Notti vendute', rows: cmpRows(totals.nights, totalsPrev?.nights, fmtNum, (a, b) => `${diffNum(a, b)} notti`) },
    occ: { title: 'Tasso di occupazione', rows: cmpRows(totals.occ, totalsPrev?.occ, fmtPct, (a, b) => `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(1).replace('.', ',')} pp`), note: 'Notti vendute diviso notti disponibili; i mesi prima dell’apertura di una casa non contano.' },
    adr: { title: 'Prezzo medio a notte (ADR)', rows: cmpRows(totals.adr, totalsPrev?.adr, fmtEur, diffEur), note: 'Ricavi diviso notti vendute.' },
    bookings: { title: 'Prenotazioni', rows: [
      ...cmpRows(totals.bookings, totalsPrev?.bookings, fmtNum, diffNum),
      ['Ricavo medio', fmtEur(totals.avgPerBooking), true],
      ['Notti medie', totals.bookings ? (totals.nights / totals.bookings).toFixed(1).replace('.', ',') : '—'],
    ] },
  };

  const monthlyRevenue = monthlySeries(data, houses, year, 'ricavi');
  const monthlyOcc = monthlySeries(data, houses, year, 'occupazione');
  // ADR per casa: mostra le case selezionate
  const adrHouses = houses.length ? houses : ALL_HOUSES;
  const adrByHouse = adrHouses.map(h => kpiForHouseYear(data, h, year, monthIdx)?.adr || null);
  // Mix canali filtrato per casa + mese (se selezionati)
  const filteredReservations = filterReservations(reservations, houses, year, monthIdx);
  const channels = channelMix(filteredReservations);

  return (
    <>
      <div className="kpi-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <KpiCard label="Ricavi" value={fmtEur(totals.revenue)} delta={dRev != null ? `${dRev >= 0 ? '+' : ''}${dRev.toFixed(1).replace('.', ',')}% ${cmpLabel}` : null} up={dRev >= 0} tip={tips.revenue} />
        <KpiCard label="Ricavi netti OTA" value={fmtEur(totals.netRevenue)} delta={totals.revenue ? `${(totals.netRevenue / totals.revenue * 100).toFixed(1).replace('.', ',')}% dei lordi` : null} tip={tips.net} />
        <KpiCard label="Notti vendute" value={fmtNum(totals.nights)} delta={dNig != null ? `${dNig >= 0 ? '+' : ''}${dNig.toFixed(1).replace('.', ',')}% ${cmpLabel}` : null} up={dNig >= 0} tip={tips.nights} />
        <KpiCard label="Tasso di occupazione" value={fmtPct(totals.occ)} delta={dOcc != null ? `${dOcc >= 0 ? '+' : ''}${dOcc.toFixed(1).replace('.', ',')} pp ${cmpLabel}` : null} up={dOcc >= 0} tip={tips.occ} align="right" />
        <KpiCard label="ADR medio" value={fmtEur(totals.adr)} delta={dAdr != null ? `${dAdr >= 0 ? '+' : ''}${dAdr.toFixed(1).replace('.', ',')}% ${cmpLabel}` : null} up={dAdr >= 0} tip={tips.adr} align="right" />
        <KpiCard label="Prenotazioni" value={fmtNum(totals.bookings)} delta={totals.avgPerBooking ? `${fmtEur(totals.avgPerBooking)} ricavo medio` : null} tip={tips.bookings} align="right" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel title="Ricavi mensili" hint="€ lordi per mese">
          <div className="h-72"><Bar data={{ labels: MONTHS, datasets: [{ label: 'Ricavi €', data: monthlyRevenue, backgroundColor: C.brand, borderRadius: 4 }] }} options={CHART_OPTS_NO_LEGEND} /></div>
        </Panel>
        <Panel title="Tasso di occupazione mensile" hint="%">
          <div className="h-72"><Line data={{ labels: MONTHS, datasets: [{ label: 'Occupazione %', data: monthlyOcc, borderColor: C.accent, backgroundColor: 'rgba(179,158,115,0.18)', fill: true, tension: 0.3 }] }} options={{ ...CHART_OPTS_NO_LEGEND, scales: { y: { min: 0, max: 100 } } }} /></div>
        </Panel>
        <Panel title="Mix canali" hint="quota notti vendute per canale">
          <div className="h-72">
            {channels.length > 0 ? (
              <Doughnut data={{ labels: channels.map(c => c.name), datasets: [{ data: channels.map(c => c.count), backgroundColor: PALETTE }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 16, padding: 10, font: { size: 13 } } }, tooltip: { callbacks: { label: (ctx) => { const total = ctx.dataset.data.reduce((a,b) => a+b, 0); const pct = total ? (ctx.parsed / total * 100).toFixed(1).replace('.', ',') : '0'; return `${ctx.label}: ${ctx.parsed} notti (${pct}%)`; } } } } }} />
            ) : <EmptyState message="Nessuna prenotazione da mostrare con i filtri correnti." />}
          </div>
        </Panel>
        <Panel title="ADR per casa" hint="€ prezzo medio per notte">
          <div className="h-72"><Bar data={{ labels: adrHouses.map(h => HOUSES_META[h].short), datasets: [{ label: 'ADR €', data: adrByHouse, backgroundColor: adrHouses.map(h => HOUSES_META[h].color), borderRadius: 4 }] }} options={{ ...CHART_OPTS_NO_LEGEND, indexAxis: 'y' }} /></div>
        </Panel>
      </div>
    </>
  );
}

// ============================================================================
// TREND VIEW
// ============================================================================
function TrendView({ data, houses, years }) {
  const kpiFor = (y) => houses.length === 1 ? kpiForHouseYear(data, houses[0], y) : kpiAggregatedYear(data, y, null, houses);
  const buildDatasets = (metric) => years.map((y, i) => {
    const arr = monthlySeries(data, houses, y, metric);
    if (!arr || arr.every(v => v == null)) return null;
    const color = PALETTE[i % PALETTE.length];
    return { label: y, data: arr, borderColor: color, backgroundColor: color + '33', tension: 0.3, fill: false };
  }).filter(Boolean);

  const yoyTable = years.map((y, i) => {
    const t = kpiFor(y);
    if (!t || !t.revenue) return null;
    const prev = i > 0 ? years[i-1] : null;
    const tprev = prev ? kpiFor(prev) : null;
    const yoyRev = (tprev && tprev.revenue) ? (t.revenue - tprev.revenue) / tprev.revenue * 100 : null;
    return { year: y, ...t, yoyRev };
  }).filter(Boolean);

  return (
    <>
      <div className="note mb-4">
        <strong>Confronto YoY.</strong> Una linea per ogni anno disponibile. Dati Guesty dal {data?.startYear || 2025}; per lo storico precedente usa la dashboard V1 (fogli contabilità).
      </div>

      <div className="grid grid-cols-1 gap-4 mb-4">
        <Panel title="Ricavi mensili — confronto YoY">
          <div className="h-80"><Line data={{ labels: MONTHS, datasets: buildDatasets('ricavi') }} options={CHART_OPTS_LEGEND_BOTTOM} /></div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Panel title="Occupazione mensile — confronto YoY">
          <div className="h-72"><Line data={{ labels: MONTHS, datasets: buildDatasets('occupazione') }} options={{ ...CHART_OPTS_LEGEND_BOTTOM, scales: { y: { min: 0, max: 100 } } }} /></div>
        </Panel>
        <Panel title="ADR mensile — confronto YoY">
          <div className="h-72"><Line data={{ labels: MONTHS, datasets: buildDatasets('adr') }} options={CHART_OPTS_LEGEND_BOTTOM} /></div>
        </Panel>
      </div>

      <Panel title="Riepilogo annuale">
        <table>
          <thead>
            <tr><th>Anno</th><th className="num">Prenotazioni</th><th className="num">Notti</th><th className="num">Ricavi</th><th className="num">Ricavi netti OTA</th><th className="num">Occupazione</th><th className="num">ADR</th><th className="num">Δ Ricavi YoY</th></tr>
          </thead>
          <tbody>
            {yoyTable.map(r => (
              <tr key={r.year}>
                <td><strong>{r.year}</strong></td>
                <td className="num">{fmtNum(r.bookings)}</td>
                <td className="num">{fmtNum(r.nights)}</td>
                <td className="num">{fmtEur(r.revenue)}</td>
                <td className="num">{fmtEur(r.netRevenue)}</td>
                <td className="num">{fmtPct(r.occ)}</td>
                <td className="num">{fmtEur(r.adr)}</td>
                <td className="num">{r.yoyRev != null ? <span className={`pill ${r.yoyRev >= 0 ? 'green' : 'red'}`}>{r.yoyRev >= 0 ? '+' : ''}{r.yoyRev.toFixed(1)}%</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

// ============================================================================
// FORWARD BOOKING VIEW
// ============================================================================
function ForwardView({ data, houses }) {
  const { months: fwd, lyCutoff, withCancelDate } = useMemo(() => forwardBooking(data, new Date(), houses), [data, houses]);
  const today = new Date();
  const [cy, cm, cd] = lyCutoff.split('-').map(Number);
  const lyLabel = `${cd} ${MONTHS[cm - 1].toLowerCase()} ${cy}`;
  const isAll = houses.length === ALL_HOUSES.length;
  const scopeLabel = isAll
    ? `${ALL_HOUSES.length} case aggregate`
    : houses.length === 0
      ? 'nessuna casa'
      : houses.length === 1
        ? (HOUSES_META[houses[0]]?.short || houses[0])
        : `${houses.length} case`;
  const unitsCount = houses.length;
  const futureMonths = fwd.filter(m => {
    const [y, mm] = m.month.split('-');
    const monthDate = new Date(parseInt(y), parseInt(mm) - 1, 1);
    return monthDate >= new Date(today.getFullYear(), today.getMonth(), 1);
  }).slice(0, 6);

  const totalBooked = futureMonths.reduce((a, b) => a + b.booked, 0);
  const totalCapacity = futureMonths.reduce((a, b) => a + b.capacity, 0);
  const totalRevenue = futureMonths.reduce((a, b) => a + b.revenue, 0);
  const avgFillRate = totalCapacity ? totalBooked / totalCapacity * 100 : 0;
  const fwdAdr = totalBooked ? totalRevenue / totalBooked : 0;

  // Stessa data dell'anno scorso, sugli stessi 6 mesi (spostati di un anno)
  const lyMonths = futureMonths.filter(m => m.lyHasData);
  const hasLy = lyMonths.length === futureMonths.length && futureMonths.length > 0;
  const lyBooked = futureMonths.reduce((a, b) => a + b.lyBooked, 0);
  const lyCapacity = futureMonths.reduce((a, b) => a + b.lyCapacity, 0);
  const lyRevenue = futureMonths.reduce((a, b) => a + b.lyRevenue, 0);
  const lyFill = lyCapacity ? lyBooked / lyCapacity * 100 : 0;
  const lyAdr = lyBooked ? lyRevenue / lyBooked : 0;
  const pctChange = (cur, prev) => (prev ? (cur - prev) / prev * 100 : null);
  const fmtChange = (v, unit = '%') => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}${unit === '%' ? '%' : ' pp'}`;
  const kpiDelta = (v, unit = '%') => hasLy && v != null ? `${fmtChange(v, unit)} vs ${lyLabel}` : null;
  const dBooked = pctChange(totalBooked, lyBooked);
  const dRevenue = pctChange(totalRevenue, lyRevenue);
  const dAdr = pctChange(fwdAdr, lyAdr);
  const dFill = hasLy ? avgFillRate - lyFill : null;
  // Dettagli al passaggio del mouse: oggi vs anno scorso, poi mese per mese
  const sgn = n => `${n >= 0 ? '+' : ''}${fmtNum(n)}`;
  const vsLy = (cur, ly, f) => hasLy ? `${f(cur)} vs ${f(ly)}` : f(cur);
  const fillOf = (n, c) => (c ? n / c * 100 : null);
  const tipNights = {
    title: 'Notti già prenotate, prossimi 6 mesi',
    rows: [
      ['Oggi', fmtNum(totalBooked)],
      ...(hasLy ? [[`Al ${lyLabel}`, fmtNum(lyBooked)], ['Differenza', `${sgn(totalBooked - lyBooked)} notti`]] : []),
      ...futureMonths.map((m, i) => [monthLabel(m.month), vsLy(m.booked, m.lyBooked, fmtNum), i === 0]),
    ],
    note: hasLy ? `Ogni mese: oggi vs ${lyLabel}.` : null,
  };
  const tipRevenue = {
    title: 'Ricavi attesi, prossimi 6 mesi',
    rows: [
      ['Oggi', fmtEur(totalRevenue)],
      ...(hasLy ? [[`Al ${lyLabel}`, fmtEur(lyRevenue)], ['Differenza', `${totalRevenue - lyRevenue >= 0 ? '+' : '−'}${fmtEur(Math.abs(totalRevenue - lyRevenue))}`]] : []),
      ...futureMonths.map((m, i) => [monthLabel(m.month), vsLy(m.revenue, m.lyRevenue, fmtEur), i === 0]),
    ],
    note: 'Pagamento totale meno tassa di soggiorno, diviso per notte fra i mesi.',
  };
  const tipAdr = {
    title: 'Prezzo medio a notte già venduto',
    rows: [
      ['Oggi', fmtEur(fwdAdr)],
      ...(hasLy ? [[`Al ${lyLabel}`, fmtEur(lyAdr)]] : []),
      ...futureMonths.map((m, i) => [monthLabel(m.month), vsLy(m.booked ? m.revenue / m.booked : null, m.lyBooked ? m.lyRevenue / m.lyBooked : null, fmtEur), i === 0]),
    ],
    note: 'Ricavi attesi diviso notti già prenotate.',
  };
  const tipFill = {
    title: 'Riempimento, prossimi 6 mesi',
    rows: [
      ['Oggi', `${fmtPct(avgFillRate)} · ${fmtNum(totalBooked)}/${fmtNum(totalCapacity)}`],
      ...(hasLy ? [[`Al ${lyLabel}`, `${fmtPct(lyFill)} · ${fmtNum(lyBooked)}/${fmtNum(lyCapacity)}`]] : []),
      ...futureMonths.map((m, i) => [monthLabel(m.month), vsLy(fillOf(m.booked, m.capacity), fillOf(m.lyBooked, m.lyCapacity), fmtPct), i === 0]),
    ],
    note: `Notti prenotate diviso notti disponibili (giorni del mese × ${unitsCount} ${unitsCount === 1 ? 'casa' : 'case'}).`,
  };
  const tipMonth = m => {
    const left = m.lyFinalBooked - m.lyBooked;
    return {
      title: `${monthLabel(m.month)}`,
      rows: [
        ['Prenotate oggi', `${fmtNum(m.booked)} notti · ${fmtEur(m.revenue)}`],
        ['Notti ancora libere', fmtNum(Math.max(0, m.capacity - m.booked))],
        ...(m.lyHasData ? [
          [`Al ${lyLabel}`, `${fmtNum(m.lyBooked)} notti · ${fmtEur(m.lyRevenue)}`, true],
          ['Anno scorso, a fine mese', `${fmtNum(m.lyFinalBooked)} notti · ${fmtEur(m.lyFinalRevenue)}`],
          ['Da allora a fine mese', `${left >= 0 ? '+' : ''}${fmtNum(left)} notti`],
        ] : []),
      ],
      note: m.lyHasData ? (left > 0 ? `L'anno scorso, da questa data a fine mese, si erano vendute altre ${fmtNum(left)} notti.` : left < 0 ? `L'anno scorso, da questa data a fine mese, le cancellazioni hanno superato le nuove prenotazioni (${fmtNum(left)} notti).` : null) : null,
    };
  };
  const changePill = (v, unit = '%') => v == null
    ? '—'
    : <span className={`pill ${v >= 0 ? 'green' : 'red'}`}>{fmtChange(v, unit)}</span>;

  return (
    <>
      <div className="note mb-4">
        <strong>Forward booking — {scopeLabel}.</strong> Calcolato live dalle prenotazioni confermate in Guesty, 12 mesi a partire dal mese corrente. Capacità = giorni nel mese × {unitsCount} {unitsCount === 1 ? 'unità' : 'unità (case)'}. Ricavi = pagamento totale − tassa di soggiorno, prorata per notte.
        {' '}<strong>Anno scorso alla stessa data</strong> = notti degli stessi mesi di un anno prima già prenotate al {lyLabel} (data di creazione in Guesty). {withCancelDate ? 'Comprende le prenotazioni che allora erano in calendario e sono state cancellate dopo: Guesty ne azzera l\'importo, quindi il loro valore è stimato con il prezzo medio a notte della stessa casa nello stesso mese.' : "Le prenotazioni cancellate dopo non sono contate, quindi il valore dell'anno scorso può essere leggermente più basso di quello che si vedeva allora."}
      </div>

      <div className="kpi-grid grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Notti già prenotate (prossimi 6 mesi)" value={fmtNum(totalBooked)} delta={kpiDelta(dBooked) || `su ${fmtNum(totalCapacity)} capacità`} up={hasLy && dBooked != null ? dBooked >= 0 : undefined} tip={tipNights} />
        <KpiCard label="Ricavi attesi (prossimi 6 mesi)" value={fmtEur(totalRevenue)} delta={kpiDelta(dRevenue) || 'prossimi 6 mesi'} up={hasLy && dRevenue != null ? dRevenue >= 0 : undefined} tip={tipRevenue} />
        <KpiCard label="ADR forward" value={fmtEur(fwdAdr)} delta={kpiDelta(dAdr) || 'prezzo medio mesi futuri'} up={hasLy && dAdr != null ? dAdr >= 0 : undefined} tip={tipAdr} align="right" />
        <KpiCard label="Riempimento medio" value={fmtPct(avgFillRate)} delta={kpiDelta(dFill, 'pp') || 'dei posti disponibili'} up={dFill != null ? dFill >= 0 : undefined} tip={tipFill} align="right" />
      </div>

      <Panel title={`Riempimento mese per mese (${scopeLabel})`} hint={hasLy ? `la tacca indica il riempimento al ${lyLabel}` : null} extra="mb-4">
        <div className="space-y-2">
          {futureMonths.map(m => {
            const pct = m.capacity ? m.booked / m.capacity * 100 : 0;
            const lyPct = m.lyCapacity ? m.lyBooked / m.lyCapacity * 100 : 0;
            return (
              <div key={m.month} className="flex items-center gap-3 tip-wrap has-tip" tabIndex={0}>
                <TipPop tip={tipMonth(m)} wide />
                <div className="w-20 font-semibold text-sm">{monthLabel(m.month)}</div>
                <div className="flex-1 h-6 rounded overflow-hidden relative" style={{ background: 'var(--raised)' }}>
                  <div className="h-full" style={{ background: 'linear-gradient(90deg, #c8d2c8, #ddcfae)', width: `${Math.min(100, pct)}%` }}></div>
                  {m.lyHasData && (
                    <div className="absolute top-0 bottom-0" style={{ left: `calc(${Math.min(100, lyPct)}% - 1px)`, width: 2, background: C.accentText }}></div>
                  )}
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold" style={{ color: 'var(--brand-dark)' }}>
                    {m.booked} / {m.capacity} notti ({pct.toFixed(0)}%)
                  </div>
                </div>
                <div className="w-40 text-right text-xs" style={{ color: 'var(--text-dim)' }}>
                  {fmtEur(m.revenue)} attesi
                  {m.lyHasData && <div>anno scorso {m.lyBooked} notti</div>}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Confronto con l'anno scorso alla stessa data" hint={`prenotato oggi vs prenotato al ${lyLabel}`} extra="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th>Mese</th>
                <th className="num">Notti oggi</th>
                <th className="num">Notti al {lyLabel}</th>
                <th className="num">Δ notti</th>
                <th className="num">Ricavi oggi</th>
                <th className="num">Ricavi al {lyLabel}</th>
                <th className="num">Δ ricavi</th>
                <th className="num">Prezzo/notte oggi (senza pulizie)</th>
                <th className="num">Prezzo/notte al {lyLabel}</th>
                <th className="num">Δ prezzo</th>
                <th className="num">Riempimento oggi</th>
                <th className="num">Anno scorso</th>
                <th className="num">Anno scorso, a fine mese</th>
              </tr>
            </thead>
            <tbody>
              {fwd.map(m => {
                const fill = m.capacity ? m.booked / m.capacity * 100 : null;
                const lyFillM = m.lyCapacity ? m.lyBooked / m.lyCapacity * 100 : null;
                return (
                  <tr key={m.month}>
                    <td>{monthLabel(m.month)}</td>
                    <td className="num">{fmtNum(m.booked)}</td>
                    <td className="num">{m.lyHasData ? fmtNum(m.lyBooked) : '—'}</td>
                    <td className="num">{m.lyHasData ? changePill(pctChange(m.booked, m.lyBooked)) : '—'}</td>
                    <td className="num">{fmtEur(m.revenue)}</td>
                    <td className="num">{m.lyHasData ? fmtEur(m.lyRevenue) : '—'}</td>
                    <td className="num">{m.lyHasData ? changePill(pctChange(m.revenue, m.lyRevenue)) : '—'}</td>
                    <td className="num">{m.booked ? fmtEur(m.roomRevenue / m.booked) : '—'}</td>
                    <td className="num">{m.lyHasData && m.lyBooked ? fmtEur(m.lyRoomRevenue / m.lyBooked) : '—'}</td>
                    <td className="num">{m.lyHasData && m.booked && m.lyBooked ? changePill(pctChange(m.roomRevenue / m.booked, m.lyRoomRevenue / m.lyBooked)) : '—'}</td>
                    <td className="num">{fmtPct(fill)}</td>
                    <td className="num">{m.lyHasData ? fmtPct(lyFillM) : '—'}</td>
                    <td className="num">{m.lyHasData ? `${fmtNum(m.lyFinalBooked)} notti · ${fmtEur(m.lyFinalRevenue)}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Notti prenotate per mese — prossimi 12 mesi">
        <div className="h-80">
          <Bar data={{
            labels: fwd.map(m => monthLabel(m.month)),
            datasets: [
              { label: 'Notti prenotate oggi', data: fwd.map(m => m.booked), backgroundColor: C.brand },
              { label: `Anno scorso al ${lyLabel}`, data: fwd.map(m => m.lyHasData ? m.lyBooked : null), backgroundColor: C.accent },
              { label: 'Capacità totale', data: fwd.map(m => m.capacity), type: 'line', borderColor: C.accentText, borderDash: [4,4], pointRadius: 0, fill: false }
            ]
          }} options={CHART_OPTS_LEGEND_BOTTOM} />
        </div>
      </Panel>

      <PricePanel data={data} houses={houses} lyLabel={lyLabel} />
      <PrezziVenditaPanel data={data} houses={houses} lyLabel={lyLabel} />
      <PickupPanel data={data} houses={houses} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <ChannelForwardPanel data={data} houses={houses} lyLabel={lyLabel} />
        <OrphanPanel data={data} houses={houses} />
      </div>
    </>
  );
}

const fmtSigned = (v, unit = '%') => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}${unit === '%' ? '%' : ' pp'}`;
const pctChangeOf = (cur, prev) => (prev ? (cur - prev) / prev * 100 : null);
const fmtDay = (s, withWeekday = false) => new Date(s + 'T00:00:00Z').toLocaleDateString('it-IT', { ...(withWeekday ? { weekday: 'short' } : {}), day: 'numeric', month: 'short', timeZone: 'UTC' });

// ---- Prezzo medio a notte già venduto, casa per casa ----
// Il prezzo medio dell'insieme cambia anche solo perché cambia il peso delle case (Prestige costa più
// del Bilocale): il confronto «a parità di case» pesa i prezzi dell'anno scorso con le notti di oggi.
function PricePanel({ data, houses, lyLabel, months = 6 }) {
  const rows = useMemo(() => houses.map(h => {
    const ms = forwardBooking(data, new Date(), [h], months).months;
    const sum = k => ms.reduce((a, m) => a + (m[k] || 0), 0);
    // Solo alloggio (senza pulizie): con le pulizie i soggiorni corti gonfiano il prezzo a notte.
    const n = sum('booked'), rev = sum('roomRevenue'), ln = sum('lyBooked'), lrev = sum('lyRoomRevenue');
    return { h, n, rev, ln, lrev, adr: n ? rev / n : null, lyAdr: ln ? lrev / ln : null, months: ms };
  }), [data, houses, months]);
  const tot = rows.reduce((a, r) => ({ n: a.n + r.n, rev: a.rev + r.rev, ln: a.ln + r.ln, lrev: a.lrev + r.lrev }), { n: 0, rev: 0, ln: 0, lrev: 0 });
  const adr = tot.n ? tot.rev / tot.n : null, lyAdr = tot.ln ? tot.lrev / tot.ln : null;
  // A parità di case: prezzo dell'anno scorso di ogni casa, pesato sulle notti vendute oggi
  const both = rows.filter(r => r.adr != null && r.lyAdr != null);
  const bothN = both.reduce((a, r) => a + r.n, 0);
  const sameMixLy = bothN ? both.reduce((a, r) => a + r.n * r.lyAdr, 0) / bothN : null;
  const sameMixNow = bothN ? both.reduce((a, r) => a + r.rev, 0) / bothN : null;
  const likeForLike = sameMixLy ? (sameMixNow - sameMixLy) / sameMixLy * 100 : null;
  const pct = (a, b) => (a != null && b) ? (a - b) / b * 100 : null;
  const pill = v => v == null ? '—' : <span className={`pill ${v >= 0 ? 'green' : 'red'}`}>{v >= 0 ? '+' : ''}{v.toFixed(1).replace('.', ',')}%</span>;
  const big = v => v == null ? '—' : <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>{v >= 0 ? '+' : ''}{v.toFixed(1).replace('.', ',')}%</span>;
  return (
    <Panel title="Prezzo medio a notte già venduto" hint={`prossimi ${months} mesi, oggi vs prenotato al ${lyLabel}`} extra="mt-4">
      <div className="kpi-grid grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <KpiCard label="Prezzo medio oggi" value={fmtEur(adr)} delta={`al ${lyLabel}: ${fmtEur(lyAdr)}`} />
        <KpiCard label="Differenza complessiva" value={big(pct(adr, lyAdr))} delta="risente del peso delle case" />
        <KpiCard label="A parità di case" value={big(likeForLike)} delta="il dato da guardare per i prezzi" align="right"
          tip={{ title: 'A parità di case', rows: [['Prezzo medio oggi', fmtEur(sameMixNow)], ['Stesse notti ai prezzi dell\'anno scorso', fmtEur(sameMixLy)]],
            note: 'Ogni casa è confrontata con sé stessa, poi le differenze sono pesate sulle notti vendute oggi. Così non conta se quest\'anno hai venduto più notti della casa cara o di quella economica.' }} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th>Casa</th><th className="num">Notti oggi</th><th className="num">Prezzo/notte oggi</th><th className="num">Notti al {lyLabel}</th><th className="num">Prezzo/notte allora</th><th className="num">Δ prezzo</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.h}>
                <td className="tip-wrap has-tip" tabIndex={0}>
                  {HOUSES_META[r.h]?.name || r.h}
                  <TipPop wide tip={{ title: `${HOUSES_META[r.h]?.short || r.h}: prezzo/notte mese per mese`, rows: r.months.map(m => [monthLabel(m.month), `${m.booked ? fmtEur(m.roomRevenue / m.booked) : '—'} vs ${m.lyBooked ? fmtEur(m.lyRoomRevenue / m.lyBooked) : '—'}`]), note: `Oggi vs prenotato al ${lyLabel}.` }} />
                </td>
                <td className="num">{fmtNum(r.n)}</td>
                <td className="num">{fmtEur(r.adr)}</td>
                <td className="num">{fmtNum(r.ln)}</td>
                <td className="num">{fmtEur(r.lyAdr)}</td>
                <td className="num">{pill(pct(r.adr, r.lyAdr))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs mt-3" style={{ color: 'var(--text-dim)' }}>
        Prezzo/notte = pagamento totale meno tassa di soggiorno e pulizie, diviso per le notti: è il prezzo del solo alloggio, quello che i soggiorni corti non gonfiano. Le case senza notti in uno dei due periodi non entrano nel confronto a parità di case.
      </div>
    </Panel>
  );
}

// ---- Prezzi in vendita: quanto si chiede oggi per le notti libere (foto PriceLabs del mattino) ----
const STATO_VENDITA = {
  rosso:  { bg: 'rgba(160,78,58,0.14)',  fg: 'var(--red)',    label: 'Prezzo alto e ritmo sotto l\'anno scorso' },
  giallo: { bg: 'rgba(182,138,62,0.14)', fg: 'var(--yellow)', label: 'Prezzo alto oppure ritmo sotto: da guardare' },
  verde:  { bg: 'rgba(107,142,90,0.12)', fg: 'var(--green)',  label: 'In linea' },
  grigio: { bg: 'var(--raised)',         fg: 'var(--text-dim)', label: 'Anno scorso non confrontabile' },
  pieno:  { bg: 'var(--raised)',         fg: 'var(--text-dim)', label: 'Nessuna notte in vendita' },
  manca:  { bg: 'transparent',           fg: 'var(--text-subtle)', label: 'PriceLabs senza prezzi' },
};

function PrezziVenditaPanel({ data, houses, lyLabel, months = 6 }) {
  const [foto, setFoto] = useState(null);
  const [errore, setErrore] = useState(null);
  useEffect(() => {
    let vivo = true;
    fetch('/api/pricelabs/ultima', { cache: 'no-store' })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!vivo) return; if (r.ok && j.ok) setFoto(j); else setErrore(j.error || `errore ${r.status}`); })
      .catch(e => vivo && setErrore(e.message));
    return () => { vivo = false; };
  }, []);
  const rows = useMemo(() => (foto ? prezziInVendita(foto, data, houses, new Date(), months) : []), [foto, data, houses, months]);
  const senzaPulizie = (data?.reservations || []).some(r => r.cleaning != null);
  const s = PREZZI_VENDITA_SOGLIE;
  const conteggio = rows.flatMap(r => r.mesi).reduce((a, c) => ({ ...a, [c.stato]: (a[c.stato] || 0) + 1 }), {});
  const fmtPctS = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v)}%`;
  const hint = foto ? `foto PriceLabs del ${fmtDay(foto.giorno)}${foto.vecchia_di_giorni ? ` (di ${foto.vecchia_di_giorni} giorni fa)` : ''}, prossimi ${months} mesi` : `prossimi ${months} mesi`;
  return (
    <Panel title="Prezzi in vendita" hint={hint} extra="mt-4">
      {errore && <EmptyState message={`Foto dei prezzi PriceLabs non disponibile: ${errore}`} />}
      {!errore && !foto && <EmptyState message="Carico la foto dei prezzi PriceLabs…" />}
      {foto && (
        <>
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            {['rosso', 'giallo', 'verde', 'grigio'].map(k => (
              <span key={k} className="pill" style={{ background: STATO_VENDITA[k].bg, color: STATO_VENDITA[k].fg }}>
                {STATO_VENDITA[k].label}: {conteggio[k] || 0}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>Casa</th>
                  {(rows[0]?.mesi || []).map(c => <th key={c.month} className="num">{monthLabel(c.month)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.h}>
                    <td>{HOUSES_META[r.h]?.short || r.h}</td>
                    {r.mesi.map((c, i) => {
                      const st = STATO_VENDITA[c.stato];
                      return (
                        <td key={c.month} className="num tip-wrap has-tip" tabIndex={0} style={{ background: st.bg }}>
                          <div style={{ fontWeight: 600, color: st.fg }}>{c.atteso != null && c.liberi ? fmtEur(c.atteso) : '—'}</div>
                          <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
                            {c.stato === 'grigio' ? (c.lancio ? 'anno di lancio' : 'poche notti') : c.stato === 'pieno' ? 'pieno' : `${fmtPctS(c.dPrezzo)} · ${fmtNum(c.notti)}/${fmtNum(c.lyNottiAllaData)} n.`}
                          </div>
                          <TipPop width={340} align={i >= r.mesi.length / 2 ? 'right' : undefined} tip={{
                            title: `${HOUSES_META[r.h]?.short || r.h}, ${monthLabel(c.month)}: ${st.label.toLowerCase()}`,
                            rows: [
                              ['Prezzo PriceLabs oggi (giorni liberi)', c.prezzo != null ? fmtEur(c.prezzo) : '—'],
                              ['Pagato in media dall\'ospite (× ' + r.fattore.toFixed(2).replace('.', ',') + ')', c.atteso != null ? fmtEur(c.atteso) : '—'],
                              ['Consiglio PriceLabs', c.consiglio != null ? fmtEur(c.consiglio) : '—'],
                              ['Giorni ancora in vendita', `${fmtNum(c.liberi)} su ${fmtNum(c.giorni)}`],
                              ['Incassato a notte, anno scorso', c.lyAdr != null ? `${fmtEur(c.lyAdr)} (${fmtNum(c.lyNotti)} notti)` : '—'],
                              ['Differenza di prezzo', fmtPctS(c.dPrezzo)],
                              ['Notti vendute: oggi / al ' + lyLabel, `${fmtNum(c.notti)} / ${fmtNum(c.lyNottiAllaData)}`],
                            ],
                            note: c.lancio ? 'La casa era aperta da pochi mesi: il prezzo dell\'anno scorso era di lancio e non fa testo.' : null,
                          }} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows[0] && (
            <div className="text-xs mt-3" style={{ color: 'var(--text-dim)' }}>
              <b>Da PriceLabs a pagato dall'ospite:</b>{' '}
              {rows[0].portali.map(p => `${p.nome} ${p.ricarico ? '+' + p.ricarico + '%' : '0%'} e sconti medi −${Math.round(p.sconti * 100)}% (× ${p.fattore.toFixed(2).replace('.', ',')})`).join(' · ')}.
              {' '}Pesati sulle notti di ogni casa per portale: {rows.map(r => `${HOUSES_META[r.h]?.short || r.h} × ${r.fattore.toFixed(2).replace('.', ',')}`).join(', ')}.
            </div>
          )}
          <div className="text-xs mt-2" style={{ color: 'var(--text-dim)' }}>
            Il numero in grande è quanto pagherà in media l'ospite a notte per l'alloggio: prezzo PriceLabs di oggi (media dei giorni ancora liberi) × ricarico di ogni portale × sconti medi (mobile, Genius, ospiti migliori, last minute, settimanali…, con quanto spesso scattano), pesato sulle notti della casa per portale. Ricarichi, sconti e frequenze sono quelli del simulatore «Parità OTA» (scheda Canali, configurazione attuale). Anno scorso = quanto hai incassato davvero a notte nello stesso mese, solo alloggio{senzaPulizie ? ' (senza pulizie né tassa di soggiorno)' : ' (i dati di oggi non hanno ancora le pulizie: premi «Ricarica dati»)'}, ricarichi e sconti compresi.
            {' '}Rosso = prezzo più alto di almeno il {s.prezzoAlto}% <b>e</b> meno notti già vendute che alla stessa data dell'anno scorso. Giallo = solo una delle due. Grigio = l'anno scorso meno di {s.minNottiAnnoScorso} notti vendute nel mese o casa aperta da meno di {s.mesiLancio} mesi.
            {' '}I prezzi lontani sono sempre più alti di quello che poi si incassa (gli sconti arrivano dopo): il giallo sui mesi lontani da solo non è un allarme, il rosso sì. Soglie in config/prezzi-vendita.js.
          </div>
        </>
      )}
    </Panel>
  );
}

// ---- Ritmo delle prenotazioni ----
function PickupPanel({ data, houses }) {
  const p = useMemo(() => pickupStats(data, new Date(), houses), [data, houses]);
  const lyL = fmtDay(p.lyToday) + ' ' + p.lyToday.slice(0, 4);
  return (
    <Panel title="Ritmo delle prenotazioni" hint="notti prenotate negli ultimi giorni, per qualunque data di soggiorno" extra="mt-4">
      <div className="kpi-grid grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {p.windows.map((w, i) => {
          const d = pctChangeOf(w.cur.nights, w.ly.nights);
          return (
            <KpiCard key={w.days}
              label={`Notti prenotate, ultimi ${w.days} giorni`}
              value={fmtNum(w.cur.nights)}
              delta={w.ly.nights ? `${fmtSigned(d)} vs stessi giorni fino al ${lyL}` : 'nessun dato l\'anno scorso'}
              up={d != null ? d >= 0 : undefined}
              align={i === 2 ? 'right' : undefined}
              tip={{ title: `Ultimi ${w.days} giorni`, rows: [
                ['Prenotazioni', `${fmtNum(w.cur.bookings)} vs ${fmtNum(w.ly.bookings)}`],
                ['Notti', `${fmtNum(w.cur.nights)} vs ${fmtNum(w.ly.nights)}`],
                ['Ricavi', `${fmtEur(w.cur.revenue)} vs ${fmtEur(w.ly.revenue)}`],
                ['Notti per prenotazione', `${w.cur.bookings ? (w.cur.nights / w.cur.bookings).toFixed(1).replace('.', ',') : '—'} vs ${w.ly.bookings ? (w.ly.nights / w.ly.bookings).toFixed(1).replace('.', ',') : '—'}`],
              ], note: `Oggi vs lo stesso periodo fino al ${lyL}. Contate solo le prenotazioni ancora valide alla data, senza quelle importate in blocco.` }} />
          );
        })}
      </div>
      <div className="h-64">
        <Bar data={{
          labels: p.weekly.map(w => `${fmtDay(w.start)}–${fmtDay(w.end)}`),
          datasets: [
            { label: 'Notti prenotate nella settimana', data: p.weekly.map(w => w.cur), backgroundColor: C.brand, borderRadius: 3 },
            { label: 'Stessa settimana, anno scorso', data: p.weekly.map(w => w.ly), backgroundColor: C.accent, borderRadius: 3 },
          ],
        }} options={CHART_OPTS_LEGEND_BOTTOM} />
      </div>
    </Panel>
  );
}

// ---- Canali delle notti già prenotate ----
function ChannelForwardPanel({ data, houses, lyLabel }) {
  const m = useMemo(() => channelMixForward(data, new Date(), houses), [data, houses]);
  return (
    <Panel title="Da quali canali arrivano le notti già prenotate" hint={`prossimi 6 mesi, oggi vs ${lyLabel}`}>
      {m.rows.length === 0 ? <EmptyState message="Nessuna notte prenotata nei prossimi 6 mesi." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th>Canale</th><th className="num">Notti oggi</th><th className="num">Quota</th><th className="num">Al {lyLabel}</th><th className="num">Quota</th><th className="num">Δ quota</th></tr></thead>
            <tbody>
              {m.rows.map(r => (
                <tr key={r.channel}>
                  <td>{r.channel}</td>
                  <td className="num">{fmtNum(r.nights)}</td>
                  <td className="num">{fmtPct(r.share)}</td>
                  <td className="num">{fmtNum(r.lyNights)}</td>
                  <td className="num">{fmtPct(r.lyShare)}</td>
                  <td className="num">{r.share != null && r.lyShare != null ? <span className="pill gray">{fmtSigned(r.share - r.lyShare, 'pp')}</span> : '—'}</td>
                </tr>
              ))}
              <tr><td><strong>Totale</strong></td><td className="num"><strong>{fmtNum(m.totCur)}</strong></td><td></td><td className="num"><strong>{fmtNum(m.totLy)}</strong></td><td></td><td></td></tr>
            </tbody>
          </table>
          <div className="text-xs mt-3" style={{ color: 'var(--text-dim)' }}>
            Ricavi già prenotati: {m.rows.filter(r => r.revenue).map(r => `${r.channel} ${fmtEur(r.revenue)}`).join(' · ') || '—'}. Una quota Booking più alta vuol dire più commissioni (19,5–24,5%).
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---- Notti orfane ----
function OrphanPanel({ data, houses }) {
  const list = useMemo(() => orphanNights(data, new Date(), houses, 60), [data, houses]);
  const nights = list.reduce((a, g) => a + g.nights, 0);
  return (
    <Panel title="Notti orfane nei prossimi 60 giorni" hint={list.length ? `${list.length} buchi, ${nights} notti` : 'nessun buco'}>
      {list.length === 0 ? <EmptyState message="Nessun buco di 1–2 notti fra due prenotazioni nei prossimi 60 giorni." /> : (
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr><th>Casa</th><th>Dal</th><th>Al</th><th className="num">Notti</th><th>Fra</th></tr></thead>
            <tbody>
              {list.map(g => (
                <tr key={g.houseId + g.from}>
                  <td>{HOUSES_META[g.houseId]?.short || g.houseId}</td>
                  <td>{fmtDay(g.from, true)}</td>
                  <td>{fmtDay(g.to, true)}</td>
                  <td className="num"><span className={`pill ${g.nights === 1 ? 'red' : 'yellow'}`}>{g.nights}</span></td>
                  <td className="text-xs" style={{ color: 'var(--text-dim)' }}>{g.before} → {g.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-xs mt-3" style={{ color: 'var(--text-dim)' }}>
        Buchi di 1 o 2 notti fra un check-out e il check-in successivo: difficili da vendere con il soggiorno minimo attuale. Si recuperano abbassando il minimo per quelle date o con uno sconto mirato. I blocchi messi a mano in Guesty non sono nei dati: un buco può essere già chiuso.
      </div>
    </Panel>
  );
}

// ============================================================================
// CANCELLAZIONI VIEW
// ============================================================================
function CancellationsView({ data, houses }) {
  const c = useMemo(() => cancellationStats(data, new Date(), houses), [data, houses]);
  if (!Array.isArray(data?.cancelled)) {
    return <EmptyState message="Le cancellazioni compariranno dal prossimo aggiornamento dei dati (pulsante «Ricarica dati»)." />;
  }
  const period = `${monthLabel(c.from.slice(0, 7))} – ${monthLabel(c.monthly[c.monthly.length - 1].month)}`;
  return (
    <>
      <div className="note mb-4">
        <strong>Cancellazioni — {period}.</strong> Prenotazioni con check-in in questi 12 mesi chiusi. Tasso = cancellate diviso (confermate + cancellate). Contano solo le prenotazioni cancellate, non le richieste rifiutate o scadute.
        {!c.withCancelDate && ' Guesty non ha fornito la data di cancellazione: i giorni di preavviso non sono disponibili.'}
      </div>

      <div className="kpi-grid grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Tasso di cancellazione" value={fmtPct(c.total.rate)} delta={`${fmtNum(c.total.cancelled)} su ${fmtNum(c.total.confirmed + c.total.cancelled)} prenotazioni`}
          tip={{ title: 'Ultimi 12 mesi, per check-in', rows: [['Confermate', fmtNum(c.total.confirmed)], ['Cancellate', fmtNum(c.total.cancelled)], ['Tasso', fmtPct(c.total.rate), true]] }} />
        <KpiCard label="Notti cancellate" value={fmtNum(c.total.nightsLost)} delta="notti tornate libere"
          tip={{ title: 'Notti cancellate per canale', rows: c.byChannel.filter(r => r.nightsLost).map(r => [r.channel, `${fmtNum(r.nightsLost)} notti`]) }} />
        <KpiCard label="Preavviso medio" value={c.total.medianNotice != null ? `${Math.round(c.total.medianNotice)} gg` : '—'} delta="giorni fra cancellazione e check-in (mediana)" align="right"
          tip={{ title: 'Preavviso per canale (mediana)', rows: c.byChannel.filter(r => r.medianNotice != null).map(r => [r.channel, `${Math.round(r.medianNotice)} giorni`]), note: 'Più il preavviso è corto, più è difficile rivendere le notti.' }} />
        <KpiCard label="Cancellate negli ultimi 30 giorni" value={fmtNum(c.recent.count)} delta={`${fmtNum(c.recent.futureNights)} notti future tornate libere`} align="right"
          tip={{ title: 'Ultimi 30 giorni', rows: [['Prenotazioni cancellate', fmtNum(c.recent.count)], ['Notti in tutto', fmtNum(c.recent.nights)], ['Di cui ancora da vivere', fmtNum(c.recent.futureNights)]], note: 'Per qualunque data di soggiorno. Le notti future sono da rimettere in vendita.' }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Tasso di cancellazione per mese di check-in" hint="%">
          <div className="h-72">
            <Bar data={{
              labels: c.monthly.map(m => monthLabel(m.month)),
              datasets: [
                { label: 'Cancellate', data: c.monthly.map(m => m.cancelled), backgroundColor: C.accent, borderRadius: 3, yAxisID: 'y' },
                { label: 'Tasso %', data: c.monthly.map(m => m.rate != null ? Math.round(m.rate * 10) / 10 : null), type: 'line', borderColor: C.brand, backgroundColor: C.brand, tension: 0.3, yAxisID: 'y1' },
              ],
            }} options={{ ...CHART_OPTS_LEGEND_BOTTOM, scales: { y: { beginAtZero: true, title: { display: true, text: 'prenotazioni' } }, y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: '%' } } } }} />
          </div>
        </Panel>
        <Panel title="Per canale" hint="ultimi 12 mesi">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th>Canale</th><th className="num">Confermate</th><th className="num">Cancellate</th><th className="num">Tasso</th><th className="num">Notti</th><th className="num">Preavviso</th></tr></thead>
              <tbody>
                {c.byChannel.map(r => (
                  <tr key={r.channel}>
                    <td>{r.channel}</td>
                    <td className="num">{fmtNum(r.confirmed)}</td>
                    <td className="num">{fmtNum(r.cancelled)}</td>
                    <td className="num">{r.rate != null ? <span className={`pill ${r.rate >= 20 ? 'red' : r.rate >= 10 ? 'yellow' : 'green'}`}>{fmtPct(r.rate)}</span> : '—'}</td>
                    <td className="num">{fmtNum(r.nightsLost)}</td>
                    <td className="num">{r.medianNotice != null ? `${Math.round(r.medianNotice)} gg` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs mt-3" style={{ color: 'var(--text-dim)' }}>Preavviso = mediana dei giorni fra la cancellazione e il check-in previsto.</div>
        </Panel>
      </div>
    </>
  );
}

function monthLabel(ym) {
  const [, m] = ym.split('-');
  return MONTHS[parseInt(m) - 1] + ' ' + ym.split('-')[0];
}

// ============================================================================
// AUDIENCE VIEW
// ============================================================================
function AudienceView({ data, reservations, houses, year, monthIdx }) {
  const filtered = filterReservations(reservations, houses, year, monthIdx);

  const countries = topCountries(filtered, 10);
  const losH = losByHouse(filtered);
  const losDist = losDistribution(filtered);
  const partyH = avgPartyByHouse(filtered);
  const lt = leadTimeStats(filtered);

  const losAvg = filtered.length ? filtered.reduce((a, r) => a + (r.nights || 0), 0) / filtered.length : null;
  const partyAvg = filtered.length ? filtered.reduce((a, r) => a + (r.persons || 0), 0) / filtered.length : null;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <KpiCard label="LOS medio" value={losAvg != null ? `${losAvg.toFixed(1).replace('.', ',')} notti` : '—'} />
        <KpiCard label="Persone medie / prenotazione" value={partyAvg != null ? partyAvg.toFixed(1).replace('.', ',') : '—'} />
        <KpiCard label="Top paese" value={countries[0]?.name || '—'} delta={countries[0] ? `${countries[0].pct.toFixed(0)}% delle prenotazioni` : null} />
        <KpiCard label="Lead time medio" value={lt.avg != null ? `${lt.avg.toFixed(0)} giorni` : '—'} delta={lt.count ? `${lt.count} prenotazioni` : null} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel title="Top 10 paesi" hint="quota prenotazioni (filtri correnti)">
          <div className="h-80">{countries.length > 0 ? (
            <Doughnut data={{ labels: countries.map(c => c.name), datasets: [{ data: countries.map(c => c.count), backgroundColor: PALETTE }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 16, padding: 10, font: { size: 13 } } }, tooltip: { callbacks: { label: (ctx) => { const total = ctx.dataset.data.reduce((a,b) => a+b, 0); const pct = total ? (ctx.parsed / total * 100).toFixed(1).replace('.', ',') : '0'; return `${ctx.label}: ${ctx.parsed} (${pct}%)`; } } } } }} />
          ) : <EmptyState message="Nessun dato paesi." />}</div>
        </Panel>
        <Panel title="LOS medio per casa" hint="notti per prenotazione">
          <div className="h-80"><Bar data={{ labels: ALL_HOUSES.map(h => HOUSES_META[h].short), datasets: [{ label: 'LOS', data: ALL_HOUSES.map(h => losH[h] || null), backgroundColor: ALL_HOUSES.map(h => HOUSES_META[h].color), borderRadius: 4 }] }} options={{ ...CHART_OPTS_NO_LEGEND, indexAxis: 'y' }} /></div>
        </Panel>
        <Panel title="Distribuzione LOS" hint="% prenotazioni per durata">
          <div className="h-72"><Bar data={{ labels: losDist.map(d => d.label === '7+' ? '7+ notti' : d.label === '1' ? '1 notte' : `${d.label} notti`), datasets: [{ label: '% prenotazioni', data: losDist.map(d => d.pct), backgroundColor: C.accent, borderRadius: 4 }] }} options={CHART_OPTS_NO_LEGEND} /></div>
        </Panel>
        <Panel title="Persone medie per casa" hint="size party">
          <div className="h-72"><Bar data={{ labels: ALL_HOUSES.map(h => HOUSES_META[h].short), datasets: [{ label: 'Persone medie', data: ALL_HOUSES.map(h => partyH[h] || null), backgroundColor: ALL_HOUSES.map(h => HOUSES_META[h].color), borderRadius: 4 }] }} options={CHART_OPTS_NO_LEGEND} /></div>
        </Panel>

        <Panel title="Distribuzione lead time" hint="giorni tra prenotazione e check-in" extra="md:col-span-2">
          {lt.count > 0 ? (
            <div className="h-72"><Bar data={{ labels: lt.distribution.map(d => d.label + ' giorni'), datasets: [{ label: 'Prenotazioni', data: lt.distribution.map(d => d.count), backgroundColor: C.brand, borderRadius: 4 }] }} options={CHART_OPTS_NO_LEGEND} /></div>
          ) : (
            <div className="h-48 flex items-center justify-center flex-col gap-3 text-center" style={{ color: 'var(--text-dim)' }}>
              <div>Nessun dato di lead time disponibile per il filtro corrente.</div>
              
            </div>
          )}
        </Panel>

        {Object.keys(lt.byChannel).length > 0 && (
          <Panel title="Lead time medio per canale" hint="giorni" extra="md:col-span-2">
            <div className="h-72"><Bar data={{ labels: Object.keys(lt.byChannel), datasets: [{ label: 'Giorni medi', data: Object.values(lt.byChannel).map(v => v != null ? Math.round(v) : null), backgroundColor: C.info, borderRadius: 4 }] }} options={CHART_OPTS_NO_LEGEND} /></div>
          </Panel>
        )}
      </div>
    </>
  );
}

// ============================================================================
// HOUSES VIEW
// ============================================================================
function HousesView({ data, year, monthIdx, houses, setView, setHouses }) {
  const list = houses.length ? houses : ALL_HOUSES;
  const rows = list.map(h => ({ id: h, ...kpiForHouseYear(data, h, year, monthIdx) }));

  return (
    <>
      <div className="note mb-4">
        <strong>Vista per-casa (solo KPI operativi).</strong> Costi e utile non sono in Guesty: per il conto economico usa i fogli contabilità / dashboard V1. Click su una riga per il drill-down.
      </div>
      <Panel title="Tabella performance — anno selezionato" extra="mb-4">
        <table>
          <thead>
            <tr><th>Casa</th><th className="num">Prenotazioni</th><th className="num">Notti</th><th className="num">Ricavi</th><th className="num">Ricavi netti OTA</th><th className="num">Occupazione</th><th className="num">ADR</th><th className="num">Tassa soggiorno</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} onClick={() => { setHouses([r.id]); setView('overview'); }} className="cursor-pointer">
                <td><strong>{HOUSES_META[r.id].name}</strong></td>
                {!r.bookings ? (
                  <td colSpan="7" className="text-center" style={{ color: 'var(--text-subtle)' }}>— dati non disponibili per {year} —</td>
                ) : (
                  <>
                    <td className="num">{fmtNum(r.bookings)}</td>
                    <td className="num">{fmtNum(r.nights)}</td>
                    <td className="num">{fmtEur(r.revenue)}</td>
                    <td className="num">{fmtEur(r.netRevenue)}</td>
                    <td className="num">{fmtPct(r.occ)}</td>
                    <td className="num">{fmtEur(r.adr)}</td>
                    <td className="num">{fmtEur(r.cityTax)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel title="Ricavi per casa">
          <div className="h-72"><Bar data={{ labels: list.map(h => HOUSES_META[h].short), datasets: [{ label: 'Ricavi €', data: rows.map(r => r.revenue || 0), backgroundColor: list.map(h => HOUSES_META[h].color), borderRadius: 4 }] }} options={CHART_OPTS_NO_LEGEND} /></div>
        </Panel>
        <Panel title="Occupazione per casa">
          <div className="h-72"><Bar data={{ labels: list.map(h => HOUSES_META[h].short), datasets: [{ label: 'Occupazione %', data: rows.map(r => r.occ || 0), backgroundColor: list.map(h => HOUSES_META[h].color), borderRadius: 4 }] }} options={{ ...CHART_OPTS_NO_LEGEND, scales: { y: { min: 0, max: 100 } } }} /></div>
        </Panel>
      </div>
    </>
  );
}

// ============================================================================
// PRIMITIVES
// ============================================================================
function KpiCard({ label, value, delta, up, tip, align }) {
  return (
    <div className={`panel tip-wrap ${tip ? 'has-tip' : ''}`} tabIndex={tip ? 0 : undefined}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {delta && <div className={`kpi-delta ${up === true ? 'up' : up === false ? 'down' : ''}`}>{delta}</div>}
      {tip && <TipPop tip={tip} align={align} />}
    </div>
  );
}

// Riquadro che compare al passaggio del mouse (o al tocco). tip = { title, rows: [[etichetta, valore, separatore?]], note }
function TipPop({ tip, wide = false, align, width }) {
  return (
    <div className={`tip-pop ${wide ? 'wide' : ''} ${align === 'right' ? 'align-right' : ''}`} role="tooltip" style={width ? { width } : undefined}>
      {tip.title && <div className="tip-title">{tip.title}</div>}
      {tip.rows?.length > 0 && (
        <table>
          <tbody>
            {tip.rows.map(([k, v, sep], i) => (
              <tr key={i} className={sep ? 'tip-sep' : ''}><td>{k}</td><td className="num">{v}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {tip.note && <div className="tip-note">{tip.note}</div>}
    </div>
  );
}

function Panel({ title, hint, extra = '', children }) {
  return (
    <div className={`panel ${extra}`}>
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--brand-dark)' }}>
        {title}
        {hint && <span className="ml-2 font-normal text-xs" style={{ color: 'var(--text-dim)' }}>— {hint}</span>}
      </h3>
      {children}
    </div>
  );
}

function EmptyState({ message }) {
  return <div className="h-48 flex items-center justify-center text-sm" style={{ color: 'var(--text-subtle)' }}>{message}</div>;
}
