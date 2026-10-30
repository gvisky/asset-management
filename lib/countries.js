/* Country names — one canonical English name per country.
   Azure / Intune exports mix English, Turkish and Russian spellings
   (Türkiye, Rusya, Россия, Norveç, Fas …); normCountry() folds them together. */

// The 3 countries with Office / Factory sites, cost centers and budget data.
const CORE_COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];

const ALIASES = {
  'turkey': 'Turkey', 'türkiye': 'Turkey', 'turkiye': 'Turkey', 'tr': 'Turkey', 'türkei': 'Turkey',
  'russia': 'Russia', 'rusya': 'Russia', 'россия': 'Russia', 'russia-ukraine': 'Russia', 'russian federation': 'Russia',
  'vietnam': 'Vietnam', 'viet nam': 'Vietnam', 'vn': 'Vietnam',
  'thailand': 'Thailand', 'tayland': 'Thailand', 'th': 'Thailand',
  'malaysia': 'Malaysia', 'malezya': 'Malaysia', 'my': 'Malaysia',
  'norway': 'Norway', 'norveç': 'Norway', 'norvec': 'Norway',
  'bulgaria': 'Bulgaria', 'bulgaristan': 'Bulgaria',
  'morocco': 'Morocco', 'fas': 'Morocco',
  'united states': 'United States', 'usa': 'United States', 'amerika birleşik devletleri': 'United States', 'abd': 'United States',
  'egypt': 'Egypt', 'mısır': 'Egypt',
  'algeria': 'Algeria', 'cezayir': 'Algeria',
  'romania': 'Romania', 'romanya': 'Romania',
  'italy': 'Italy', 'italya': 'Italy', 'i̇talya': 'Italy',
  'netherlands': 'Netherlands', 'hollanda': 'Netherlands',
  'germany': 'Germany', 'almanya': 'Germany',
  'greece': 'Greece', 'yunanistan': 'Greece',
  'kazakhstan': 'Kazakhstan', 'kazakistan': 'Kazakhstan',
  'china': 'China', 'çin': 'China',
  'india': 'India', 'hindistan': 'India',
  'spain': 'Spain', 'ispanya': 'Spain', 'i̇spanya': 'Spain',
  'iraq': 'Iraq', 'irak': 'Iraq',
  'georgia': 'Georgia', 'gürcistan': 'Georgia',
  'sweden': 'Sweden', 'isveç': 'Sweden', 'i̇sveç': 'Sweden',
  'finland': 'Finland', 'finlandiya': 'Finland',
  'indonesia': 'Indonesia', 'endonezya': 'Indonesia',
  'philippines': 'Philippines', 'filipinler': 'Philippines',
  'nigeria': 'Nigeria', 'nijerya': 'Nigeria',
  'united arab emirates': 'United Arab Emirates', 'uae': 'United Arab Emirates', 'birleşik arap emirlikleri': 'United Arab Emirates', 'bae': 'United Arab Emirates',
  'qatar': 'Qatar', 'katar': 'Qatar',
  'azerbaijan': 'Azerbaijan', 'azerbaycan': 'Azerbaijan',
  'belarus': 'Belarus', 'beyaz rusya': 'Belarus',
  'bosnia and herzegovina': 'Bosnia and Herzegovina', 'bosna hersek': 'Bosnia and Herzegovina', 'bosnia': 'Bosnia and Herzegovina',
  'iran': 'Iran', 'pakistan': 'Pakistan', 'kenya': 'Kenya',
  'test': '',
};

// Canonical country name, '' when blank or not a real country (e.g. "TEST").
function normCountry(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const k = s.toLocaleLowerCase('tr').replace(/\s+/g, ' ');
  if (k in ALIASES) return ALIASES[k];
  const k2 = s.toLowerCase().replace(/\s+/g, ' ');
  if (k2 in ALIASES) return ALIASES[k2];
  // Unknown but plausible: keep as typed, Title Case.
  return s.replace(/\s+/g, ' ').replace(/\b\p{L}/gu, c => c.toUpperCase());
}

// Country of a company by its name (the 3 core countries only).
function countryFromCompany(company) {
  const c = String(company || '').toLowerCase();
  if (c.includes('vietnam')) return 'Vietnam';
  if (c.includes('thailand') || c.includes('thailans')) return 'Thailand';   // handles the export typo
  if (c.includes('malaysia')) return 'Malaysia';
  return '';
}

// Sort: the 3 core countries first, then alphabetical.
function sortCountries(list) {
  return [...new Set(list.filter(Boolean))].sort((a, b) => {
    const ia = CORE_COUNTRIES.indexOf(a), ib = CORE_COUNTRIES.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.localeCompare(b);
  });
}

module.exports = { CORE_COUNTRIES, normCountry, countryFromCompany, sortCountries };
