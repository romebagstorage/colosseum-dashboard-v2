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
  // Coefficiente di realizzo (pagato ÷ prezzo PriceLabs del giorno di prenotazione).
  // Con almeno queste notti misurate una casa usa solo il suo; sotto, il suo viene
  // mescolato con quello di tutte le case insieme (sempre misurato), che a sua volta
  // vale solo con almeno queste notti in totale. Sotto anche quella soglia: simulatore.
  // Le foto dei prezzi esistono dal 19/11/2026.
  minNottiRealizzo: 30,
  // Peso, in notti, del coefficiente di tutte le case nella media di una casa con
  // poche notti: fattore = (notti casa × coeff casa + peso × coeff tutte) ÷ (notti casa + peso).
  pesoPortafoglio: 10,
  primaFoto: '2026-11-19',
};
