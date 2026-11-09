# Sail to the Lighthouse: running the opening

A digital opening instead of a ribbon cutting, in two parts. Everyone in the room scans a QR code,
names a boat and races Tutu to the lighthouse on their phone. The first boat there wins, and the
screens ask whether that boat can change the world alone. It can't: everyone taps their phone to
light the lighthouse together. When it is lit, the bulb rises out of it, the marketplace opens on
every screen, and the partners' logos follow.

## The three screens

| Who | Open this | What it does |
| --- | --- | --- |
| Everyone | `/sail/` (the QR on the LED) | Name your boat, then tap anywhere to sail. Four taps a second is full speed: about 30 seconds. Later, tap to light the lighthouse. |
| LED wall | `/sail/?view=led&token=HOST_TOKEN` | Names as boats join, the fleet, the challenge, the energy meter, the opening and the partners. **Click once for sound**, and connect it to the room's speakers: it carries the music. Press **F** for fullscreen. |
| Operator | `/sail/?view=host&token=HOST_TOKEN` | Opening style, Start, Light the lighthouse, Finish lighting now, Skip to the opening, Fade out, Reset, and Hide for any boat name. Works on a phone. |

`HOST_TOKEN` is `SAIL_TOKEN` on the Render service, or `ANALYTICS_TOKEN` if that isn't set.

## Before the event

1. **Deploy the server.** The race runs on the presence server (`server/sail.js`), so Render needs this code as well as Netlify.
2. **Set `SAIL_TOKEN` on Render** to something private. Without it, the host token falls back to the analytics token, whose default (`gmc-dev`) is in this repository.
3. **Rehearse with bots.** Anyone can do this on the real site:
   ```
   npm run sail:bots -- 30 wss://gmc-presence.onrender.com/presence
   ```
   The bots name their boats, sail when you press Start, and tap when you press Light the lighthouse. Press Reset afterwards.
4. **Test on the venue's Wi-Fi with real phones**, not only a laptop.

## On the day

1. **At least 10 minutes before:** open the LED and operator screens. Render's free plan sleeps when idle and takes up to a minute to wake, and an open page keeps it awake.
2. Show the LED. People scan the QR and name their boats; the names appear on the LED. **Watch the names on the operator panel** and press **Hide** (twice) on any you don't want on the big screen. It becomes "Boat 12" everywhere.
3. Press **Start the sail**: a 3-2-1 countdown, then everyone taps to sail. The race takes about 30 seconds at full tapping speed. On the LED the leading boats carry their place and name, and a **Leaders** board shows the top five; on each phone, the boats sailing near yours show their names.
4. **The first boat to the lighthouse wins.** The lighthouse goes dark, and the screens say "*Boat* reached the lighthouse first!", then "Can *Boat* change the world alone?" **This is the host's moment: work the room.**
5. Press **Light the lighthouse**. The screens say "No one can. Let's light it together.", count down 3-2-1, then everyone taps. The energy meter fills and the lantern grows brighter. It needs about 60 taps per boat online, so about 8 to 15 seconds of the room tapping. If it drags, press **Finish lighting now** (twice).
6. When it is lit, the opening plays by itself on every screen, about 11 seconds: the bulb rises out of the lighthouse, catches, the rays burst and the logo writes on, "IS NOW OPEN!". Phones then say "You are part of the solution. Welcome to the Youth Innovations Marketplace." with a **Learn More** button to the website. The partners' logos rise on the LED after it.
7. **Before the cultural performance starts, press "Fade out the sound"**. It fades the music and waves on the LED and every phone over 3 seconds.

### The classic opening (fallback)

If the two-part opening isn't working out, choose **Classic** on the operator panel while still in the harbor. Then it is the opening as first built: no winner and no tapping to light, and the opening plays when **Boats needed to open** have reached the lighthouse (30 by default).

## If something goes wrong

| Problem | Do this |
| --- | --- |
| A name shouldn't be on screen | Operator panel, **Hide**, press twice. |
| The room is slow to light it | **Finish lighting now**, press twice. |
| You need to skip ahead | **Skip to the opening now**, press twice. It works at any stage. |
| The server is unreachable | Click the LED page and press **O**. The opening plays on the LED alone, so the moment still happens in the room. Phones won't play it. **R** clears it. |
| A phone refreshes or loses signal | Nothing to do. It reconnects and keeps its boat, name and place. |
| Someone joins late | They name a boat and join in, and can still tap to light the lighthouse. |
| The server restarts mid-race | The race state is in memory, so it returns to the harbor. Press Start again. |

LED keyboard, with the token in the URL: **S** start, **L** light the lighthouse, **O** open now, **R** reset. Any time: **F** fullscreen, **M** mute.

## Changing things

- **The words on screen:** `LINES` in `src/sail/together.js`. The ready-made boat names are in `src/sail/boatNames.js`.
- **How much tapping it takes:** `TAPS_EACH` (per boat online) and `MIN_ENERGY` in `src/sail/raceHub.js`.
- **Which boat names are refused:** `screenName` in `src/commit/moderate.js`, which shares its word lists with the Commitment Wall.
- **The partners' logos:** `public/sail/partners/`, cut from `Organizer and Support Logo.png`; the order is in `src/sail/together.js`.
- **The sayings** on the signs: `src/data/sailSayings.json`. `p` is how far along the route (0 to 1) each one appears.
- **Boat, Tutu, lighthouse:** `scripts/build_sail_assets.py`, then `"D:\Lancee_File\blender.exe" -b --python scripts/build_sail_assets.py`.
- **Opening timing:** the numbers in `src/sail/opening.js`.
- **Music:** `public/sail/music.mp3`, a seamless loop cut from the gong video by `python scripts/prepare_assets.py sail_music`. A different track needs a new loop length: `LOOP_SECONDS` in `src/sail/audio.js` has to match the file.
- **Volumes:** `MUSIC_GAIN` and `WAVE_LEVEL` at the top of `src/sail/audio.js`.

Phones only make sound after a tap, and an iPhone with its silent switch on stays silent, so the LED's speakers are what the room actually hears.

## Testing

- `npm run sail:test`: the race rules, boat names, the challenge and the lighting, the classic fallback, then the whole two-part opening with 40 phones over WebSockets.
- `/sail/?demo=30` (add `&view=led` for the LED): the whole thing against 30 bots in the browser, with no server. The demo presses Light the lighthouse for you after a few seconds; add `&hold` to press the buttons yourself, or `&mode=classic` for the fallback.
- `node scripts/capture-sail.mjs <folder> <url>`: screenshots of every stage on the real GPU, with the Vite dev server running.
