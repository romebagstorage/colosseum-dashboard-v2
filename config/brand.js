// ============================================================================
// BRAND — nome, colori, font e logo della dashboard (token presi da colosseumholidays.com).
// Per un altro cliente: cambiare qui e sostituire i file in /public/brand.
// ============================================================================
export const BRAND = {
  name: 'Colosseum Holidays',
  tagline: 'Dashboard operativa',
  website: 'https://www.colosseumholidays.com',
  logoMark: '/brand/logo-mark.svg',            // quadrato/verticale, usato nell'header
  logoLockup: '/brand/logo-lockup-horizontal.svg', // orizzontale, usato nella pagina di login
  colors: {
    brand:   '#556b58', // green-700
    brandDark: '#3e4f41',
    accent:  '#b39e73', // brass-600
    accentText: '#7e6b3e', // brass-800
    pageBg:  '#faf6ee', // cream-50
    raised:  '#f4efe3', // cream-100
    surface: '#ffffff',
    ink:     '#1f2620', // ink-900
    inkMuted:'#4f5651', // ink-600
    inkSubtle:'#8a8f89',
    success: '#6b8e5a',
    warning: '#b68a3e',
    danger:  '#a04e3a',
    info:    '#5c7380',
  },
  // Palette per serie multiple (mix canali, paesi, anni)
  palette: ['#556b58', '#b39e73', '#8a9d8c', '#7e6b3e', '#a04e3a', '#5c7380', '#c4b089', '#6b806e', '#b68a3e', '#4a5c4c', '#ddcfae'],
};
