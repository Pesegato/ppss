# Space Shmup (PixiJS)

Shooter 2D a scrolling orizzontale. Nessuna build: `index.html` + PixiJS da CDN.

## Controlli
- Tastiera: frecce/WASD per muoversi, Spazio/Z/X per sparare, Invio/Spazio per confermare.
- Gamepad: stick sinistro o D-pad, A/X/RT per sparare, A/Start per confermare.

## Livelli (`localStorage["shmup_waves"]`)
Accetta un array di livelli, un singolo livello, o una mappa `{ "nome": livello }`
(i livelli possono anche essere stringhe JSON). Formato di ogni entità:

`nome,tempoSpawn,attivo,pattern,velocità,ampiezzaY,ampiezzaX,quantità,intervallo`

Pattern: `Circular`, `Swoop`, `Lissajous` (altri = linea retta). Nomi che iniziano per `BOSS` = boss.
Puoi importare file `.json` dal pulsante in pagina, oppure da console:
`localStorage.setItem('shmup_waves', JSON.stringify([ /* livelli */ ]))`.
Se non c'è nulla, parte un livello demo.

## Pubblicazione
1. Crea il repo e fai push su `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Il workflow `.github/workflows/pages.yml` pubblica ad ogni push.

Test locale: `python3 -m http.server` e apri http://localhost:8000
