# The commitment wall: running it

People scan a QR code and write what they commit to. Their commitments appear on the big screen
through the day. At the close, the wall comes apart into words, the words form the bulb, and the
bulb lights up the room: on the screen and on every phone.

## The three screens

| Who | Open this | What it does |
| --- | --- | --- |
| Everyone | `/commit/` (the QR on the wall) | Write a commitment. Up to 3 each, 120 characters each. |
| Big screen | `/commit/?view=wall&token=HOST_TOKEN` | The commitments and the QR. **Click once for sound.** F for fullscreen. |
| Moderator | `/commit/?view=admin&token=HOST_TOKEN` | Approve and remove commitments, start the finale. Works on a phone or laptop. |

`HOST_TOKEN` is the same `SAIL_TOKEN` as the sailing opening. Share these two links only with staff.

## Before the event

0. **Check the server knows the wall.** `https://gmc-presence.onrender.com/health` must show a `"commit"` section. If it doesn't, the `gmc-presence` service on Render is still deploying the older `youth-innovations-marketplace` repository: connect it to `gmc-diplomatic-hall` (branch `main`, start command `node server/presence.js`) and redeploy. The moderator panel says "Old server" when this is the problem.
1. **Create the database table, or commitments can be lost.** Render wipes its disk on every restart. In Supabase, open the SQL Editor and run the "Live commitment wall" part of `server/schema.sql`, then restart the Render service. The moderator panel shows a red warning until this is working.
2. **Agree who moderates.** Someone needs to be on the panel for the whole time the wall is open, and they need the Safeguarding Team's contact (see below). Have a second person ready for busy moments.
3. **Rehearse, then clear.** `npm run commit:bots -- 60 wss://gmc-presence.onrender.com/presence` posts made-up commitments. Afterwards press **Clear everything** on the moderator panel, so rehearsal words can't end up in the real bulb.

## During the day

- By default **a person reads every commitment before it shows**. The writer sees "Our team is reading it", then "On the wall".
- **Approve all waiting** is there for busy moments, and it skips anything marked in red. Those must be read one at a time.
- **Remove** deletes for good, as the safeguarding plan requires for personal information. Use it if anything on the wall names or identifies someone.
- Untick **Read everything before it shows** only if you decide to trust the automatic screen. Red-marked commitments are still held.

### What the automatic screen does

| Result | When | What happens |
| --- | --- | --- |
| Refused | Profanity, or phone numbers, emails, links, handles | Never stored. The writer is asked to rephrase. |
| Marked in red | Sensitive words ("abuse", "sexual") or something that reads like a personal disclosure | Always held for a person. These words are often legitimate here. |
| Passed | Everything else | Waits for the moderator, or shows, depending on the setting above. |

It is a first pass in English and Filipino, not a guarantee. Clever spelling and other languages will get through, which is why a person reads by default. The word lists are in `src/commit/moderate.js`.

### If a commitment looks like someone asking for help

A red note saying "May be someone disclosing harm" means exactly that. **Tell the Safeguarding Team straight away, with the wording and the time.** Commitments are anonymous, so the moderator can't see who wrote it, and the team can decide what to do in the room. Don't approve it. Remove it once the team has what they need.

## The finale (at the very end of the program)

1. Keep the wall on screen and make sure the page has been **clicked once** for sound. Connect it to the room's speakers.
2. Ask people to get their phones out and open the commitment page, because the phones are part of it.
3. On the moderator panel, press **Start the finale** twice. Anything still waiting is left out, so approve or remove the queue first.

About 30 seconds, on every screen at once:

| Time | What happens |
| --- | --- |
| 0 s | "Today, you made 128 commitments." The cards glow. |
| 5 s | "Each one is a light." The cards come apart and the words lift off. Commitments not showing sweep in from the edges. Phones say "Hold your phone up high". |
| 10 s | "Together, they made this marketplace." The words finish forming the bulb. |
| 15 s | The bulb flickers. |
| 16.5 s | **It catches.** Rays, the sea turns to dawn, and every phone lights up. |
| 24 s | The logo writes on. |
| 26.5 s | "has come to a close." "128 commitments. One light. Thank you." Confetti, music. |

It stays on that last picture until reset, and the wall stays closed to new commitments.

## If something goes wrong

| Problem | Do this |
| --- | --- |
| Something inappropriate is on the wall | **Remove**, press twice. It goes from every screen at once, even mid-finale. |
| The server is unreachable at the finale | Click the wall and press **E**. It plays there from the commitments that screen last saw. Phones won't light up. **R** clears it. |
| The finale started by mistake | **Reset the finale**, press twice. Nothing is deleted. |
| A phone loses signal while posting | Nothing to do. It sends when it reconnects, and can't post the same words twice. |
| Few commitments | The words repeat to fill the bulb, so it still looks whole. |

Wall keyboard, with the token in the URL: **E** finale, **R** reset. Any time: **F** fullscreen, **M** mute.

## Changing things

- **The words on screen:** `captions` and `closingLines` in `src/commit/timeline.js`. The timing is in the same file.
- **The phone page's words:** the top of `src/commit/phoneView.js`.

## Testing

- `npm run commit:test`: the screening, who can see what, the bulb layout, and a real server restart.
- `/commit/?view=wall&demo=150`: the wall with made-up commitments and no server. Press **Play the finale** on the screen, and **Back to the wall** to replay it. `/commit/?view=admin&demo=8&token=demo` for the panel.
- `node scripts/capture-commit.mjs <folder> <url>`: screenshots of every stage on the real GPU.
