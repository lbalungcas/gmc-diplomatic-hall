# Sail to the Lighthouse: running the opening

A digital opening instead of a ribbon cutting. Everyone in the room scans a QR code, sails a boat
with Tutu to the lighthouse on their phone, and when enough boats arrive, the phones and the LED
wall play the opening together.

## The three screens

| Who | Open this | What it does |
| --- | --- | --- |
| Everyone | `/sail/` (the QR on the LED) | Tap left and right in turn to sail. Three taps a second is full speed: 15 seconds. |
| LED wall | `/sail/?view=led&token=HOST_TOKEN` | Fleet overview, QR, live count, arrivals. **Click once for sound**, and connect it to the room's speakers: it carries the music. Press **F** for fullscreen. |
| Operator | `/sail/?view=host&token=HOST_TOKEN` | Start, boats needed, Open now, Reset. Works on a phone. |

`HOST_TOKEN` is `SAIL_TOKEN` on the Render service, or `ANALYTICS_TOKEN` if that isn't set.

## Before the event

1. **Deploy the server.** The race runs on the presence server (`server/sail.js`), so Render needs this code as well as Netlify.
2. **Set `SAIL_TOKEN` on Render** to something private. Without it, the host token falls back to the analytics token, whose default (`gmc-dev`) is in this repository.
3. **Rehearse with bots.** Anyone can do this on the real site:
   ```
   npm run sail:bots -- 30 wss://gmc-presence.onrender.com/presence
   ```
   Then press Start on the host panel. Press Reset afterwards, or the bots stay in the count until you do.
4. **Test on the venue's Wi-Fi with real phones**, not only a laptop.

## On the day

1. **At least 10 minutes before:** open the LED and host pages. Render's free plan sleeps when idle and takes up to a minute to wake, and an open page keeps it awake. The host panel says "No server" until it connects.
2. Show the LED. People scan the QR and their boats appear in the harbor. Watch **Boats online**.
3. Set **Boats needed to open**. The default is 30. If fewer than that are in the room, lower it before starting.
4. Press **Start the sail**: a 3-2-1 countdown, then everyone sails.
5. When that many boats arrive, the opening plays by itself on every screen, about 11 seconds long. Phones then get a **Learn More** button that goes to the website, and the gong music returns.
6. **Before the cultural performance starts, press "Fade out the sound"** on the host panel. It fades the music and waves on the LED and every phone over 3 seconds, so nothing plays over the performers.

## If something goes wrong

| Problem | Do this |
| --- | --- |
| Not enough boats arrive | Host panel: **Open the marketplace now** (press twice). Or lower the number: the race opens at once if enough boats are already in. |
| The server is unreachable | Click the LED page and press **O**. The opening plays on the LED alone, so the moment still happens in the room. Phones won't play it. **R** clears it. |
| A phone refreshes or loses signal | Nothing to do. It reconnects and keeps its boat and place. |
| Someone joins after the start | They set off from the harbor and can still arrive. |
| Someone joins after the opening | They go straight to the open scene and the Learn More button. |
| The server restarts mid-race | The race state is in memory, so it returns to the harbor. Press Start again. |

LED keyboard, with the token in the URL: **S** start, **O** open now, **R** reset. Any time: **F** fullscreen, **M** mute.

## Changing things

- **The sayings** on the signs: `src/data/sailSayings.json`. `p` is how far along the route (0 to 1) each one appears.
- **Boat, Tutu, lighthouse:** `scripts/build_sail_assets.py`, then `"D:\Lancee_File\blender.exe" -b --python scripts/build_sail_assets.py`.
- **Logotype:** `python scripts/prepare_assets.py sail_logo`, lifted from the photowall art.
- **Opening timing:** the numbers in `src/sail/opening.js`.
- **Music:** `public/sail/music.mp3`, a seamless loop cut from the gong video by `python scripts/prepare_assets.py sail_music`. A different track needs a new loop length: `LOOP_SECONDS` in `src/sail/audio.js` has to match the file.
- **Volumes:** `MUSIC_GAIN` and `WAVE_LEVEL` at the top of `src/sail/audio.js`. Phones play the music at `musicLevel` 0.7 in `playerView.js`, under the LED.

Phones only make sound after a tap, and an iPhone with its silent switch on stays silent, so the LED's speakers are what the room actually hears.

## Testing

- `npm run sail:test`: the race rules, then a real 40-phone race over WebSockets.
- `/sail/?demo=30` (add `&view=led` for the LED): a whole race against 30 bots in the browser, no server needed.
- `node scripts/capture-sail.mjs <folder>`: screenshots of every stage on the real GPU, with the Vite dev server running.
