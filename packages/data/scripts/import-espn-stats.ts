#!/usr/bin/env node
// Enriches existing Match rows with ESPN team statistics
// (possession, shots, shots on target, corners, fouls) from the public
// scoreboard API (https://site.api.espn.com — no key required).
//
// Usage:
//   node scripts/import-espn-stats.ts [--leagues eng.1,esp.1,...]
//                                     [--from 2000] [--to 2026] [--dry-run]
//
// This does NOT create matches — it only fills match_team_stat columns for
// fixtures already in the DB (football-data / StatsBomb / ESPN imports).
// Existing non-null values are preserved; only NULL columns are filled.
// Idempotent: re-running produces the same result.
//
// Coverage notes:
// - ESPN's scoreboard caps at 400 events per `dates=YYYY` query; years that
//   hit the cap are topped up with per-day queries for the remaining dates.
// - `fin.1` (Veikkausliiga) and `pol.1` (Ekstraklasa) are not covered by ESPN.

import { db } from '../src/prisma/db.ts';

// ---------- CLI args ----------
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

interface StatLeague {
  slug: string;
  leagueName: string; // League.name in the DB
  countryName?: string; // disambiguates same-named leagues
  minYear: number;
}

const LEAGUES: StatLeague[] = [
  // England
  { slug: 'eng.1', leagueName: 'English Premier League', minYear: 2000 },
  { slug: 'eng.2', leagueName: 'English Championship', minYear: 2000 },
  { slug: 'eng.3', leagueName: 'English League One', minYear: 2000 },
  { slug: 'eng.4', leagueName: 'English League Two', minYear: 2000 },
  // Spain
  { slug: 'esp.1', leagueName: 'Spanish La Liga', minYear: 2000 },
  { slug: 'esp.2', leagueName: 'Spanish La Liga 2', minYear: 2000 },
  // Italy
  { slug: 'ita.1', leagueName: 'Italian Serie A', minYear: 2000 },
  { slug: 'ita.2', leagueName: 'Italian Serie B', minYear: 2000 },
  // Germany
  { slug: 'ger.1', leagueName: 'German Bundesliga', minYear: 2000 },
  { slug: 'ger.2', leagueName: 'German 2. Bundesliga', minYear: 2000 },
  // France
  { slug: 'fra.1', leagueName: 'French Ligue 1', minYear: 2000 },
  { slug: 'fra.2', leagueName: 'French Ligue 2', minYear: 2000 },
  // Other Europe
  { slug: 'ned.1', leagueName: 'Dutch Eredivisie', minYear: 2000 },
  { slug: 'por.1', leagueName: 'Portuguese Liga Portugal', minYear: 2004 },
  { slug: 'bel.1', leagueName: 'Belgian Pro League', minYear: 2004 },
  { slug: 'tur.1', leagueName: 'Turkish Süper Lig', minYear: 2004 },
  { slug: 'sco.1', leagueName: 'Scottish Premiership', minYear: 2004 },
  { slug: 'sco.2', leagueName: 'Scottish Championship', minYear: 2004 },
  { slug: 'sco.3', leagueName: 'Scottish League One', minYear: 2004 },
  { slug: 'sco.4', leagueName: 'Scottish League Two', minYear: 2004 },
  { slug: 'gre.1', leagueName: 'Greek Super League', minYear: 2004 },
  { slug: 'den.1', leagueName: 'Superliga', countryName: 'Denmark', minYear: 2012 },
  { slug: 'swe.1', leagueName: 'Allsvenskan', minYear: 2012 },
  { slug: 'nor.1', leagueName: 'Eliteserien', minYear: 2012 },
  { slug: 'rou.1', leagueName: 'Superliga', countryName: 'Romania', minYear: 2012 },
  { slug: 'aut.1', leagueName: 'Bundesliga', countryName: 'Austria', minYear: 2012 },
  { slug: 'sui.1', leagueName: 'Super League', countryName: 'Switzerland', minYear: 2012 },
  { slug: 'irl.1', leagueName: 'Premier Division', minYear: 2012 },
  { slug: 'chn.1', leagueName: 'Super League', countryName: 'China', minYear: 2012 },
  { slug: 'rus.1', leagueName: 'Premier League', countryName: 'Russia', minYear: 2012 },
  // Americas / Asia / Oceania
  { slug: 'usa.1', leagueName: 'MLS', minYear: 2012 },
  { slug: 'mex.1', leagueName: 'Liga MX', minYear: 2012 },
  { slug: 'bra.1', leagueName: 'Serie A', countryName: 'Brazil', minYear: 2012 },
  { slug: 'arg.1', leagueName: 'Liga Profesional', minYear: 2012 },
  { slug: 'jpn.1', leagueName: 'J1 League', minYear: 2012 },
  { slug: 'aus.1', leagueName: 'A-League', minYear: 2012 },
];

const selected = (arg('leagues') ?? LEAGUES.map((l) => l.slug).join(','))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => LEAGUES.some((l) => l.slug === s));
const fromYear = Number(arg('from') ?? 0) || undefined;
const toYear = Number(arg('to') ?? new Date().getFullYear());
const dryRun = has('dry-run');
const PAGE_LIMIT = 400;
const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// ---------- team-name canonicalisation ----------
// ESPN and football-data/StatsBomb use different spellings for the same club.
// canon() maps every known variant to one key; applied to BOTH sides.
const ALIASES: Record<string, string> = {
  // England
  manchesterunited: 'manutd',
  manutd: 'manutd',
  manunited: 'manutd',
  manchestercity: 'mancity',
  newcastleunited: 'newcastle',
  tottenhamhotspur: 'tottenham',
  spurs: 'tottenham',
  westhamunited: 'westham',
  leicestercity: 'leicester',
  wolverhamptonwanderers: 'wolves',
  wolverhampton: 'wolves',
  nottinghamforest: 'nottmforest',
  nottmforest: 'nottmforest',
  sheffieldunited: 'sheffieldutd',
  sheffieldutd: 'sheffieldutd',
  brightonhovealbion: 'brighton',
  leedsunited: 'leeds',
  lutontown: 'luton',
  ipswichtown: 'ipswich',
  norwichcity: 'norwich',
  stokecity: 'stoke',
  swanseacity: 'swansea',
  cardiffcity: 'cardiff',
  hullcity: 'hull',
  blackburnrovers: 'blackburn',
  boltonwanderers: 'bolton',
  wiganathletic: 'wigan',
  derbycounty: 'derby',
  prestonnorthend: 'preston',
  queensparkrangers: 'qpr',
  huddersfieldtown: 'huddersfield',
  charltonathletic: 'charlton',
  afcbournemouth: 'bournemouth',
  millwallfootballclub: 'millwall',
  // Spain
  athleticclub: 'athletic',
  athleticbilbao: 'athletic',
  athbilbao: 'athletic',
  atletico: 'atletico',
  atleticomadrid: 'atletico',
  athletico: 'atletico',
  athmadrid: 'atletico',
  realmadrid: 'realmadrid',
  fcbarcelona: 'barcelona',
  sevillafc: 'sevilla',
  realbetis: 'betis',
  valenciacf: 'valencia',
  villarrealcf: 'villarreal',
  celtavigo: 'celta',
  realsociedad: 'sociedad',
  realvalladolid: 'valladolid',
  realzaragoza: 'zaragoza',
  getafecf: 'getafe',
  caosasuna: 'osasuna',
  rcdmallorca: 'mallorca',
  gironafc: 'girona',
  espanyolfc: 'espanyol',
  rayovallecano: 'vallecano',
  deportivoalaves: 'alaves',
  cdleganes: 'leganes',
  udlaspalmas: 'laspalmas',
  // Italy
  intermilan: 'inter',
  internazionale: 'inter',
  acmilan: 'milan',
  sscnapoli: 'napoli',
  asroma: 'roma',
  sslazio: 'lazio',
  atalantabc: 'atalanta',
  bolognafc: 'bologna',
  torinofc: 'torino',
  udinesecalcio: 'udinese',
  hellasverona: 'verona',
  parmacalcio: 'parma',
  acmonza: 'monza',
  como1907: 'como',
  // Germany
  bayerleverkusen: 'leverkusen',
  borussiadortmund: 'dortmund',
  eintrachtfrankfurt: 'frankfurt',
  bayernmunich: 'bayern',
  rbleipzig: 'leipzig',
  vflwolfsburg: 'wolfsburg',
  borussiamonchengladbach: 'gladbach',
  monchengladbach: 'gladbach',
  vfstuttgart: 'stuttgart',
  scfreiburg: 'freiburg',
  fsvmainz: 'mainz',
  fsvmainz05: 'mainz',
  fcaaugsburg: 'augsburg',
  hamburgersv: 'hamburg',
  hsv: 'hamburg',
  fckoln: 'koln',
  fcunionberlin: 'unionberlin',
  schalke04: 'schalke',
  werderbremen: 'werder',
  vflbochum: 'bochum',
  svdarmstadt: 'darmstadt',
  fortunadusseldorf: 'dusseldorf',
  hannover96: 'hannover',
  fcnurnberg: 'nurnberg',
  svsandhausen: 'sandhausen',
  saintpauli: 'stpauli',
  // France
  parissaintgermain: 'psg',
  parissg: 'psg',
  olympiquelyonnais: 'lyon',
  olympiquelyon: 'lyon',
  olympiquemarseille: 'marseille',
  asmonaco: 'monaco',
  losclille: 'lille',
  losc: 'lille',
  ogcnice: 'nice',
  staderennais: 'rennes',
  girondinsbordeaux: 'bordeaux',
  toulousefc: 'toulouse',
  fcnantes: 'nantes',
  stadereims: 'reims',
  mhsc: 'montpellier',
  rcstrasbourg: 'strasbourg',
  fcmetz: 'metz',
  rclens: 'lens',
  stadebrestois: 'brest',
  asse: 'stetienne',
  saintetienne: 'stetienne',
  // Netherlands
  psveindhoven: 'psv',
  azalkmaar: 'az',
  fcutrecht: 'utrecht',
  fctwente: 'twente',
  scheerenveen: 'heerenveen',
  spartarotterdam: 'sparta',
  fgroningen: 'groningen',
  rkwaalwijk: 'waalwijk',
  goaheadeagles: 'goahead',
  fcvolendam: 'volendam',
  // Portugal
  fcporto: 'porto',
  slbenfica: 'benfica',
  sportingcp: 'splisbon',
  sportinglisboa: 'splisbon',
  scbraga: 'braga',
  vitoriasc: 'vitoria',
  fcfamalicao: 'famalicao',
  estorilpraia: 'estoril',
  santaclara: 'santaclara',
  cdfarense: 'farense',
  cadema: 'academico',
  // Belgium
  clubbrugge: 'brugge',
  rscanderlecht: 'anderlecht',
  kggenk: 'genk',
  krcgenk: 'genk',
  royalantwerpfc: 'royalantwerp',
  kaagent: 'gent',
  standardliege: 'standard',
  cerclebrugge: 'cercle',
  // Turkey
  besiktasjk: 'besiktas',
  istanbulbasaksehir: 'buyuksehyr',
  basaksehir: 'buyuksehyr',
  yenimalatyaspor: 'malatyaspor',
  kayserispor: 'kayserispor',
  antalyaspor: 'antalyaspor',
  gaziantepspor: 'gaziantepspor',
  // Greece
  olympiakos: 'olympiakos',
  aekathens: 'aek',
  aekathinaikos: 'aek',
  // Scotland
  stmirrenfc: 'stmirren',
  dundeeunited: 'dundeeutd',
  stjohnstonefc: 'stjohnstone',
  greenockmortonfc: 'morton',
  partickthistlefc: 'partick',
  // MLS / USA
  atlantautd: 'atlantaunited',
  atlantaunited: 'atlantaunited',
  nyredbulls: 'nyredbulls',
  newyorkredbulls: 'nyredbulls',
  nycityfc: 'newyorkcity',
  newyorkcityfc: 'newyorkcity',
  nycity: 'newyorkcity',
  losangelesfc: 'lafc',
  losangelesgalaxy: 'lagalaxy',
  seattlesoundersfc: 'seattlesounders',
  sportingkansascity: 'sportingkc',
  intermiamicf: 'intermiami',
  torontofc: 'toronto',
  columbuscrew: 'columbus',
  cfmontreal: 'montreal',
  // Mexico
  clubamerica: 'america',
  guadalajarachivas: 'chivas',
  guadalajara: 'chivas',
  cruzazul: 'cruzazul',
  pumasunam: 'unampumas',
  pumas: 'unampumas',
  tigresuat: 'tigres',
  clubleon: 'leon',
  santoslaguna: 'santoslaguna',
  tjxpantecas: 'clubtijuana',
  tijuana: 'clubtijuana',
  fcjuarez: 'juarez',
  // South America
  bocajuniors: 'boca',
  riverplate: 'river',
  vasco: 'vasco',
  vascodagama: 'vasco',
  saopaulo: 'saopaulo',
  atleticomineiro: 'atleticomg',
  atleticomg: 'atleticomg',
  athleticopr: 'athleticopr',
  sporterecife: 'sporte',
  // Japan
  kawasakifrontale: 'kawasaki',
  yokohamafmarinos: 'yokohama',
  gambaosaka: 'gamba',
  visselkobe: 'vissel',
  tokyoverdy: 'tokyov',
  sanfreccehiroshima: 'sanfrecce',
  avispa: 'avispa',
  consadole: 'hokkaidoconsadolesapporo',
  fctokyo: 'fctokyo',
  // Russia
  cskamoscow: 'cska',
  spartakmoscow: 'spartak',
  lokomotivmoscow: 'loco',
  lokomotiv: 'loco',
  dynamomoscow: 'dynamo',
  akhmatgrozny: 'akhmat',

  // England lower leagues — historical spellings
  oldhamathletic: 'oldham',
  scunthorpeunited: 'scunthorpe',
  southendunited: 'southend',
  torquayunited: 'torquay',
  yeoviltown: 'yeovil',
  bostonutd: 'boston',
  chesterfc: 'chester',
  kidderminsterharriers: 'kidderminster',
  macclesfieldtown: 'macclesfield',
  rushdendiamonds: 'rushdend',
  // other historical top-flight variants
  chievoverona: 'chievo',
  msvduisburg: 'duisburg',
  asnancylorraine: 'nancy',
  fcistres: 'istres',
  adodenhaag: 'denhaag',
  degraafschap: 'graafschap',
  fcdenbosch: 'denbosch',
  rbcroosendaal: 'roosendaal',
  rodajckerkrade: 'rodajc',
  brechincity: 'brechin',
  berwickrangers: 'berwick',
  eaststirlingshire: 'eaststirling',
  // England lower leagues + historical EPL spellings
  birminghamcity: 'birmingham',
  coventrycity: 'coventry',
  westbromwichalbion: 'westbrom',
  sheffieldwednesday: 'sheffieldweds',
  rotherhamunited: 'rotherham',
  plymouthargyle: 'plymouth',
  accringtonstanley: 'accrington',
  bristolrovers: 'bristolrvs',
  burtonalbion: 'burton',
  cambridgeunited: 'cambridge',
  carlisleunited: 'carlisle',
  cheltenhamtown: 'cheltenham',
  exetercity: 'exeter',
  forestgreenrovers: 'forestgreen',
  lincolncity: 'lincoln',
  northamptontown: 'northampton',
  oxfordunited: 'oxford',
  peterboroughunited: 'peterboro',
  shrewsburytown: 'shrewsbury',
  wycombewanderers: 'wycombe',
  bradfordcity: 'bradford',
  colchesterunited: 'colchester',
  crewealexandra: 'crewe',
  doncasterrovers: 'doncaster',
  grimsbytown: 'grimsby',
  harrogatetown: 'harrogate',
  hartlepoolunited: 'hartlepool',
  mansfieldtown: 'mansfield',
  salfordcity: 'salford',
  stockportcounty: 'stockport',
  suttonunited: 'sutton',
  swindontown: 'swindon',
  tranmererovers: 'tranmere',
  // Spain 2
  adalcorcon: 'alcorcon',
  fcandorra: 'andorra',
  fccartagena: 'cartagena',
  racingferrol: 'ferrol',
  racingsantander: 'santander',
  realoviedo: 'oviedo',
  sportinggijon: 'spgijon',
  udibiza: 'ibiza',
  // Germany
  '1fcheidenheim1846': 'heidenheim',
  '1fcunionberlin': 'unionberlin',
  fcaugsburg: 'augsburg',
  fccologne: 'koln',
  svdarmstadt98: 'darmstadt',
  darmstadt98: 'darmstadt',
  tsghoffenheim: 'hoffenheim',
  vfbstuttgart: 'stuttgart',
  '1fcmagdeburg': 'magdeburg',
  '1fcnurnberg': 'nurnberg',
  arminiabielefeld: 'bielefeld',
  hamburgsv: 'hamburg',
  herthaberlin: 'hertha',
  karlsruhersc: 'karlsruhe',
  scpaderborn07: 'paderborn',
  spvgggreutherfurth: 'greutherfurth',
  ssvjahnregensburg: 'regensburg',
  svelversberg: 'elversberg',
  svwehenwiesbaden: 'wehen',
  tsveintrachtbraunschweig: 'braunschweig',
  vflosnabruck: 'osnabruck',
  // France
  acajaccio: 'ajaccio',
  ajauxerre: 'auxerre',
  lehavreac: 'lehavre',
  dijonfco: 'dijon',
  pau: 'paufc',
  rodezaveyron: 'rodez',
  scamiens: 'amiens',
  stadelaval: 'laval',
  usquevilly: 'quevillyrouen',
  // Netherlands
  ajaxamsterdam: 'ajax',
  fcgroningen: 'groningen',
  feyenoordrotterdam: 'feyenoord',
  fortunasittard: 'forsittard',
  heraclesalmelo: 'heracles',
  necnijmegen: 'nijmegen',
  peczwolle: 'zwolle',
  rkcwaalwijk: 'waalwijk',
  sccambuur: 'cambuur',
  // Portugal
  braga: 'spbraga',
  gdchaves: 'chaves',
  despchaves: 'chaves',
  pacosdeferreira: 'pacosferreira',
  scfarense: 'farense',
  sporting: 'splisbon',
  vitoriadeguimaraes: 'guimaraes',
  // Belgium
  cerclebruggeksv: 'cercle',
  kvcwesterlo: 'westerlo',
  kvkortrijk: 'kortrijk',
  kvmechelen: 'mechelen',
  kvoostende: 'oostende',
  ohleuven: 'oudheverleeleuven',
  racinggenk: 'genk',
  rfcseraing: 'seraing',
  royalcharleroisc: 'charleroi',
  rwdm: 'rwdmolenbeek',
  sinttruidense: 'sttruiden',
  unionstgilloise: 'stgilloise',
  zultewaregem: 'waregem',
  // Turkey
  adanademirspor: 'addemirspor',
  caykurrizespor: 'rizespor',
  fatihkaragumruk: 'karagumruk',
  gaziantepfk: 'gaziantepspor',
  // Scotland
  heartofmidlothian: 'hearts',
  airdrieonians: 'airdrieutd',
  ayrunited: 'ayr',
  dunfermlineathletic: 'dunfermline',
  greenockmorton: 'morton',
  hamiltonacademical: 'hamilton',
  invernesscaledonianthistle: 'invernessc',
  partickthistle: 'partick',
  raithrovers: 'raithrvs',
  alloaathletic: 'alloa',
  queenofthesouth: 'queenofsth',
  stirlingalbion: 'stirling',
  albionrovers: 'albionrvs',
  elgincity: 'elgin',
  forfarathletic: 'forfar',
  spartansfc: 'spartans',
  // Greece
  asterastripoli: 'asterastripolis',
  ionikosfc: 'ionikos',
  olympiacos: 'olympiakos',
  panserraikosfc: 'panserraikos',
  pasgiannina: 'giannina',
  // Denmark
  aab: 'aalborg',
  achorsens: 'horsens',
  agf: 'aarhus',
  brndbyif: 'brondby',
  fckbenhavn: 'fccopenhagen',
  fcmidtjylland: 'midtjylland',
  fcnordsjlland: 'nordsjaelland',
  lyngbyboldklub: 'lyngby',
  odenseboldklub: 'odense',
  silkeborgif: 'silkeborg',
  vejleboldklub: 'vejle',
  viborgff: 'viborg',
  // Sweden
  bkhacken: 'hacken',
  degerforsif: 'degerfors',
  halmstadsbk: 'halmstad',
  hammarbyif: 'hammarby',
  ifbrommapojkarna: 'brommapojkarna',
  ifelfsborg: 'elfsborg',
  ifkgoteborg: 'goteborg',
  ifknorrkoping: 'norrkoping',
  ifkvarnamo: 'varnamo',
  iksirius: 'sirius',
  kalmarff: 'kalmar',
  mjallbyaif: 'mjallby',
  varbergsboisfc: 'varberg',
  // Norway
  hamarkameratene: 'hamkam',
  oddsbk: 'odd',
  sarpsborgfk: 'sarpsborg08',
  skbrann: 'brann',
  vikingfk: 'viking',
  // Romania
  cfrclujnapoca: 'cfrcluj',
  csmioveni: 'mioveni',
  csucraiova: 'ucraiova',
  fcfarulconstanta: 'farulconstanta',
  hermannstadt: 'fchermannstadt',
  otelulgalati: 'otelul',
  petrolulploiesti: 'petrolul',
  politehnicaiasi: 'poliiasi',
  rapidbucuresti: 'fcrapidbucuresti',
  sepsisfantugheorghe: 'sepsisfgheorghe',
  universitateacluj: 'ucluj',
  voluntari: 'fcvoluntari',
  // Austria
  austrialustenau: 'alustenau',
  fcblauweilinz: 'bwlinz',
  lasklinz: 'lask',
  rapidvienna: 'skrapid',
  rbsalzburg: 'salzburg',
  scrheindorfaltach: 'altach',
  skaustriaklagenfurt: 'aklagenfurt',
  sksturmgraz: 'sturmgraz',
  svjoskoried: 'ried',
  tsvhartberg: 'hartberg',
  wolfsberger: 'wolfsbergerac',
  wsgswarovskitirol: 'tirol',
  // Switzerland
  fcbasel: 'basel',
  fclugano: 'lugano',
  fcluzern: 'luzern',
  fcsion: 'sion',
  fcstadelausanneouchy: 'lausanneouchy',
  fczurich: 'zurich',
  lausannesports: 'lausanne',
  // Ireland
  cork: 'corkcity',
  droghedaunited: 'drogheda',
  stpatricksathletic: 'stpatricks',
  ucd: 'ucdublin',
  // USA / MLS
  atlantaunitedfc: 'atlantaunited',
  charlottefc: 'charlotte',
  chicagofirefc: 'chicagofire',
  houstondynamofc: 'houstondynamo',
  minnesotaunitedfc: 'minnesotaunited',
  orlandocitysc: 'orlandocity',
  redbullnewyork: 'nyredbulls',
  stlouiscitysc: 'stlouiscity',
  // Mexico
  atleticodesanluis: 'atlsanluis',
  // Brazil
  americamineiro: 'americamg',
  botafogo: 'botafogorj',
  flamengo: 'flamengorj',
  redbullbragantino: 'bragantino',
  // Japan
  consadolesapporo: 'hokkaidoconsadolesapporo',
  kyotosanga: 'kyoto',
  urawareddiamonds: 'urawareds',
  // China
  cangzhoumightylions: 'cangzhou',
  dalianprofessional: 'dalianpro',
  henan: 'henansongshanlongmen',
  shanghaiportfc: 'shanghaiport',
  shanghaishenhuafc: 'shanghaishenhua',
  shenzhenfc: 'shenzhen',
  zhejiangprofessionalfc: 'zhejiangprofessional',
  // Russia
  fcbaltikakaliningrad: 'baltika',
  fckhimki: 'khimki',
  fcuralekaterinburg: 'ural',
  fktorpedomoscow: 'torpedomoscow',
  gazovikorenburg: 'orenburg',
  kryliasovetov: 'krylyasovetov',
  nizhnynovgorod: 'volgannovgorod',
  rostov: 'fkrostov',
  zenitstpetersburg: 'zenit',
  // others
  hammarby: 'hammarby',
};

// Aliases that only apply within one league (same club name means different
// things in different countries, e.g. Santos in Liga MX vs Brazil Série A).
const LEAGUE_ALIASES: Record<string, Record<string, string>> = {
  'mex.1': {
    santos: 'santoslaguna',
    sanluis: 'atlsanluis',
    sinaloa: 'doradosdesinaloa',
    uadeg: 'leonesnegros',
    clubatleticomorelia: 'monarcas',
  },
  // DB stores Espanyol's Segunda spellings as 'Espanol' → 'espanol',
  // and Deportivo La Coruña as 'La Coruna' → 'lacoruna'
  'esp.2': { espanyol: 'espanol', deportivo: 'lacoruna' },
  // ESPN uses 'Deportivo' for Deportivo La Coruña (DB: 'La Coruna')
  'esp.1': { deportivo: 'lacoruna' },
};

function canon(name: string, slug?: string): string {
  const n = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  return (slug ? LEAGUE_ALIASES[slug]?.[n] : undefined) ?? ALIASES[n] ?? n;
}

// ---------- ESPN fetch ----------
interface EspnCompetitor {
  homeAway: 'home' | 'away';
  score?: string;
  team: { id: string; displayName: string };
  statistics?: { name: string; displayValue?: string; value?: number }[];
}
interface EspnEvent {
  id: string;
  date?: string;
  status?: { type?: { completed?: boolean } };
  competitions?: { competitors?: EspnCompetitor[] }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchScoreboard(slug: string, dates: string): Promise<EspnEvent[]> {
  const url = `${API}/${slug}/scoreboard?dates=${dates}&limit=${PAGE_LIMIT}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'soccers-import/1.0' } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        console.warn(`  ! ${res.status} for ${slug}?dates=${dates}`);
        return [];
      }
      const data = (await res.json()) as { events?: EspnEvent[] };
      return data.events ?? [];
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return [];
}

async function fetchYear(slug: string, year: number): Promise<EspnEvent[]> {
  const events = await fetchScoreboard(slug, String(year));
  await sleep(150);
  if (events.length < PAGE_LIMIT) return events;
  console.log(`  ${slug} ${year}: cap hit, refetching by month`);
  const seen = new Set<string>();
  const merged: EspnEvent[] = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}${String(m).padStart(2, '0')}`;
    const monthEvents = await fetchScoreboard(slug, ym);
    await sleep(120);
    for (const e of monthEvents) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        merged.push(e);
      }
    }
  }
  return merged;
}

// ---------- entity loading ----------
interface MatchRec {
  id: number;
  dateMs: number;
  homeKey: string;
  awayKey: string;
  homeTeamId: number;
  awayTeamId: number;
}

async function main() {
  // countries + leagues
  const countries = await db.orm.Country.all();
  const countryName = new Map(countries.map((c) => [c.id, c.name]));
  const leagues = await db.orm.League.all();
  const leagueByKey = new Map<string, number>();
  for (const l of leagues) {
    const cname = l.countryId ? (countryName.get(l.countryId) ?? '') : '';
    leagueByKey.set(`${cname}|${l.name}`, l.id);
    leagueByKey.set(`|${l.name}`, l.id); // unqualified fallback
  }

  // teams
  const teams = await db.orm.Team.all();
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  // matches for selected leagues
  const slugToLeagueId = new Map<string, number>();
  for (const cfg of LEAGUES) {
    if (!selected.includes(cfg.slug)) continue;
    const key = cfg.countryName ? `${cfg.countryName}|${cfg.leagueName}` : `|${cfg.leagueName}`;
    let lid = leagueByKey.get(key);
    if (lid === undefined && !cfg.countryName) lid = leagueByKey.get(`|${cfg.leagueName}`);
    if (lid === undefined) {
      console.warn(`! league not found: ${cfg.leagueName} (${cfg.countryName ?? 'any'}) — skipped`);
      continue;
    }
    slugToLeagueId.set(cfg.slug, lid);
  }
  const leagueIdToSlug = new Map<number, string>();
  for (const [slug, lid] of slugToLeagueId) leagueIdToSlug.set(lid, slug);

  // leagueId -> matches sorted by date, indexed by UTC day
  const leagueMatches = new Map<number, Map<string, MatchRec[]>>();
  for (const lid of new Set(slugToLeagueId.values())) {
    const slug = leagueIdToSlug.get(lid);
    const seasons = await db.orm.Season.where({ leagueId: lid }).all();
    const dayMap = new Map<string, MatchRec[]>();
    for (const s of seasons) {
      const matches = await db.orm.Match.where({ seasonId: s.id })
        .select('id', 'date', 'homeTeamId', 'awayTeamId')
        .all();
      for (const m of matches) {
        const d = new Date(m.date);
        const day = d.toISOString().slice(0, 10);
        const rec: MatchRec = {
          id: m.id,
          dateMs: d.getTime(),
          homeKey: canon(teamName.get(m.homeTeamId) ?? '', slug),
          awayKey: canon(teamName.get(m.awayTeamId) ?? '', slug),
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
        };
        const list = dayMap.get(day) ?? [];
        list.push(rec);
        dayMap.set(day, list);
      }
    }
    leagueMatches.set(lid, dayMap);
    const n = [...dayMap.values()].reduce((a, b) => a + b.length, 0);
    console.log(`league ${lid}: ${n} matches indexed`);
  }

  const dayMs = 86400000;
  function findMatch(
    lid: number,
    dateIso: string,
    homeName: string,
    awayName: string,
  ): MatchRec | null {
    const dayMap = leagueMatches.get(lid);
    if (!dayMap) return null;
    const t = new Date(`${dateIso}T00:00:00Z`).getTime();
    const slug = leagueIdToSlug.get(lid);
    const hk = canon(homeName, slug);
    const ak = canon(awayName, slug);
    let best: MatchRec | null = null;
    let bestDiff = Infinity;
    for (let delta = -1; delta <= 1; delta++) {
      const day = new Date(t + delta * dayMs).toISOString().slice(0, 10);
      for (const rec of dayMap.get(day) ?? []) {
        if (rec.homeKey === hk && rec.awayKey === ak) {
          const diff = Math.abs(rec.dateMs - new Date(`${dateIso}T00:00:00Z`).getTime());
          if (diff < bestDiff) {
            best = rec;
            bestDiff = diff;
          }
        }
      }
    }
    return best;
  }

  // ---------- diagnostics: dump unmatched team names for one year ----------
  if (has('names')) {
    const year = Number(arg('names-year') ?? 2023);
    for (const slug of selected) {
      const lid = slugToLeagueId.get(slug);
      if (lid === undefined) continue;
      const events = await fetchYear(slug, year);
      const dbKeys = new Set<string>();
      for (const recs of leagueMatches.get(lid)?.values() ?? []) {
        for (const r of recs) {
          dbKeys.add(r.homeKey);
          dbKeys.add(r.awayKey);
        }
      }
      const espnNames = new Map<string, string>(); // canon -> displayName
      for (const e of events) {
        for (const c of e.competitions?.[0]?.competitors ?? []) {
          const n = c.team?.displayName;
          if (n) espnNames.set(canon(n, slug), n);
        }
      }
      const missing = [...espnNames.entries()].filter(([k]) => !dbKeys.has(k));
      const unused = [...dbKeys].filter((k) => !espnNames.has(k));
      console.log(
        `\n=== ${slug} (league ${lid}) — ESPN names missing from DB canon: ${missing.length} ===`,
      );
      for (const [k, n] of missing.sort()) console.log(`  espn: "${n}" → canon "${k}"`);
      console.log(`  DB canons not seen on ESPN (${unused.length}): ${unused.sort().join(', ')}`);
    }
    await db.close();
    return;
  }

  // ---------- collect stat rows ----------
  interface StatRow {
    match_id: number;
    team_id: number;
    possession: number | null;
    shots: number | null;
    shots_on_target: number | null;
    corners: number | null;
    fouls: number | null;
  }

  const wanted = new Map<number, StatRow[]>(); // matchId -> rows
  const unmatchedNames = new Map<string, number>();
  let eventsSeen = 0;
  let eventsWithStats = 0;
  let matched = 0;
  let unmatched = 0;

  const statNum = (c: EspnCompetitor, name: string): number | null => {
    const s = c.statistics?.find((x) => x.name === name);
    if (!s) return null;
    const v = s.value ?? Number(s.displayValue);
    return Number.isFinite(v) ? v : null;
  };

  for (const slug of selected) {
    const lid = slugToLeagueId.get(slug);
    if (lid === undefined) continue;
    const cfg = LEAGUES.find((l) => l.slug === slug)!;
    const start = Math.max(fromYear ?? cfg.minYear, cfg.minYear);
    console.log(`\n=== ${slug} → league ${lid} (${start}→${toYear}) ===`);
    for (let year = start; year <= toYear; year++) {
      const events = await fetchYear(slug, year);
      let yrMatched = 0;
      for (const e of events) {
        if (!e.date || !e.status?.type?.completed) continue;
        const comp = e.competitions?.[0];
        const competitors = comp?.competitors ?? [];
        const home = competitors.find((c) => c.homeAway === 'home');
        const away = competitors.find((c) => c.homeAway === 'away');
        if (!home || !away) continue;
        eventsSeen++;
        const hasStats = [home, away].some((c) =>
          ['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'foulsCommitted'].some(
            (n) => statNum(c, n) !== null,
          ),
        );
        if (!hasStats) continue;
        eventsWithStats++;
        const rec = findMatch(
          lid,
          e.date.slice(0, 10),
          home.team.displayName,
          away.team.displayName,
        );
        if (!rec) {
          unmatched++;
          const key = `${home.team.displayName} v ${away.team.displayName} (${e.date.slice(0, 10)})`;
          unmatchedNames.set(key, (unmatchedNames.get(key) ?? 0) + 1);
          continue;
        }
        matched++;
        yrMatched++;
        const rows: StatRow[] = [
          {
            match_id: rec.id,
            team_id: rec.homeTeamId,
            possession: statNum(home, 'possessionPct'),
            shots: statNum(home, 'totalShots'),
            shots_on_target: statNum(home, 'shotsOnTarget'),
            corners: statNum(home, 'wonCorners'),
            fouls: statNum(home, 'foulsCommitted'),
          },
          {
            match_id: rec.id,
            team_id: rec.awayTeamId,
            possession: statNum(away, 'possessionPct'),
            shots: statNum(away, 'totalShots'),
            shots_on_target: statNum(away, 'shotsOnTarget'),
            corners: statNum(away, 'wonCorners'),
            fouls: statNum(away, 'foulsCommitted'),
          },
        ];
        const list = wanted.get(rec.id) ?? [];
        list.push(...rows);
        wanted.set(rec.id, list);
      }
      console.log(`  ${year}: ${yrMatched} fixtures matched`);
    }
  }

  console.log(
    `\nevents: ${eventsSeen} | with stats: ${eventsWithStats} | matched: ${matched} | unmatched: ${unmatched}`,
  );
  if (unmatchedNames.size) {
    const sample = [...unmatchedNames.entries()].slice(0, 15);
    console.log('unmatched sample:');
    for (const [k, n] of sample) console.log(`  ${n}× ${k}`);
  }
  if (dryRun) {
    console.log('[dry-run] no writes performed');
    await db.close();
    return;
  }

  // ---------- merge + write ----------
  const allMatchIds = [...wanted.keys()];
  const CHUNK = 400;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  const existingByKey = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < allMatchIds.length; i += CHUNK) {
    const ids = allMatchIds.slice(i, i + CHUNK);
    const plan = (db.sql as any).match_team_stat
      .select(
        'id',
        'match_id',
        'team_id',
        'possession',
        'shots',
        'shots_on_target',
        'shots_off_target',
        'shots_blocked',
        'corners',
        'fouls',
        'offsides',
        'yellow_cards',
        'red_cards',
        'passes',
        'pass_accuracy',
        'expected_goals',
      )
      .where((f: any, fns: any) => fns.in(f.match_id, ids))
      .build();
    const rows = (await db.query(plan)) as Record<string, unknown>[];
    for (const r of rows) existingByKey.set(`${r.match_id}|${r.team_id}`, r);
  }
  console.log(`existing stat rows in scope: ${existingByKey.size}`);

  // Build final rows: for every wanted (match,team) emit merged values.
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { id: number; data: Record<string, unknown> }[] = [];
  for (const rows of wanted.values()) {
    for (const r of rows) {
      const key = `${r.match_id}|${r.team_id}`;
      const ex = existingByKey.get(key);
      if (!ex) {
        toInsert.push({
          match_id: r.match_id,
          team_id: r.team_id,
          possession: r.possession,
          shots: r.shots,
          shots_on_target: r.shots_on_target,
          corners: r.corners,
          fouls: r.fouls,
        });
        continue;
      }
      const data: Record<string, unknown> = {};
      const fill = (col: string, ormCol: string, v: number | null) => {
        if (v !== null && (ex[col] === null || ex[col] === undefined)) data[ormCol] = v;
      };
      fill('possession', 'possession', r.possession);
      fill('shots', 'shots', r.shots);
      fill('shots_on_target', 'shotsOnTarget', r.shots_on_target);
      fill('corners', 'corners', r.corners);
      fill('fouls', 'fouls', r.fouls);
      if (Object.keys(data).length) {
        toUpdate.push({ id: ex.id as number, data });
      } else {
        unchanged++;
      }
    }
  }
  console.log(
    `to insert: ${toInsert.length} | to update: ${toUpdate.length} | unchanged: ${unchanged}`,
  );

  for (let i = 0; i < toInsert.length; i += 300) {
    const plan = (db.sql as any).match_team_stat.insert(toInsert.slice(i, i + 300)).build();
    await db.execute(plan);
    inserted += Math.min(300, toInsert.length - i);
  }
  const UPD_CHUNK = 100;
  for (let i = 0; i < toUpdate.length; i += UPD_CHUNK) {
    const slice = toUpdate.slice(i, i + UPD_CHUNK);
    await Promise.all(
      slice.map((u) => db.orm.MatchTeamStat.where({ id: u.id }).update(u.data as never)),
    );
    updated += slice.length;
    if (updated % 5000 < UPD_CHUNK) console.log(`  updated ${updated}/${toUpdate.length}`);
  }
  console.log(`done: ${inserted} inserted, ${updated} updated`);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
