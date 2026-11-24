// Chekin (registrazione ospiti, documenti, invio alla Questura) — sola lettura.
//
// La chiave e' CHEKIN_API_KEY (solo Production, la mette Alberto su Vercel,
// 20/11/2026). Documentazione pubblica: https://chekin.gitbook.io/chekin-public-api
// (letta il 20/11/2026):
//   - indirizzo base https://a.chekin.io/public/api/v1
//   - POST /auth/api-key/ con { api_key } → { token }, dura 1 ora
//   - intestazione «Authorization: JWT <token>»
//   - GET /housings, GET /reservations?checkin_date_from=…&page_size=…,
//     GET /reservations/{id}, GET /guests/?guest_group_id=…
//   - limiti: 300 richieste al minuto sulle prenotazioni, 200 sulle case.
// La prima prova (20/11/2026, 13:12 UTC) su /api/v3 non entrava: li' /token/
// vuole email e password, non la chiave.
//
// REGOLA: niente dati personali fuori da questo file. Di ogni oggetto si
// restituiscono i NOMI dei campi e i valori solo dei campi «sicuri» (stati,
// date, conteggi, identificativi; numeri e si'/no di campi non vietati),
// mai nomi, email, telefoni, documenti.

export const CHEKIN_BASE = 'https://a.chekin.io/public/api/v1';

// Campi di cui si puo' mostrare il valore.
const SICURO = /(^id$|_id$|^ids?$|status|state|count|number_of|^nights?_of_stay$|check_in_date|check_out_date|^created_at$|^source$|^origin$|booking_reference|external_id|^code$|^type$|^is_|^has_|police|stat_|tax|paid|complete|verified|ocr_passed|guestapp_status|^language$)/i;
// Campi da non mostrare mai, anche se il nome sembra sicuro.
const VIETATO = /(name|surname|email|phone|document|birth|address|nationality|residence|signature|photo|selfie|face|link|url|token|iban|card)/i;

const sicuro = (k) => SICURO.test(k) && !VIETATO.test(k);

function forma(v, prof = 0) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.length ? [forma(v[0], prof + 1), `(${v.length} elementi)`] : [];
  if (typeof v === 'object') {
    if (prof > 7) return '{…}';
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sicuro(k) ? (typeof x === 'object' && x !== null ? forma(x, prof + 1) : x) : (typeof x === 'object' && x !== null && !VIETATO.test(k) ? forma(x, prof + 1) : ((typeof x === 'number' || typeof x === 'boolean') && !VIETATO.test(k) ? x : `‹${typeof x}›`))]));
  }
  return `‹${typeof v}›`;
}

async function chiama(fetchImpl, url, init = {}) {
  try {
    const r = await fetchImpl(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    const testo = await r.text();
    let json = null; try { json = JSON.parse(testo); } catch {}
    return { status: r.status, json, lungo: testo.length };
  } catch (e) {
    return { status: 0, errore: e.message };
  }
}

const AUTH_PERCORSI = ['/auth/api-key/', '/auth/api-key'];

/** Trova come ottenere il token: ritorna { percorso, token, prove }. */
export async function ottieniToken({ key, fetchImpl = fetch, base = CHEKIN_BASE }) {
  const prove = [];
  for (const p of AUTH_PERCORSI) {
    const r = await chiama(fetchImpl, base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key }) });
    const token = r.json && (r.json.token || r.json.access || r.json.access_token || r.json.jwt);
    prove.push({ percorso: p, status: r.status, campi: r.json && typeof r.json === 'object' ? Object.keys(r.json) : null });
    if (token) return { percorso: p, token, prove };
  }
  return { percorso: null, token: null, prove };
}

/** Trova il formato dell'intestazione: ritorna { schema, prove }. */
export async function trovaIntestazione({ token, fetchImpl = fetch, base = CHEKIN_BASE }) {
  const prove = [];
  for (const schema of ['JWT', 'Bearer']) {
    const r = await chiama(fetchImpl, base + '/housings/?page_size=1', { headers: { Authorization: `${schema} ${token}` } });
    prove.push({ schema, status: r.status });
    if (r.status >= 200 && r.status < 300) return { schema, prove };
  }
  return { schema: null, prove };
}

/**
 * La prova: autenticazione, elenco degli indirizzi dello swagger, case,
 * prenotazioni con arrivo nei prossimi 7 giorni, un ospite. Solo struttura.
 */
export async function provaChekin({ key, fetchImpl = fetch, base = CHEKIN_BASE, oggi = new Date() }) {
  const out = { letto_alle: oggi.toISOString(), base };
  const t = await ottieniToken({ key, fetchImpl, base });
  out.autenticazione = { percorso: t.percorso, prove: t.prove };
  if (!t.token) return out;
  const h = await trovaIntestazione({ token: t.token, fetchImpl, base });
  out.intestazione = h;
  if (!h.schema) return out;
  const get = (p) => chiama(fetchImpl, base + p, { headers: { Authorization: `${h.schema} ${t.token}`, Accept: 'application/json' } });

  const case_ = await get('/housings/?page_size=20');
  out.case = { status: case_.status, forma: forma(case_.json) };
  if (case_.json) {
    const lista = case_.json.results || (Array.isArray(case_.json) ? case_.json : []);
    // Il nome della casa non e' un dato personale: serve per collegarla.
    out.case.elenco = lista.map((c) => ({ id: c.id, name: c.name, external_id: c.external_id ?? null }));
  }

  const dal = oggi.toISOString().slice(0, 10);
  const d = new Date(oggi); d.setUTCDate(d.getUTCDate() + 7);
  const al = d.toISOString().slice(0, 10);
  // Chekin filtra solo «dal»: il «fino a» si applica qui.
  const pren = await get(`/reservations/?checkin_date_from=${dal}&page_size=100`);
  const tutte = pren.json ? (pren.json.results || (Array.isArray(pren.json) ? pren.json : [pren.json])) : [];
  const lista = tutte.filter((r) => r && r.check_in_date && r.check_in_date <= al);
  out.prenotazioni = {
    filtro: `${dal}..${al}`, status: pren.status, n_lette: tutte.length, n: lista.length,
    busta: pren.json && !Array.isArray(pren.json) ? Object.keys(pren.json) : null,
    forma: forma(lista[0] ?? null),
    // Solo stati e date: niente nomi.
    stati: lista.map((r) => ({ casa: r.housing_id, arrivo: r.check_in_date, partenza: r.check_out_date, origine: r.source ?? r.origin ?? null, generale: r.general_status ?? null, dettaglio: forma(r.detailed_statuses ?? null) })),
  };

  const conGruppo = lista.find((r) => r.guest_group && r.guest_group.id);
  if (conGruppo) {
    const r1 = await get(`/reservations/${conGruppo.id}/`);
    out.prenotazione_singola = { status: r1.status, forma: forma(r1.json) };
    const o = await get(`/guests/?guest_group_id=${conGruppo.guest_group.id}`);
    const ospiti = o.json ? (o.json.results || (Array.isArray(o.json) ? o.json : [o.json])) : [];
    out.ospiti = { status: o.status, n: ospiti.length, forma: forma(ospiti[0] ?? null) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Controllo degli arrivi (agente 8 «Arrivi e conformità», dal 20/11/2026).
//
// Cosa si sa dalla prova del 20/11/2026 (13:15 UTC, risposta vera):
//   - le 5 case hanno external_id = id dell'annuncio Guesty (origin GUESTY_2)
//   - una prenotazione ha check_in_date, check_out_date, booking_reference
//     (il codice di Guesty), external_id (id della prenotazione Guesty),
//     guest_group { known_number_of_guests, guest_ids[] } e detailed_statuses
//     con, fra gli altri: guests_registration_status, police_check_in_status
//     (Alloggiati Web), stat_check_in_status (ISTAT), tax_status (tassa di
//     soggiorno), general_status
//   - valori visti: COMPLETE, PENDING, ERROR, NOT_USED, EXCLUDED, NO_GUESTS
//   - il filtro checkin_date_from NON viene applicato: si leggono tutte le
//     prenotazioni di ogni casa (housing_id) pagina per pagina e si filtra qui.
// ---------------------------------------------------------------------------

// external_id della casa in Chekin (= annuncio Guesty) → sigla della casa.
export const CASE_CHEKIN = {
  '68547b2d31c44e00118ef676': 'MA',
  '685436cdb59e06001348e893': 'POL',
  '68ef9e55d590580010bbf7d6': 'PRE',
  '6854861b066d37001060d473': 'BIL',
  '68548615331bfe00134cf985': 'TRI',
};

const FATTO = new Set(['COMPLETE', 'NOT_USED', 'EXCLUDED']);
const piu = (giorno, n) => { const d = new Date(giorno + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const giornoRoma = (ora) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ora);

/** Tutte le prenotazioni di una casa, pagina per pagina (al massimo `maxPagine`). */
async function prenotazioniDellaCasa(get, housingId, maxPagine = 30) {
  const tutte = []; const avvisi = [];
  for (let pagina = 1; pagina <= maxPagine; pagina++) {
    const r = await get(`/reservations/?housing_id=${housingId}&page=${pagina}&page_size=50`);
    if (r.status === 404 && pagina > 1) break; // pagina oltre la fine
    if (r.status !== 200 || !r.json) { avvisi.push(`pagina ${pagina}: HTTP ${r.status}${r.errore ? ' ' + r.errore : ''}`); break; }
    const lista = r.json.results || (Array.isArray(r.json) ? r.json : []);
    const altre = lista.filter((x) => x.housing_id !== housingId).length;
    if (altre) avvisi.push(`pagina ${pagina}: ${altre} prenotazioni di altre case (filtro per casa non applicato)`);
    tutte.push(...lista.filter((x) => x.housing_id === housingId));
    if (!r.json.next || !lista.length) break;
    if (pagina === maxPagine) avvisi.push(`fermato a ${maxPagine} pagine`);
  }
  return { tutte, avvisi };
}

/**
 * Il controllo: arrivi dei prossimi 7 giorni e arrivi degli ultimi 30 giorni
 * ancora senza invio alla Questura. Restituisce solo codici, date, conteggi
 * e stati: niente nomi, email, telefoni, documenti.
 *
 * `guesty` (facoltativo) = { reservations, cancelled } dal payload della
 * dashboard, per sapere se una prenotazione e' confermata o cancellata.
 */
export async function controllaArrivi({ key, fetchImpl = fetch, base = CHEKIN_BASE, ora = new Date(), guesty = null }) {
  const oggi = giornoRoma(ora);
  const out = { letto_alle: ora.toISOString(), oggi, finestra_arrivi: `${oggi}..${piu(oggi, 7)}`, finestra_arretrati: `${piu(oggi, -30)}..${piu(oggi, -1)}`, avvisi: [] };

  const auth = await chiama(fetchImpl, base + '/auth/api-key/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key }) });
  const token = auth.json && auth.json.token;
  if (!token) { out.errore = `accesso a Chekin non riuscito (HTTP ${auth.status})`; return out; }
  const get = (p) => chiama(fetchImpl, base + p, { headers: { Authorization: `JWT ${token}`, Accept: 'application/json' } });

  const hs = await get('/housings/?page_size=50');
  const housings = hs.json ? (hs.json.results || []) : [];
  if (!housings.length) { out.errore = `case di Chekin non lette (HTTP ${hs.status})`; return out; }

  // Guesty: confermate per codice e per casa+date, cancellate per casa+date.
  const perCodice = new Map(); const perDate = new Map(); const cancellate = new Set();
  if (guesty) {
    for (const r of guesty.reservations || []) {
      if (r.confirmationCode) perCodice.set(r.confirmationCode, r);
      perDate.set(`${r.houseId}|${r.checkIn}|${r.checkOut}`, r);
    }
    for (const r of guesty.cancelled || []) cancellate.add(`${r.houseId}|${r.checkIn}|${r.checkOut}`);
  } else out.avvisi.push('dati Guesty non disponibili: non so quali prenotazioni sono cancellate');

  const righe = []; out.case = [];
  for (const h of housings) {
    const casa = CASE_CHEKIN[h.external_id] || `?${h.external_id || h.id}`;
    if (casa.startsWith('?')) out.avvisi.push(`casa di Chekin non riconosciuta: ${h.name || h.id}`);
    out.case.push({ casa, questura_attiva: !!h.is_police_registration_enabled, invio_automatico: !!h.is_auto_police_registration_enabled, istat_attivo: !!h.is_stat_registration_enabled, disattivata: !!h.is_deactivated });
    const { tutte, avvisi } = await prenotazioniDellaCasa(get, h.id);
    for (const a of avvisi) out.avvisi.push(`${casa}: ${a}`);
    out.case[out.case.length - 1].prenotazioni_lette = tutte.length;
    for (const r of tutte) {
      if (!r.check_in_date || r.check_in_date < piu(oggi, -30) || r.check_in_date > piu(oggi, 7)) continue;
      const s = r.detailed_statuses || {};
      const chiaveDate = `${casa}|${r.check_in_date}|${r.check_out_date}`;
      const g = perCodice.get(r.booking_reference) || perDate.get(chiaveDate) || null;
      const inGuesty = !guesty ? 'non controllato' : g ? (g.status || 'confermata') : cancellate.has(chiaveDate) ? 'cancellata' : 'non trovata';
      righe.push({
        casa, codice: r.booking_reference || g?.confirmationCode || null, canale: g?.channel ?? null,
        arrivo: r.check_in_date, partenza: r.check_out_date, in_guesty: inGuesty,
        ospiti_attesi: g?.persons ?? r.guest_group?.known_number_of_guests ?? null,
        ospiti_registrati: Array.isArray(r.guest_group?.guest_ids) ? r.guest_group.guest_ids.length : null,
        registrazione: s.guests_registration_status ?? null, questura: s.police_check_in_status ?? null,
        istat: s.stat_check_in_status ?? null, tassa: s.tax_status ?? null, generale: s.general_status ?? null,
      });
    }
  }
  righe.sort((a, b) => a.arrivo.localeCompare(b.arrivo) || a.casa.localeCompare(b.casa));

  // Esiti. Le cancellate in Guesty non contano.
  const vive = righe.filter((r) => r.in_guesty !== 'cancellata');
  out.allarmi = []; out.da_guardare = [];
  for (const r of vive) {
    const tag = `${r.casa} ${r.codice || '(senza codice)'} arrivo ${r.arrivo}`;
    const giorni = Math.round((new Date(r.arrivo + 'T12:00:00Z') - new Date(oggi + 'T12:00:00Z')) / 86400000);
    if (giorni < 0) {
      // Gia' arrivati: la Questura va avvisata entro 24 ore dall'arrivo.
      if (!FATTO.has(r.questura)) out.allarmi.push(`${tag}: Questura (Alloggiati Web) «${r.questura}»`);
      if (!FATTO.has(r.istat)) out.da_guardare.push(`${tag}: ISTAT «${r.istat}»`);
      if (r.tassa && !FATTO.has(r.tassa)) out.da_guardare.push(`${tag}: tassa di soggiorno «${r.tassa}»`);
    } else if (giorni <= 1) {
      if (!FATTO.has(r.registrazione)) out.da_guardare.push(`${tag}: ospiti registrati ${r.ospiti_registrati ?? '?'} su ${r.ospiti_attesi ?? '?'} (registrazione «${r.registrazione}»)`);
    }
    if (r.questura === 'ERROR' && giorni >= 0) out.allarmi.push(`${tag}: Questura «ERROR»`);
    if (r.in_guesty === 'non trovata') out.da_guardare.push(`${tag}: in Chekin ma non fra le confermate di Guesty`);
  }
  // Confermate in Guesty nei prossimi 7 giorni che Chekin non ha.
  if (guesty) {
    const inChekin = new Set(righe.map((r) => `${r.casa}|${r.arrivo}|${r.partenza}`));
    const codiciChekin = new Set(righe.map((r) => r.codice).filter(Boolean));
    for (const g of guesty.reservations || []) {
      if (g.checkIn < oggi || g.checkIn > piu(oggi, 7)) continue;
      if (codiciChekin.has(g.confirmationCode) || inChekin.has(`${g.houseId}|${g.checkIn}|${g.checkOut}`)) continue;
      out.da_guardare.push(`${g.houseId} ${g.confirmationCode || '(senza codice)'} arrivo ${g.checkIn}: confermata in Guesty ma non in Chekin`);
    }
  }
  out.arrivi = vive.filter((r) => r.arrivo >= oggi);
  out.arretrati = vive.filter((r) => r.arrivo < oggi && (!FATTO.has(r.questura) || !FATTO.has(r.istat) || (r.tassa && !FATTO.has(r.tassa))));
  out.conteggi = { righe: righe.length, cancellate_in_guesty: righe.length - vive.length, arrivi: out.arrivi.length, arretrati: out.arretrati.length, allarmi: out.allarmi.length, da_guardare: out.da_guardare.length };
  return out;
}
