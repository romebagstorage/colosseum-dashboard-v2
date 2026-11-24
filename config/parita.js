// ============================================================================
// PARITÀ OTA — i dati di partenza del simulatore della scheda «Canali».
//
// Sono gli stessi dell'artifact «Parità OTA Colosseum»
// (https://claude.ai/artifact/1RVYJMk92HFC9LJ98HaH5j), letti il 19/11/2026:
//   - ricarichi e sconti: Guesty (Prezzi → Ricarico/Riduzione; Marketing e
//     vendite → Promozioni). Airbnb +30% dal 19/11/2026 pomeriggio (prima 15,5%);
//     diretto 0% dal 19/11/2026 pomeriggio, messo da Alberto (prima +5%);
//   - frequenze degli sconti Airbnb: 34 prenotazioni di Prestige, scheda
//     «Guadagni»; Booking: 55 prenotazioni dal 24/08 al 19/11/2026, extranet;
//   - commissioni: Airbnb 15,5% su Prestige, 18,91% (15,5% + IVA) sulle altre;
//     Booking 24,5% su Poliziano, Bilocale e Trilocale, 19,5% su Marco Aurelio
//     e Prestige;
//   - prezzi PriceLabs: medie dal 20/11/2026 al 19/11/2027;
//   - notti per portale: questa dashboard, check-in 19/11/2025 → 18/11/2026
//     («diretto» = Diretto + OFFLINE + Partner);
//   - soggiorni lunghi (aggiunti la sera del 19/11/2026, su indicazione di
//     Alberto): in Guesty «Tariffa settimanale» −10%, «Settimanale - Non
//     rimborsabile» −15%, «Tariffa Mensile» −25% (rimborso fino a 30 giorni
//     prima), «Mensile-Non rimborsabile» −30%; valgono anche per il diretto
//     (preventivo dal sito per Marco Aurelio 01/02–01/03/2027). Su Airbnb il
//     mensile e' −25% (Alberto). Nessun soggiorno da 28 notti o piu' nella
//     dashboard, 2025–2027: quota 0, si puo' provare a mano.
// Quando un dato cambia davvero (un ricarico in Guesty, una commissione) si
// cambia qui, non solo nella configurazione salvata: questa è la «configurazione
// attuale» a cui riporta il pulsante.
// ============================================================================

export const PARITA_LETTA_IL = '19/11/2026';

// Per casa: prezzo PriceLabs medio e per stagione, pulizie, soggiorno medio,
// notti sui portali minori (ultimi 12 mesi) e netto vero degli ultimi 12 mesi.
export const PARITA_HOUSES = {
  MA:  { name: 'Marco Aurelio', price: { media: 349, bassa: 229, alta: 424 }, cleaning: 45, los: 3.18, other: 46, real: 68550 },
  POL: { name: 'Poliziano',     price: { media: 531, bassa: 343, alta: 654 }, cleaning: 90, los: 2.91, other: 23, real: 115173 },
  PRE: { name: 'Prestige',      price: { media: 531, bassa: 343, alta: 654 }, cleaning: 90, los: 3.02, other: 11, real: 111841 },
  BIL: { name: 'Bilocale',      price: { media: 270, bassa: 172, alta: 337 }, cleaning: 40, los: 3.11, other: 28, real: 58051 },
  TRI: { name: 'Trilocale',     price: { media: 362, bassa: 251, alta: 426 }, cleaning: 50, los: 2.97, other: 29, real: 78282 },
};
export const PARITA_ORDER = ['MA', 'POL', 'PRE', 'BIL', 'TRI'];

export const PARITA_DEFAULT = {
  house: 'MA', season: 'media', price: null, stay: 3,
  target: { mode: 'booking', pct: 85 },
  houses: {
    MA:  { comm: { airbnb: 18.91, booking: 19.5, direct: 0 }, nights: { airbnb: 176, booking: 108, direct: 13 }, yprice: 349 },
    POL: { comm: { airbnb: 18.91, booking: 24.5, direct: 0 }, nights: { airbnb: 119, booking: 173, direct: 11 }, yprice: 531 },
    PRE: { comm: { airbnb: 15.5,  booking: 19.5, direct: 0 }, nights: { airbnb: 259, booking: 19,  direct: 22 }, yprice: 531 },
    BIL: { comm: { airbnb: 18.91, booking: 24.5, direct: 0 }, nights: { airbnb: 82,  booking: 199, direct: 27 }, yprice: 270 },
    TRI: { comm: { airbnb: 18.91, booking: 24.5, direct: 0 }, nights: { airbnb: 105, booking: 192, direct: 21 }, yprice: 362 },
  },
  channels: [
    { id: 'airbnb', name: 'Airbnb', markup: 30, sponsor: null, groups: [
      { id: 'best', label: 'Ospiti migliori', items: [{ id: 'best', name: 'Best Airbnb Guests', pct: 15, prob: 75, on: true, src: 'dal 10/11 · campione piccolo' }] },
      { id: 'mob', label: 'Da app', items: [{ id: 'mob', name: 'Sconto mobile', pct: 10, prob: 87, on: true, src: '20 su 23 (Prestige)' }] },
      { id: 'lead', label: 'Anticipo', items: [
        { id: 'lm', name: 'Last minute (entro 7 giorni)', pct: 5, prob: 24, on: true, src: '4 su 17' },
        { id: 'eb', name: 'Early bird (da 120 giorni)', pct: 5, prob: 10, on: true, src: 'stima: 5 su 34, quasi tutte vecchie' }] },
      { id: 'los', label: 'Durata', items: [
        { id: 'wk', name: 'Settimanale (da 7 notti)', pct: 10, prob: 2, on: true, src: '4 soggiorni su 256 in 12 mesi (1,6%) · sconto 10% dal 10/11' },
        { id: 'mo', name: 'Mensile (da 28 notti)', pct: 25, prob: 0, on: true, src: '0 su 256 negli ultimi 12 mesi' }] },
    ] },
    { id: 'booking', name: 'Booking.com', markup: 50, sponsor: { pct: 8.2, prob: 65 }, groups: [
      { id: 'gen', label: 'Genius', items: [{ id: 'gen', name: 'Genius (fisso o dinamico)', pct: 19, prob: 100, on: true, src: '55 su 55 · dal 10 al 28%' }] },
      { id: 'mob', label: 'Da app', items: [{ id: 'mob', name: 'Sconto mobile', pct: 10, prob: 69, on: true, src: '38 su 55' }] },
      { id: 'lead', label: 'Anticipo', items: [
        { id: 'lm', name: 'Last minute', pct: 5, prob: 18, on: true, src: '10 su 55' },
        { id: 'eb', name: 'Early bird', pct: 5, prob: 9, on: true, src: '5 su 55' }] },
      { id: 'plan', label: 'Piano tariffario', items: [
        { id: 'nr', name: 'Non rimborsabile', pct: 5, prob: 13, on: true, src: '7 su 55' },
        { id: 'wk', name: 'Settimanale', pct: 10, prob: 4, on: true, src: '2 su 55' },
        { id: 'wknr', name: 'Settimanale non rimborsabile', pct: 15, prob: 2, on: true, src: '1 su 55' },
        { id: 'mo', name: 'Mensile', pct: 25, prob: 0, on: true, src: 'Guesty «Tariffa Mensile» · 0 su 218 in 12 mesi' },
        { id: 'monr', name: 'Mensile non rimborsabile', pct: 30, prob: 0, on: true, src: 'Guesty · 0 su 218 in 12 mesi' }] },
      { id: 'deal', label: 'Altre offerte', items: [
        { id: 'country', name: 'Tariffa per paese', pct: 5, prob: 2, on: true, src: '1 su 55' },
        { id: 'getaway', name: 'Getaway Deal', pct: 15, prob: 2, on: true, src: '1 su 55' }] },
    ] },
    { id: 'direct', name: 'Diretto', markup: 0, sponsor: null, groups: [
      { id: 'lead', label: 'Anticipo', items: [
        { id: 'lm', name: 'Last minute', pct: 5, prob: 18, on: true, src: 'quota presa da Booking' },
        { id: 'eb', name: 'Early bird', pct: 5, prob: 9, on: true, src: 'quota presa da Booking' }] },
      { id: 'cp', label: 'Codici sconto', items: [{ id: 'cp', name: 'Coupon (es. WELCOMEBACK10)', pct: 10, prob: 0, on: true, src: 'non misurato' }] },
      // Dal sito e dal motore Guesty, da 7 notti la tariffa piena non c'e'
      // piu': si sceglie fra le settimanali o le mensili.
      { id: 'los', label: 'Durata', items: [
        { id: 'wk', name: 'Settimanale (da 7 notti)', pct: 10, prob: 10, on: true, src: '3 su 29 in 12 mesi · tariffa non distinta' },
        { id: 'wknr', name: 'Settimanale non rimborsabile', pct: 15, prob: 0, on: true, src: 'non misurato' },
        { id: 'mo', name: 'Mensile', pct: 25, prob: 0, on: true, src: '0 su 29 in 12 mesi' },
        { id: 'monr', name: 'Mensile non rimborsabile', pct: 30, prob: 0, on: true, src: '0 su 29 in 12 mesi' }] },
    ] },
  ],
};

// I controlli sulle prenotazioni vere: le stesse formule applicate a quattro
// prenotazioni lette su Airbnb, Guesty e Booking (dall'artifact, 19/11/2026).
// `real` è il valore letto sulla ricevuta; il modello deve tornare entro un
// centesimo una volta arrotondato ai centesimi.
export const PARITA_VERIFICHE = [
  { code: 'HM9H4JYCZN', what: 'Airbnb · Prestige · 3 notti · prenotata il 17/11/2026', how: '816 € − ospiti migliori 15% − mobile 10%, + pulizie 90 €, commissione 15,5%', lab: 'Ti arriva', room: 816, cuts: [15, 10], cleaning: 90, comm: 15.5, real: 603.52 },
  { code: 'HM3A53KM52', what: 'Airbnb · Prestige · 7 notti · prenotata il 04/09/2026', how: '4.884 € − mobile 10% − settimanale 5%, + 90 €, commissione 15,5%', lab: 'Ti arriva', room: 4884, cuts: [10, 5], cleaning: 90, comm: 15.5, real: 3604.61 },
  { code: 'HM8PC94E89', what: 'Airbnb · Marco Aurelio · 4 notti · prenotata il 18/11/2026', how: 'Alloggio già scontato 959,31 € + pulizie 45 €, commissione 15,5% + IVA 22%', lab: 'Ti arriva', room: 959.31, cuts: [], cleaning: 45, comm: 18.91, real: 814.39 },
  { code: '6209847288', what: 'Booking · Trilocale · 5 notti · prenotata il 23/09/2026', how: 'Dopo Genius 25%: 1.493,38 € + pulizie 50 €; commissione e costi 24,5%', lab: 'Commissione', commission: { base: 1493.38 + 50, rate: 0.245 }, real: 378.13 },
];

// Soglie degli avvisi (scheda «Canali»).
export const PARITA_SOGLIE = {
  puntiObiettivo: 3,     // un portale più lontano di così dall'obiettivo (su 100 € di PriceLabs)
  puntiQuota: 3,         // la quota netto/pagato di un portale che si sposta di così in un mese
  nottiMinime: 10,       // sotto queste notti in un mese la quota non è confrontabile
};
