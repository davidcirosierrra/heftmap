# Heftmap — zerk pisatzen duen zure biltegian eta erabiltzen den

> Itzulpen hau berrikusteke dago.

Heftmap-ek fitxategi eta karpeta bakoitzaren pisua erakusten du, inork erreferentziatzen ez dituen
baliabideak, eta gehien aldatzen den kode handia non dagoen. Baliabide astunak dituzten web
proiektuetarako pentsatua (`.glb` modeloak, audioa, testurak), git duen edozein biltegitan
balio du, monorepoetan ere bai.

[English](README.md) · [Español](README.es.md)

![Hotspot-ak: lerroak × aldaketak](docs/images/hotspots.png)

## Zer egiten du

- **«Karpetak» ikuspegia** alboko barran: karpeta eta fitxategi bakoitzaren tamaina eta
  ehunekoa, pisu-barrarekin, gehien pisatzen duenarentzat kolorearekin eta azterketa karpeta
  batzuetara mugatzeko kontrol-laukiekin.
- **Panela taula eta treemap-arekin**, bi noranzkoetan lotuta. Fitxategi guztiak taula
  ordenagarri eta iragazgarri batean. Treemap-aren azalera byteen, √byteen edo lerroen arabera;
  kolorea luzapenaren, erabileraren, antzinatasunaren, azken commiten edo aldaketa-maiztasunaren
  arabera.
- **Erabilera**: nork erreferentziatzen duen fitxategi bakoitza (importak, bide-izenak testuan,
  `url()`, `src`/`href`, Markdown estekak, `import.meta.glob`) eta zein baliabidek ez duten
  **arrastorik**. Horientzat: baztertu edo zakarrontzira eraman (beti galdetzen du lehenago).
- **Git**: fitxategi bakoitzaren azken commita, commit gabeko aldaketak eta diff-a.
- **Hotspot-ak**: botoi batek lerroak eta aldaketa kopurua gurutzatzen ditu, aldatzen jarraitzen
  duen kode handia aurkitzeko.

## Zer ez du egiten

- Ez du kode hila detektatzen: kodean, «Inportatzailerik gabe» konfiantza txikiko abisua da
  (framework baten bideak, adibidez, ez ditu inork inportatzen). Horretarako, [Knip](https://knip.dev).
- Ez du ezer ezabatzen galdetu gabe.
- Ez du ezer inora bidaltzen: dena lokalean kalkulatzen da zure fitxategiekin eta `git`-ekin.
  Telemetriarik eta sare-eskaerarik gabe.

## Baldintzak

- Cursor, VS Code 1.85 edo berriagoa, edo Open VSX-etik instalatzen duen edozein editore.
- `git` `PATH`-ean, historiarako eta aldaketetarako. Git gabe, Heftmap-ek tamainak eta erabilera
  erakusten ditu.
- Modu mugatuan (konfiantzarik gabeko karpetak) Heftmap-ek ez du git exekutatzen. Ikus [SECURITY.md](SECURITY.md).

## Ezarpenak

| Ezarpena | Lehenetsia | Zertarako |
|----------|------------|-----------|
| `heftmap.language` | `auto` | `en`, `es` edo `eu`; `auto`-k editorea jarraitzen du |
| `heftmap.publicDir` | `public` | Bide-izen absolutuak (`/models/x.glb`) ebazteko karpeta |
| `heftmap.git.since` | hutsik | Git historia mugatu biltegi handietan, adib. `1.year` |
| `heftmap.usage.ignore` | `[]` | Inoiz umezurtz gisa kontatzen ez diren fitxategiak |
| `heftmap.usage.entryPoints` | `[]` | Sarrera-puntu gehigarriak (framework baten bideak, adibidez) |
| `heftmap.refreshDelay` | `1500` | Aldaketa baten ondoren berriro aztertu aurretik itxarotekoa, milisegundotan (250–60000) |
| `heftmap.autoRefresh` | `true` | Berriro aztertu bere kabuz fitxategiak edo git aldatzean; desaktibatuta = Freskatu-rekin bakarrik |

## Monorepoak

Aplikazio bakoitzak bere `tsconfig.json` erabiltzen du (`@/…` bezalako aliasak), eta izenez
inportatutako biltegiko paketeak (`@scope/pkg`) bere iturburu-kodera ebazten dira, `node_modules`
izan zein ez. Bundler-aren konfigurazioan bakarrik dauden aliasak (Vite, Metro, Babel) ezin dira
jarraitu: erregistroak (*Output → Heftmap*) zerrendatzen ditu, eta tsconfig baten `paths` atalean
deklaratzeak konpontzen du.

## Muga ezagunak

- Diskoko aldaketa bakoitzak biltegia berriro aztertzen du atzeko planoan. Azterketa
  inkrementala aurreikusita dago.
- Erro-karpeta bat baino gehiagoko lan-eremuan, lehenengoa bakarrik aztertzen da.
- Izena aldatutako fitxategi batek aldaketak zerotik kontatzen hasten da.

## Arazoak

Erregistroa *Output → Heftmap* atalean dago. Heftmap-ek huts egiten badu, esan egiten du eta
**Kopiatu txostena** eskaintzen du: itsatsi [intzidentzia](https://github.com/davidcirosierrra/Heft/issues)
batean. Segurtasun-arazoak: ikus [SECURITY.md](SECURITY.md).

## Lizentzia

[MIT](LICENSE)
