// Soglie del pannello «Prezzi in vendita» (scheda Forward booking, dal 27/11/2026).
// Si cambiano qui. Le percentuali sono punti: 20 = +20%.
export const PREZZI_VENDITA_SOGLIE = {
  // Prezzo chiesto oggi più alto di così rispetto a quanto incassato a notte
  // nello stesso mese dell'anno scorso → «prezzo alto».
  prezzoAlto: 20,
  // Sotto queste notti vendute nel mese dell'anno scorso il confronto non regge.
  minNottiAnnoScorso: 10,
  // Una casa aperta da meno di questi mesi nel mese dell'anno scorso era in
  // lancio (es. Prestige, ottobre 2025): il suo prezzo di allora non fa testo.
  mesiLancio: 6,
  // Coefficiente di realizzo (pagato ÷ prezzo PriceLabs del giorno di prenotazione):
  // si usa al posto del simulatore Parità solo con almeno queste notti misurate
  // per la casa. Le foto dei prezzi esistono dal 19/11/2026.
  minNottiRealizzo: 30,
  primaFoto: '2026-11-19',
};
