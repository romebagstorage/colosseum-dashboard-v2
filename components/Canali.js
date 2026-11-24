'use client';

// La scheda «Canali»: misura, simulazione e avvisi per Airbnb, Booking e diretto.
//
//   1. Avvisi  — un portale lontano dall'obiettivo nel simulatore (più di 3 punti
//                su 100 € di PriceLabs) o una quota netto/pagato che cambia di
//                colpo nelle prenotazioni vere (lib/canali.js, `avvisiMisura`).
//   2. Misura  — dalle prenotazioni vere, per il periodo e le case scelte in
//                alto: quanto paga l'ospite, quanto arriva, la quota. I totali
//                coincidono con la Panoramica (stesso calcolo per notti).
//   3. Simulatore — il porting dell'artifact «Parità OTA» (lib/parita.js), con
//                le configurazioni salvate sul server (/api/canali/config).

import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtEur, fmtEurDecimal, MONTHS, HOUSES_META } from '@/lib/format';
import { kpiAggregatedYear, kpiForHouseYear } from '@/lib/aggregators';
import { BRAND } from '@/config/brand';
import {
  PARITA_DEFAULT, PARITA_HOUSES, PARITA_ORDER, PARITA_VERIFICHE, PARITA_SOGLIE, PARITA_LETTA_IL,
} from '@/config/parita';
import {
  clone, chan, stay, per100, annual, scenarioOf, discountCosts, curPrice, targetP100,
  markupForTarget, verify, simAlerts, compatta, espandi, isCompatta,
} from '@/lib/parita';
import {
  GRUPPI, misura, somma, mesiDelPeriodo, avvisiMisura, nottiUltimoAnno,
} from '@/lib/canali';

const COLORE = { airbnb: BRAND.colors.danger, booking: BRAND.colors.info, direct: BRAND.colors.brand, sito: BRAND.colors.brand, manuale: BRAND.colors.warning, partner: BRAND.colors.success, altri: BRAND.colors.inkSubtle };
const COMM_LABEL = { airbnb: 'Commissione Airbnb', booking: 'Commissione e costi Booking', direct: "Costo d'incasso" };
const BOZZA = 'canali.bozza.v1';

const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct1 = (v) => (v < 0 ? '−' : '') + nf1.format(Math.abs(v)) + '%';
const sgn1 = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf1.format(Math.abs(v));
const sgnEur = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + '€ ' + nf0.format(Math.abs(Math.round(v)));
const quota = (v) => (v == null ? '—' : nf1.format(v * 100) + '%');
const Dot = ({ id }) => <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: COLORE[id], flex: 'none' }} />;

export default function CanaliView({ data, houses, year, monthIdx }) {
  return (
    <>
      <Avvisi data={data} houses={houses} />
      <Misura data={data} houses={houses} year={year} monthIdx={monthIdx} />
      <Simulatore data={data} />
    </>
  );
}

// ============================================================================
// AVVISI
// ============================================================================
// Gli avvisi del simulatore arrivano da <Simulatore> via evento, perché
// dipendono dalla configurazione caricata dal server.
function Avvisi({ data, houses }) {
  const misurati = useMemo(() => avvisiMisura(data, houses), [data, houses]);
  const [sim, setSim] = useState([]);
  useEffect(() => {
    const f = (e) => setSim(e.detail || []);
    window.addEventListener('canali-avvisi', f);
    return () => window.removeEventListener('canali-avvisi', f);
  }, []);
  const n = misurati.length + sim.length;
  return (
    <div className="panel mb-4" style={n ? { borderLeft: `3px solid ${BRAND.colors.danger}` } : undefined}>
      <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--brand-dark)' }}>
        Avvisi {n ? <span className="pill red ml-2">{n}</span> : <span className="pill green ml-2">nessuno</span>}
      </h3>
      {n === 0 && <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Tutti i portali sono entro {PARITA_SOGLIE.puntiObiettivo} punti dall'obiettivo, e nessuna quota netto/pagato si è spostata di più di {PARITA_SOGLIE.puntiQuota} punti nell'ultimo mese chiuso.</p>}
      <ul className="text-sm" style={{ display: 'grid', gap: 6 }}>
        {misurati.map((a) => (
          <li key={'m' + a.g} className="flex gap-2 items-start">
            <Dot id={a.g} />
            <span><strong>{a.name}</strong>: a {monthName(a.mese)} la quota netto/pagato è stata {quota(a.quota)}, contro {quota(a.media)} di media nei tre mesi prima ({sgn1(a.diff)} punti, {nf0.format(a.notti)} notti). Prenotazioni vere, case scelte in alto.</span>
          </li>
        ))}
        {sim.map((a) => (
          <li key={'s' + a.h + a.ch} className="flex gap-2 items-start">
            <Dot id={a.ch} />
            <span><strong>{a.name} · {PARITA_HOUSES[a.h].name}</strong>: arrivano {nf1.format(a.T + a.diff)} € su 100 € di PriceLabs, {sgn1(a.diff)} punti {a.diff < 0 ? 'sotto' : 'sopra'} l'obiettivo ({nf1.format(a.T)}). Simulatore, configurazione corrente.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1].toLowerCase()} ${ym.slice(0, 4)}`;

// ============================================================================
// MISURA
// ============================================================================
function Misura({ data, houses, year, monthIdx }) {
  const tab = useMemo(() => misura(data?.reservations), [data]);
  const mesi = mesiDelPeriodo(year, monthIdx, data?.currentYear, data?.currentMonth);
  const tutti = GRUPPI.map((g) => g.id);
  const righe = GRUPPI.map((g) => ({ ...g, ...somma(tab, houses, [g.id], mesi) })).filter((r) => r.notti > 0);
  const tot = somma(tab, houses, tutti, mesi);

  // Il controllo con la Panoramica: stessi ricavi e stesso netto.
  const pan = houses.length === 1 ? kpiForHouseYear(data, houses[0], year, monthIdx) : kpiAggregatedYear(data, year, monthIdx, houses);
  const okRicavi = pan && Math.abs((pan.revenue || 0) - tot.pagato) < 1;
  const okNetto = pan && pan.netRevenue != null && Math.abs(pan.netRevenue - tot.netto) < 1;

  const periodo = monthIdx != null ? `${MONTHS[monthIdx]} ${year}` : `${year}${Number(year) === Number(data?.currentYear) ? ` fino a ${MONTHS[data.currentMonth].toLowerCase()}` : ''}`;
  const mesiAnno = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
    .filter((m) => !(Number(year) === Number(data?.currentYear) && Number(m.slice(5, 7)) - 1 > data.currentMonth));

  return (
    <div className="panel mb-4">
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--brand-dark)' }}>
        Quanto arriva da ogni portale <span className="ml-2 font-normal text-xs" style={{ color: 'var(--text-dim)' }}>— prenotazioni vere, {periodo}, {houses.length === PARITA_ORDER.length ? 'tutte le case' : houses.map((h) => HOUSES_META[h]?.short).join(', ')}</span>
      </h3>
      <p className="text-xs mb-3" style={{ color: 'var(--text-dim)' }}>
        «Paga l'ospite» è il pagamento senza tassa di soggiorno (i «Ricavi» della Panoramica); «Ti arriva» è il netto. Le notti a cavallo di due mesi si dividono fra i due, come nel resto della dashboard.
      </p>
      {righe.length === 0 ? <div className="text-sm py-6" style={{ color: 'var(--text-subtle)' }}>Nessuna notte nel periodo scelto.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th>Portale</th><th className="num">Notti</th><th className="num">Paga l'ospite</th><th className="num">a notte</th><th className="num">Ti arriva</th><th className="num">a notte</th><th className="num">Netto / pagato</th></tr></thead>
            <tbody>
              {righe.map((r) => (
                <tr key={r.id}>
                  <td><span className="inline-flex gap-2 items-center"><Dot id={r.id} />{r.name}{r.stimato && <span className="pill yellow" title={r.id === 'sito' ? "Il netto del sito toglie un costo Stripe stimato (2,5% + 0,25 €)" : "Il netto Booking è calcolato con la commissione misurata per casa: vedi nota sotto"}>stimato</span>}</span></td>
                  <td className="num">{nf0.format(r.notti)}</td>
                  <td className="num">{fmtEur(r.pagato)}</td>
                  <td className="num">{fmtEur(r.pagatoNotte)}</td>
                  <td className="num">{fmtEur(r.netto)}</td>
                  <td className="num"><strong>{fmtEur(r.nettoNotte)}</strong></td>
                  <td className="num">{quota(r.quota)}</td>
                </tr>
              ))}
              <tr>
                <td><strong>Totale</strong></td><td className="num"><strong>{nf0.format(tot.notti)}</strong></td>
                <td className="num"><strong>{fmtEur(tot.pagato)}</strong></td><td className="num">{fmtEur(tot.pagatoNotte)}</td>
                <td className="num"><strong>{fmtEur(tot.netto)}</strong></td><td className="num">{fmtEur(tot.nettoNotte)}</td><td className="num">{quota(tot.quota)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs mt-2" style={{ color: 'var(--text-dim)' }}>
            Controllo con la Panoramica, stesso periodo e stesse case: ricavi {fmtEur(pan?.revenue)} {okRicavi ? <span className="pill green">coincide</span> : <span className="pill red">non coincide</span>} · netto {fmtEur(pan?.netRevenue)} {okNetto ? <span className="pill green">coincide</span> : <span className="pill red">non coincide</span>}
          </p>
        </div>
      )}

      {righe.length > 0 && (
        <>
          <h4 className="text-xs font-semibold mt-5 mb-2" style={{ color: 'var(--brand-dark)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Per casa · ti arriva a notte e quota netto/pagato</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th>Casa</th>{GRUPPI.filter((g) => g.id !== 'altri').map((g) => <th key={g.id} className="num"><span className="inline-flex gap-1 items-center"><Dot id={g.id} />{g.name.split(',')[0]}</span></th>)}</tr></thead>
              <tbody>
                {houses.map((h) => (
                  <tr key={h}>
                    <td>{HOUSES_META[h]?.short}</td>
                    {GRUPPI.filter((g) => g.id !== 'altri').map((g) => { const s = somma(tab, [h], [g.id], mesi); return <td key={g.id} className="num">{s.notti ? <>{fmtEur(s.nettoNotte)} <span style={{ color: 'var(--text-dim)' }}>· {quota(s.quota)} · {nf0.format(s.notti)} n.</span></> : '—'}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {monthIdx == null && (
            <>
              <h4 className="text-xs font-semibold mt-5 mb-2" style={{ color: 'var(--brand-dark)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Mese per mese · quota netto/pagato</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th>Portale</th>{mesiAnno.map((m) => <th key={m} className="num">{MONTHS[Number(m.slice(5, 7)) - 1]}</th>)}</tr></thead>
                  <tbody>
                    {GRUPPI.filter((g) => g.id !== 'altri').map((g) => (
                      <tr key={g.id}>
                        <td><span className="inline-flex gap-2 items-center"><Dot id={g.id} />{g.name.split(',')[0]}</span></td>
                        {mesiAnno.map((m) => { const s = somma(tab, houses, [g.id], [m]); return <td key={m} className="num" title={s.notti ? `${nf0.format(s.notti)} notti · ${fmtEur(s.nettoNotte)} a notte` : ''}>{s.notti ? quota(s.quota) : '—'}</td>; })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      <div className="note mt-4">
        <strong>Da sapere.</strong> Il netto Booking in questa dashboard non è letto prenotazione per prenotazione: è calcolato con la commissione misurata il 19/11/2026, 24,5% su Poliziano, Bilocale e Trilocale e 19,5% su Marco Aurelio e Prestige (config/houses.js). Per Booking la quota è quindi fissa per casa e non può «cambiare di colpo». Trip.com e Agoda versano già il netto: per loro «paga l'ospite» è quello che ricevi, non il prezzo pagato dall'ospite. Quanto arriva su 100 € di prezzo PriceLabs, misurato, richiede i prezzi PriceLabs del giorno della prenotazione, che oggi non si conservano.
      </div>
    </div>
  );
}

// ============================================================================
// SIMULATORE
// ============================================================================
function useServerConfig() {
  const [srv, setSrv] = useState({ stato: 'carico', attivo: false, dati: null, errore: null });
  useEffect(() => {
    let vivo = true;
    fetch('/api/canali/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (vivo) setSrv({ stato: 'pronto', attivo: !!j.attivo, dati: j.stato || null, errore: null }); })
      .catch(() => { if (vivo) setSrv({ stato: 'pronto', attivo: false, dati: null, errore: 'Archivio non raggiungibile' }); });
    return () => { vivo = false; };
  }, []);
  async function salva(body) {
    const r = await fetch('/api/canali/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.motivo || `HTTP ${r.status}`);
    setSrv((s) => ({ ...s, dati: j.stato }));
    return j.stato;
  }
  return [srv, salva];
}

function Simulatore({ data }) {
  const [srv, salvaServer] = useServerConfig();
  const [S, setS] = useState(() => clone(PARITA_DEFAULT));
  const [BASE, setBase] = useState(() => compatta(PARITA_DEFAULT));
  const [sporco, setSporco] = useState(false);
  const [msg, setMsg] = useState(null);
  const [distTab, setDistTab] = useState('airbnb');
  const caricato = useRef(false);

  // Partenza: la configurazione corrente dal server; se non c'e', la bozza di
  // questo browser; altrimenti quella attuale (config/parita.js).
  useEffect(() => {
    if (srv.stato !== 'pronto' || caricato.current) return;
    caricato.current = true;
    let bozza = null;
    try { bozza = JSON.parse(localStorage.getItem(BOZZA) || 'null'); } catch { /* niente */ }
    const dalServer = srv.dati?.corrente && isCompatta(srv.dati.corrente) ? srv.dati.corrente : null;
    if (bozza && isCompatta(bozza.c) && (!dalServer || bozza.il > (srv.dati?.aggiornato || ''))) {
      setS(espandi(bozza.c, PARITA_DEFAULT)); setSporco(true);
    } else if (dalServer) setS(espandi(dalServer, PARITA_DEFAULT));
    if (srv.dati?.base && isCompatta(srv.dati.base)) setBase(srv.dati.base);
  }, [srv]);

  const aggiorna = (fn) => {
    setS((prev) => {
      const next = clone(prev); fn(next);
      try { localStorage.setItem(BOZZA, JSON.stringify({ il: new Date().toISOString(), c: compatta(next) })); } catch { /* niente */ }
      return next;
    });
    setSporco(true);
  };
  const timer = useRef(null);
  const avvisa = (t) => { setMsg(t); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 3500); };

  const H = PARITA_HOUSES[S.house], comm = S.houses[S.house].comm, price = curPrice(S), n = Math.max(1, Math.round(S.stay || 1));
  const T = targetP100(S);
  const R = useMemo(() => Object.fromEntries(S.channels.map((ch) => [ch.id, stay(ch, price, n, H.cleaning, comm[ch.id])])), [S, price, n, H, comm]);
  const baseS = useMemo(() => espandi(BASE, PARITA_DEFAULT), [BASE]);
  const cur = useMemo(() => annual(S, scenarioOf(S)), [S]);
  const base = useMemo(() => annual(S, scenarioOf(baseS)), [S, baseS]);
  const costi = useMemo(() => discountCosts(S), [S]);
  const ver = useMemo(() => verify(PARITA_VERIFICHE), []);
  const alerts = useMemo(() => simAlerts(S, PARITA_SOGLIE.puntiObiettivo), [S]);
  useEffect(() => { window.dispatchEvent(new CustomEvent('canali-avvisi', { detail: alerts })); }, [alerts]);

  async function salva() {
    try {
      await salvaServer({ corrente: compatta(S) });
      try { localStorage.removeItem(BOZZA); } catch { /* niente */ }
      setSporco(false); avvisa('Configurazione salvata sul server');
    } catch (e) { avvisa('Non salvata: ' + e.message); }
  }
  async function salvaConNome() {
    const nome = window.prompt('Nome della configurazione (per esempio «Airbnb 25%»)');
    if (!nome) return;
    const salvate = (srv.dati?.salvate || []).filter((x) => x.nome !== nome);
    if (salvate.length >= 3) { avvisa('Ne tengo al massimo tre: togline una prima'); return; }
    try {
      await salvaServer({ salvate: [...salvate, { nome, il: new Date().toISOString().slice(0, 10), stato: compatta(S) }] });
      avvisa(`Salvata come «${nome}»`);
    } catch (e) { avvisa('Non salvata: ' + e.message); }
  }
  async function togli(nome) {
    try { await salvaServer({ salvate: (srv.dati?.salvate || []).filter((x) => x.nome !== nome) }); avvisa(`«${nome}» tolta`); }
    catch (e) { avvisa('Non tolta: ' + e.message); }
  }
  async function fissaBase() {
    const b = compatta(S);
    setBase(b);
    if (srv.attivo) { try { await salvaServer({ base: b }); } catch (e) { avvisa('Punto di partenza non salvato: ' + e.message); return; } }
    avvisa('Punto di partenza fissato');
  }
  function nottiDallaDashboard() {
    const nu = nottiUltimoAnno(data?.reservations);
    aggiorna((s) => { for (const h of PARITA_ORDER) { const x = nu.perCasa[h]; if (x) s.houses[h].nights = { airbnb: x.airbnb, booking: x.booking, direct: x.direct }; } });
    // `fine` e' escluso: l'ultimo giorno contato e' quello prima.
    const ultimo = new Date(nu.fine + 'T00:00:00Z'); ultimo.setUTCDate(ultimo.getUTCDate() - 1);
    avvisa(`Notti con check-in dal ${nu.inizio.split('-').reverse().join('/')} al ${ultimo.toISOString().slice(0, 10).split('-').reverse().join('/')}`);
  }

  const a = R.airbnb, b = R.booking, d = R.direct;
  const cheap = [[a, 'Airbnb'], [b, 'Booking.com'], [d, 'il diretto']].sort((x, y) => x[0].guest - y[0].guest)[0];
  const diff = cur.tot - base.tot;
  const nightsTot = PARITA_ORDER.reduce((s, h) => s + S.channels.reduce((t, ch) => t + (S.houses[h].nights[ch.id] || 0), 0), 0);
  const avg = nightsTot ? cur.tot / nightsTot : 0;
  const best = chan(S, 'airbnb').groups.find((g) => g.id === 'best')?.items[0];

  return (
    <div className="panel mb-4">
      <div className="flex flex-wrap gap-3 justify-between items-start mb-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-dark)' }}>Simulatore Parità OTA</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--text-dim)', maxWidth: '70ch' }}>Per ogni portale: quanto paga l'ospite e quanto incassi, con gli sconti che scattano davvero e quanto spesso. Dati di partenza letti il {PARITA_LETTA_IL}; ogni numero si può cambiare. Non modifica nulla su Guesty o sui portali.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button className="ctl" onClick={() => { aggiorna((s) => Object.assign(s, clone(PARITA_DEFAULT))); avvisa(`Configurazione attuale: Airbnb +30% dal ${PARITA_LETTA_IL}`); }}>Torna alla configurazione attuale</button>
          <button className="ctl" onClick={fissaBase}>Fissa come punto di partenza</button>
          <button className="btn-brand" onClick={salva} disabled={!srv.attivo || !sporco} title={srv.attivo ? '' : 'Archivio sul server non configurato'}>{sporco ? 'Salva' : 'Salvata'}</button>
          <button className="ctl" onClick={salvaConNome} disabled={!srv.attivo}>Salva con nome</button>
        </div>
      </div>
      <div className="text-xs mb-3 flex flex-wrap gap-2 items-center" style={{ color: 'var(--text-dim)' }}>
        {srv.stato === 'carico' ? 'Carico le configurazioni dal server…'
          : !srv.attivo ? <span className="pill yellow">Archivio sul server non configurato: le modifiche restano solo in questo browser</span>
          : <>Sul server{srv.dati?.aggiornato ? `, ultima modifica ${new Date(srv.dati.aggiornato).toLocaleString('it-IT')}` : ''}{sporco && <span className="pill yellow">modifiche non salvate</span>}</>}
        {(srv.dati?.salvate || []).map((x) => (
          <span key={x.nome} className="pill gray" style={{ display: 'inline-flex', gap: 6 }}>
            <button onClick={() => { aggiorna((s) => Object.assign(s, espandi(x.stato, PARITA_DEFAULT))); avvisa(`Caricata «${x.nome}»`); }} style={{ textDecoration: 'underline' }}>{x.nome}</button>
            <span>{x.il?.split('-').reverse().join('/')}</span>
            <button onClick={() => togli(x.nome)} aria-label={`Togli ${x.nome}`}>×</button>
          </span>
        ))}
        {msg && <span className="pill brand">{msg}</span>}
      </div>

      {/* Casa e soggiorno */}
      <div className="flex flex-wrap gap-2 mb-3">
        {PARITA_ORDER.map((h) => (
          <button key={h} className={`ctl ${h === S.house ? 'font-semibold' : ''}`} style={h === S.house ? { borderColor: 'var(--brand)', background: 'var(--raised)' } : undefined}
            onClick={() => aggiorna((s) => { s.house = h; s.price = null; s.stay = Math.max(1, Math.round(PARITA_HOUSES[h].los)); })}>{PARITA_HOUSES[h].name}</button>
        ))}
      </div>
      <div className="text-xs mb-3 flex flex-wrap gap-4" style={{ color: 'var(--text-dim)' }}>
        <span>Pulizie <strong>{fmtEur(H.cleaning)}</strong></span><span>Soggiorno medio <strong>{nf1.format(H.los)} notti</strong></span><span>Prezzo medio PriceLabs <strong>{fmtEur(H.price.media)}</strong></span>
      </div>
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Campo label="Prezzo PriceLabs di partenza">
          <select className="ctl w-full" value={S.price > 0 ? 'manuale' : S.season} onChange={(e) => aggiorna((s) => { if (e.target.value === 'manuale') s.price = Math.round(curPrice(s)); else { s.season = e.target.value; s.price = null; } })}>
            <option value="media">Media dei prossimi 12 mesi</option><option value="bassa">Bassa stagione (gen–feb)</option><option value="alta">Alta stagione (apr–giu)</option><option value="manuale">Scritto a mano</option>
          </select>
        </Campo>
        <Campo label="Prezzo a notte (€)"><Num value={Math.round(price)} min={1} onChange={(v) => aggiorna((s) => { s.price = v > 0 ? v : null; })} /></Campo>
        <Campo label="Notti del soggiorno"><Num value={S.stay} min={1} step={1} onChange={(v) => aggiorna((s) => { s.stay = Math.max(1, Math.round(v) || 1); })} /></Campo>
        <Campo label="Obiettivo di incasso">
          <select className="ctl w-full" value={S.target.mode} onChange={(e) => { const prima = T; aggiorna((s) => { s.target.mode = e.target.value; if (e.target.value === 'fixed') s.target.pct = Math.round(prima * 2) / 2 || s.target.pct; }); }}>
            <option value="booking">Uguale a Booking.com</option><option value="airbnb">Uguale ad Airbnb</option><option value="direct">Uguale al diretto</option><option value="fixed">Un valore fisso</option>
          </select>
        </Campo>
        {S.target.mode === 'fixed' && <Campo label="Incasso obiettivo su 100 € di PriceLabs"><Num value={S.target.pct} step={0.5} onChange={(v) => aggiorna((s) => { s.target.pct = v; })} /></Campo>}
      </div>

      {/* Risultato per portale */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {S.channels.map((ch) => {
          const r = R[ch.id], df = r.p100 - T, isRef = S.target.mode === ch.id;
          return (
            <div key={ch.id} className="panel" style={{ boxShadow: 'none' }}>
              <div className="flex justify-between items-center gap-2 mb-2"><span className="inline-flex gap-2 items-center font-semibold"><Dot id={ch.id} />{ch.name}</span><Stato diff={df} isRef={isRef} diretto={ch.id === 'direct'} /></div>
              <div className="kpi-value">{fmtEur(r.net)} <span className="text-xs font-normal" style={{ color: 'var(--text-dim)' }}>a notte, a te</span></div>
              <div className="text-xs mt-1 mb-2" style={{ color: 'var(--text-dim)' }}>8 ospiti su 10 tra {fmtEur(r.q.p10)} e {fmtEur(r.q.p90)}</div>
              <table className="w-full text-xs"><tbody>
                <tr><td>Su 100 € di PriceLabs (alloggio)</td><td className="num">{nf1.format(r.p100)}</td></tr>
                <tr><td>L'ospite paga a notte</td><td className="num">{fmtEur(r.guest)}</td></tr>
                <tr><td>Sconti in media</td><td className="num">−{pct1((1 - r.Ef) * 100)}</td></tr>
                <tr><td>Ricarico · commissione</td><td className="num">{pct1(ch.markup)} · {pct1(comm[ch.id])}</td></tr>
              </tbody></table>
            </div>
          );
        })}
      </div>

      {/* Allineamento */}
      <Sotto titolo="Allineamento dei portali" nota="Quanto incassi su ogni 100 € di prezzo PriceLabs (solo alloggio) e che ricarico servirebbe per arrivare all'obiettivo con gli sconti di oggi." />
      <div className="overflow-x-auto mb-2">
        <table className="w-full text-sm">
          <thead><tr><th>Portale</th><th className="num">Su 100 € ora</th><th className="num">Obiettivo</th><th className="num">Scarto</th><th className="num">Ricarico ora</th><th className="num">Ricarico per l'obiettivo</th><th className="num">Ospite a notte</th><th className="num">vs Booking</th><th></th></tr></thead>
          <tbody>
            {S.channels.map((ch) => {
              const r = R[ch.id], need = markupForTarget(ch, comm[ch.id], T), df = r.p100 - T, g = (r.guest / b.guest - 1) * 100;
              const same = Math.abs(need - ch.markup) < 0.05;
              return (
                <tr key={ch.id}>
                  <td><span className="inline-flex gap-2 items-center"><Dot id={ch.id} />{ch.name}</span></td>
                  <td className="num">{nf1.format(r.p100)}</td><td className="num">{nf1.format(T)}</td>
                  <td className="num" style={{ color: df < -1.5 ? 'var(--red)' : df > 1.5 ? undefined : 'var(--green)' }}>{sgn1(df)}</td>
                  <td className="num">{pct1(ch.markup)}</td><td className="num"><strong>{Number.isFinite(need) ? pct1(need) : '—'}</strong></td>
                  <td className="num">{fmtEur(r.guest)}</td><td className="num">{ch.id === 'booking' ? '—' : (g > 0 ? '+' : '−') + nf1.format(Math.abs(g)) + '%'}</td>
                  <td className="num">{same || !Number.isFinite(need) ? '' : <button className="ctl" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => { aggiorna((s) => { chan(s, ch.id).markup = Math.round(need * 10) / 10; }); avvisa(`Ricarico ${ch.name} simulato al ${nf1.format(need)}%`); }}>Prova questo ricarico</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="note mb-2">
        Per la stessa notte ({H.name}, {fmtEur(price)} di PriceLabs, {n} {n === 1 ? 'notte' : 'notti'}) l'ospite paga in media <strong>{fmtEur(a.guest)}</strong> su Airbnb, <strong>{fmtEur(b.guest)}</strong> su Booking.com e <strong>{fmtEur(d.guest)}</strong> sul diretto. Il più conveniente per l'ospite è {cheap[1]}.
        {d.guest > Math.min(a.guest, b.guest) && <> <strong>Il diretto costa più di un portale:</strong> chi confronta i prezzi non ha motivo di prenotare da voi.</>} I ricarichi si cambiano in Guesty (Prezzi → Ricarico/Riduzione): qui è solo una simulazione.
      </div>
      {best && <button className="ctl mb-4" onClick={() => aggiorna((s) => { const it = chan(s, 'airbnb').groups.find((g) => g.id === 'best').items[0]; it.on = !it.on; })}>{best.on ? 'Simula «Best Airbnb Guests» spenta' : 'Riaccendi «Best Airbnb Guests»'}</button>}

      {/* Le leve */}
      <Sotto titolo="Le leve: ricarichi, commissioni e sconti" nota="«Quanti» è la quota di ospiti che riceve lo sconto. Dentro lo stesso gruppo ne scatta al massimo uno. Togli la spunta per simulare lo sconto spento." />
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {S.channels.map((ch) => (
          <div key={ch.id} className="panel" style={{ boxShadow: 'none', display: 'grid', gap: 10 }}>
            <span className="inline-flex gap-2 items-center font-semibold"><Dot id={ch.id} />{ch.name}</span>
            <div className="grid grid-cols-2 gap-2">
              <Campo label="Ricarico di Guesty (%)"><Num value={ch.markup} step={0.5} onChange={(v) => aggiorna((s) => { chan(s, ch.id).markup = v; })} /></Campo>
              <Campo label={`${COMM_LABEL[ch.id]} · ${H.name} (%)`}><Num value={comm[ch.id]} step={0.1} onChange={(v) => aggiorna((s) => { s.houses[s.house].comm[ch.id] = v; })} /></Campo>
            </div>
            {ch.groups.map((g) => (
              <div key={g.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'grid', gap: 6 }}>
                <div className="flex justify-between text-xs" style={{ color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.6px' }}><span>{g.label}</span>{g.items.length > 1 && <span style={{ textTransform: 'none', letterSpacing: 0 }}>al massimo uno</span>}</div>
                {g.items.map((it) => (
                  <div key={it.id} className="grid items-center gap-2" style={{ gridTemplateColumns: 'auto 1fr 70px 70px', opacity: it.on ? 1 : 0.55 }}>
                    <input type="checkbox" checked={it.on} aria-label={`${it.name} attivo`} onChange={(e) => aggiorna((s) => { chan(s, ch.id).groups.find((x) => x.id === g.id).items.find((x) => x.id === it.id).on = e.target.checked; })} />
                    <span className="text-sm" style={{ textDecoration: it.on ? 'none' : 'line-through' }}>{it.name}<span className="block text-xs" style={{ color: 'var(--text-dim)' }}>{it.src}</span></span>
                    <Num value={it.pct} step={0.5} min={0} aria={`Sconto ${it.name} in percentuale`} onChange={(v) => aggiorna((s) => { chan(s, ch.id).groups.find((x) => x.id === g.id).items.find((x) => x.id === it.id).pct = Math.max(0, v); })} />
                    <Num value={it.prob} step={1} min={0} aria={`Quota di ospiti con ${it.name}`} onChange={(v) => aggiorna((s) => { chan(s, ch.id).groups.find((x) => x.id === g.id).items.find((x) => x.id === it.id).prob = Math.min(100, Math.max(0, v)); })} />
                  </div>
                ))}
              </div>
            ))}
            {ch.sponsor && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'grid', gap: 6 }}>
                <div className="flex justify-between text-xs" style={{ color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.6px' }}><span>Pagato da Booking</span><span style={{ textTransform: 'none', letterSpacing: 0 }}>cambia solo il prezzo per l'ospite</span></div>
                <div className="grid items-center gap-2" style={{ gridTemplateColumns: 'auto 1fr 70px 70px' }}>
                  <span style={{ width: 13 }} /><span className="text-sm">Booking Sponsored Benefit<span className="block text-xs" style={{ color: 'var(--text-dim)' }}>36 su 55 · media 8,2%</span></span>
                  <Num value={ch.sponsor.pct} step={0.1} aria="Sconto pagato da Booking in percentuale" onChange={(v) => aggiorna((s) => { chan(s, ch.id).sponsor.pct = v; })} />
                  <Num value={ch.sponsor.prob} step={1} aria="Quota di ospiti con sconto pagato da Booking" onChange={(v) => aggiorna((s) => { chan(s, ch.id).sponsor.prob = v; })} />
                </div>
              </div>
            )}
            <div className="grid text-xs" style={{ gridTemplateColumns: 'auto 1fr 70px 70px', gap: 8, color: 'var(--text-dim)' }}><span /><span /><span className="text-center">%</span><span className="text-center">Quanti</span></div>
          </div>
        ))}
      </div>

      {/* Ospite per ospite */}
      <Sotto titolo="Cosa succede ospite per ospite" nota="Non tutti gli ospiti prendono tutti gli sconti: qui ogni combinazione con la sua frequenza, per la casa e il soggiorno scelti." />
      <div className="flex gap-2 mb-2">{S.channels.map((ch) => <button key={ch.id} className="ctl" style={ch.id === distTab ? { borderColor: COLORE[ch.id], boxShadow: `inset 0 -2px 0 ${COLORE[ch.id]}` } : undefined} onClick={() => setDistTab(ch.id)}>{ch.name}</button>)}</div>
      <Distribuzione r={R[distTab]} ch={chan(S, distTab)} />

      {/* L'anno */}
      <Sotto titolo="Effetto sull'anno, tutte le case" nota="Notti degli ultimi 12 mesi per portale e prezzo medio PriceLabs dei prossimi 12 mesi, tutti modificabili. Quel prezzo medio comprende le date lontane, che PriceLabs tiene più care e poi abbassa: il netto assoluto esce più alto di quello vero (ultima colonna). Conta la differenza tra scenari, a volumi invariati." />
      <div className="note mb-2">
        {Math.abs(diff) < 50 ? <><strong>Nessuna differenza</strong> rispetto al punto di partenza ({fmtEur(base.tot)} l'anno di incasso netto su {nf0.format(nightsTot)} notti). Cambia una leva per vedere l'effetto.</>
          : diff > 0 ? <><strong>{sgnEur(diff)} l'anno</strong> rispetto al punto di partenza, a notti invariate ({fmtEur(cur.tot)} contro {fmtEur(base.tot)}). Resti in vantaggio finché non perdi più di <strong>{nf0.format(Math.floor(diff / avg))} notti l'anno</strong> su {nf0.format(nightsTot)} per effetto del cambio.</>
          : <><strong>{sgnEur(diff)} l'anno</strong> rispetto al punto di partenza, a notti invariate ({fmtEur(cur.tot)} contro {fmtEur(base.tot)}). Per andare in pari il cambio deve portare almeno <strong>{nf0.format(Math.ceil(-diff / avg))} notti in più l'anno</strong>.</>}
      </div>
      <button className="ctl mb-2" onClick={nottiDallaDashboard} title="Notti con check-in negli ultimi 365 giorni, da questa dashboard">Usa le notti vere degli ultimi 12 mesi</button>
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead><tr><th>Casa</th>{S.channels.map((ch) => <th key={ch.id} className="num">Notti {ch.name}</th>)}<th className="num">Prezzo medio PriceLabs</th><th className="num">Netto l'anno</th><th className="num">Partenza</th><th className="num">Differenza</th><th className="num">Netto vero, ultimi 12 mesi</th></tr></thead>
          <tbody>
            {PARITA_ORDER.map((h, i) => {
              const c = cur.rows[i].tot, bb = base.rows[i].tot, dd = c - bb;
              return (
                <tr key={h}>
                  <td>{PARITA_HOUSES[h].name}</td>
                  {S.channels.map((ch) => <td key={ch.id} className="num"><Num value={S.houses[h].nights[ch.id]} step={1} min={0} w={76} aria={`Notti ${ch.name} ${PARITA_HOUSES[h].name}`} onChange={(v) => aggiorna((s) => { s.houses[h].nights[ch.id] = Math.max(0, Math.round(v)); })} /></td>)}
                  <td className="num"><Num value={S.houses[h].yprice || PARITA_HOUSES[h].price.media} step={1} min={1} w={76} aria={`Prezzo medio PriceLabs ${PARITA_HOUSES[h].name}`} onChange={(v) => aggiorna((s) => { s.houses[h].yprice = Math.max(1, v); })} /></td>
                  <td className="num">{fmtEur(c)}</td><td className="num">{fmtEur(bb)}</td>
                  <td className="num" style={{ color: dd > 25 ? 'var(--green)' : dd < -25 ? 'var(--red)' : undefined }}>{Math.abs(dd) < 25 ? '—' : sgnEur(dd)}</td>
                  <td className="num">{fmtEur(PARITA_HOUSES[h].real)}</td>
                </tr>
              );
            })}
            <tr>
              <td><strong>Totale</strong></td>
              {S.channels.map((ch) => <td key={ch.id} className="num"><strong>{nf0.format(PARITA_ORDER.reduce((s, h) => s + (S.houses[h].nights[ch.id] || 0), 0))}</strong></td>)}
              <td></td><td className="num"><strong>{fmtEur(cur.tot)}</strong></td><td className="num">{fmtEur(base.tot)}</td>
              <td className="num">{Math.abs(diff) < 25 ? '—' : sgnEur(diff)}</td><td className="num">{fmtEur(PARITA_ORDER.reduce((s, h) => s + PARITA_HOUSES[h].real, 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Sotto titolo="Quanto costa ogni sconto in un anno" nota="Incasso netto che recupereresti spegnendolo, se le notti restassero le stesse. Non dice quante prenotazioni porta: per quello serve una prova sul campo." />
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead><tr><th>Portale</th><th>Sconto</th><th className="num">Sconto</th><th className="num">Ospiti</th><th className="num">Costo l'anno</th></tr></thead>
          <tbody>
            {costi.map((r) => (
              <tr key={r.ch.id + r.it.id + r.it.name}><td><span className="inline-flex gap-2 items-center"><Dot id={r.ch.id} />{r.ch.name}</span></td><td>{r.it.name}</td><td className="num">{pct1(r.it.pct)}</td><td className="num">{pct1(r.it.prob)}</td><td className="num">{fmtEur(r.cost)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>Portali minori esclusi: {nf0.format(PARITA_ORDER.reduce((s, h) => s + PARITA_HOUSES[h].other, 0))} notti negli ultimi 12 mesi.</div>
      </div>

      <Sotto titolo="Controllo sulle prenotazioni vere" nota="Le stesse formule, applicate a prenotazioni lette su Airbnb, Guesty e Booking. Lo scarto è sui centesimi arrotondati." />
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead><tr><th>Prenotazione</th><th>Calcolo</th><th>Voce</th><th className="num">Modello</th><th className="num">Reale</th><th className="num">Scarto</th></tr></thead>
          <tbody>
            {ver.map((r) => (
              <tr key={r.code}>
                <td><span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.code}</span><br /><span className="text-xs" style={{ color: 'var(--text-dim)' }}>{r.what}</span></td>
                <td>{r.how}</td><td>{r.lab}</td>
                <td className="num">{fmtEurDecimal(r.model)}</td><td className="num">{fmtEurDecimal(r.real)}</td>
                <td className="num">{fmtEurDecimal(r.scarto)} {r.scarto <= 0.01 ? <span className="pill green">ok</span> : <span className="pill red">fuori</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold" style={{ color: 'var(--brand-dark)' }}>Come funziona e da dove vengono i numeri</summary>
        <div className="mt-2" style={{ display: 'grid', gap: 8, color: 'var(--text-dim)', maxWidth: '85ch' }}>
          <p><strong>Il calcolo.</strong> Tariffa piena sul portale = prezzo PriceLabs × (1 + ricarico di Guesty). Ogni sconto toglie la sua percentuale da quello che resta: 15% e poi 10% fanno 23,5%, non 25%. La commissione si calcola su alloggio + pulizie. Lo sconto pagato da Booking abbassa il prezzo per l'ospite ma non il tuo incasso. Si calcolano tutte le combinazioni di sconti con la loro probabilità e se ne fa la media. Il ricarico per l'obiettivo = obiettivo ÷ (sconto medio × (1 − commissione)) − 1, sul solo alloggio.</p>
          <p><strong>Le fonti (lette il {PARITA_LETTA_IL}).</strong> Airbnb: 34 prenotazioni di Prestige, scheda «Guadagni»; le altre 4 case sono su un altro account Airbnb, frequenze di Prestige applicate anche a loro. Booking: 55 prenotazioni dal 24/08 al 19/11/2026, dettaglio nell'extranet. Commissioni: Airbnb 15,5% su Prestige e 18,91% sulle altre; Booking 24,5% su Poliziano, Bilocale e Trilocale, 19,5% su Marco Aurelio e Prestige. Prezzi PriceLabs: media dal 20/11/2026 al 19/11/2027. Notti per portale: questa dashboard, check-in dal 19/11/2025 al 18/11/2026. Ricarichi e sconti: Guesty; Airbnb +30% dal {PARITA_LETTA_IL} (scrivi 15,5 per rivedere com'era prima).</p>
          <p><strong>Cosa il modello non sa.</strong> Quante prenotazioni porta o toglie uno sconto: i confronti sono a volumi invariati. «Ospiti con le valutazioni migliori» esiste dal 10/11/2026: la quota del 75% viene da pochissime prenotazioni. Genius cambia da prenotazione a prenotazione (11–28%): qui c'è la media pesata. Persone aggiuntive, tassa di soggiorno e portali minori non sono nel calcolo; sul diretto le frequenze degli sconti non sono misurate.</p>
          <p><strong>Dove sta.</strong> Formule in lib/parita.js, dati di partenza in config/parita.js, configurazioni salvate sul server (/api/canali/config). L'artifact «Parità OTA Colosseum» resta come copia: se si cambia una formula, va cambiata in tutti e due.</p>
        </div>
      </details>
    </div>
  );
}

function Distribuzione({ r, ch }) {
  const outs = r.outs.slice().sort((x, y) => y.p - x.p);
  const shown = outs.filter((o) => o.p >= 0.005).slice(0, 14);
  const rest = outs.length - shown.length, restP = outs.slice(shown.length).reduce((s, o) => s + o.p, 0);
  const maxP = shown.length ? shown[0].p : 1;
  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm">
        <thead><tr><th>Sconti applicati</th><th className="num">Ospiti</th><th style={{ width: '22%' }}></th><th className="num">Ospite a notte</th><th className="num">A te a notte</th><th className="num">Su 100 €</th></tr></thead>
        <tbody>
          {shown.map((o, i) => (
            <tr key={i}>
              <td>{o.names.length ? o.names.join(' + ') : 'Nessuno sconto'}</td><td className="num">{pct1(o.p * 100)}</td>
              <td><div style={{ height: 8, borderRadius: 4, background: COLORE[ch.id], width: `${Math.max(2, (o.p / maxP) * 100)}%` }} /></td>
              <td className="num">{fmtEur(o.guest)}</td><td className="num">{fmtEur(o.net)}</td><td className="num">{nf1.format(o.p100)}</td>
            </tr>
          ))}
          <tr>
            <td><strong>Media pesata</strong>{rest > 0 && <span style={{ color: 'var(--text-dim)' }}> · altre {rest} combinazioni rare ({pct1(restP * 100)} degli ospiti)</span>}</td>
            <td className="num">100%</td><td></td><td className="num">{fmtEur(r.guestList)}</td><td className="num"><strong>{fmtEur(r.net)}</strong></td><td className="num">{nf1.format(r.p100)}</td>
          </tr>
          {ch.sponsor && <tr><td colSpan={6} className="text-xs" style={{ color: 'var(--text-dim)' }}>Il prezzo per l'ospite qui è prima dello sconto pagato da Booking: con quello, in media {fmtEur(r.guest)} a notte. Il tuo incasso non cambia.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Stato({ diff, isRef, diretto }) {
  if (isRef) return <span className="pill brand">Riferimento</span>;
  if (Math.abs(diff) < 1.5) return <span className="pill green">In linea</span>;
  // Il diretto sopra l'obiettivo e' quello che si vuole: non e' un avviso.
  if (diretto && diff > 0) return <span className="pill green">{sgn1(diff)} sopra l'obiettivo</span>;
  const fuori = diretto ? diff < -PARITA_SOGLIE.puntiObiettivo : Math.abs(diff) > PARITA_SOGLIE.puntiObiettivo;
  return <span className={`pill ${fuori ? 'red' : 'yellow'}`}>{sgn1(diff)} {diff < 0 ? "sotto l'obiettivo" : "sopra l'obiettivo"}</span>;
}

function Sotto({ titolo, nota }) {
  return (
    <div className="mb-2 mt-2">
      <h4 className="text-sm font-semibold" style={{ color: 'var(--brand-dark)' }}>{titolo}</h4>
      {nota && <p className="text-xs" style={{ color: 'var(--text-dim)', maxWidth: '85ch' }}>{nota}</p>}
    </div>
  );
}

function Campo({ label, children }) {
  return <label className="text-xs" style={{ display: 'grid', gap: 4, color: 'var(--text-dim)' }}>{label}{children}</label>;
}

// Un campo numerico che lascia scrivere (anche «1,» o vuoto) e passa il valore
// solo quando e' un numero. Se il valore cambia da fuori, si aggiorna.
function Num({ value, onChange, step = 1, min, w, aria }) {
  const [t, setT] = useState(String(value ?? ''));
  const focus = useRef(false);
  useEffect(() => { if (!focus.current) setT(String(value ?? '')); }, [value]);
  return (
    <input className="ctl" style={{ width: w || '100%', padding: '4px 8px', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}
      type="text" inputMode="decimal" value={t} aria-label={aria} step={step} min={min}
      onFocus={() => { focus.current = true; }}
      onBlur={() => { focus.current = false; setT(String(value ?? '')); }}
      onChange={(e) => {
        setT(e.target.value);
        const v = parseFloat(e.target.value.replace(',', '.'));
        if (Number.isFinite(v)) onChange(v);
      }} />
  );
}
