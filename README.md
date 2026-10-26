<p align="center"><img src="public/logo.png" width="120" alt=""></p>

# Mnemo

A personal AI study app. Drop in course material (slides, PDFs, photos of notes, lecture
recordings, YouTube links) and Mnemo turns it into a study kit:

- **Smart Study**: adaptive multiple-choice and true/false questions that target your weakest
  concepts. When you get one wrong, it nudges you with a hint before showing the answer. You can
  steer it ("focus on chapter 3"), pick a difficulty (Gentle, Balanced, Push me), and report a
  question that's wrong: it's never asked again, the answer doesn't count, and new questions are
  told to avoid the mistake.
- **Difficulty that follows you**: each concept has a level that climbs a little with every
  first-try right answer and drops a level on a miss, sized so it settles where you get about 9, 8
  or 6–7 in 10 right (the setting). A run of misses eases everything off for a while.
- **Chemistry drawn, not described**: molecules are drawn from SMILES with RDKit (in the browser),
  including stereochemistry, and tap to enlarge with the formula. Before anything generated is
  saved, every named structure is looked up on PubChem (or parsed by OPSIN) and compared with what
  Gemini drew; a question whose structure contradicts its name is dropped. "Major product" questions
  have structures as the options. Equations render with mhchem (`\ce{…}`).
- **Reaction sheet** (organic chemistry kits): every reaction in the material with the starting
  material and product drawn, reagents, regio- and stereochemistry, mechanism and the catch, turned
  into flashcards both ways round on request.
- **Calculations the app checks**: in kits that teach calculations (D-values, generation times),
  Gemini sets the problem and writes the arithmetic; the app works out the answer, drops questions
  whose own answer disagrees, and grades what you type within 2%.
- **Your slides, kept**: the pages of PDFs and photos are kept on the device, and a missed question
  shows the slide it came from.
- **Diagram cards** (image occlusion): Gemini finds the labelled diagrams on your slides and where
  each label sits; every label becomes a card that hides it.
- **Subject-aware**: each kit knows its subject (biology, organic chemistry, biochemistry,
  chemistry) and asks the kinds of questions that subject's exams ask.
- **Short answers**: the same adaptive engine, but written answers graded by AI, in their own
  section so they don't interrupt a quick multiple-choice session.
- **Flashcards** with FSRS spaced repetition, plus editing and AI top-ups.
- **Practice tests**: exam-style, optionally timed, with short answers graded by AI.
- **Study guides and summaries** you can print to PDF or download as Markdown.
- **Podcasts**: two hosts talk through your material, generated with Gemini TTS.
- **Games**: Definition Match, Term Builder and Stacker, built from your flashcards.
- **Explain it back**: teach a concept out loud from memory (your keyboard's dictation, so it's
  free). Mnemo checks it against the material and lists what you covered, skipped, or got wrong.
- **Tutor**: chat about the material, Socratic by default.
- **Exam date and daily quota**: set the exam date and Mnemo works out, from the spaced-repetition
  state of every concept, how many questions a day keep you above 90% recall on exam day. The
  kit shows today's quota and whether you're on pace; Progress shows the forgetting curve from
  today to the exam and the concepts most at risk. All computed on the device, no API calls.
- **Progress**: mastery per concept, streaks, test history.
- **Sync** across phone, tablet and laptop with a sync code, end-to-end encrypted.
- Any of 60+ languages per kit, folders, light/dark mode, installable as a phone app (PWA).

**Live at <https://mnemo-iota.vercel.app>.** No accounts. The app runs in the browser, keeps
everything in IndexedDB, and calls the Gemini API directly with your own key. The only server
piece is a tiny sync endpoint that stores encrypted blobs it can't read. Chemistry kits also look
compound names (only the names Gemini wrote, never your material) up on PubChem and OPSIN.

> Inspired by [Thea](https://www.theastudy.com/). Not affiliated with it, and none of its code or
> assets are used.

## Using it

1. Open the site, go to **Settings**, and paste a Gemini API key from
   <https://aistudio.google.com/apikey>.
2. **New kit** → add material → **Build study kit**.

**More than one device:** on the first one, **Settings → Sync across devices → Turn on sync**,
then copy the sync code. On each other device, open the site (on iPhone/iPad: Share → Add to Home
Screen first, then open it from there), go to **Settings → I have a sync code**, and paste it.
The API key comes along, so there's nothing else to set up.

How sync works: the code never leaves the device. A vault id and an AES-256-GCM key are derived
from it (HKDF); the device uploads a gzipped, encrypted snapshot to `/api/sync`, which keeps it in
private Vercel Blob storage. Every local change is stamped, merges keep the newest version of each
item, deletions travel as tombstones, and uploads are compare-and-swap on the blob's ETag, so two
devices saving at once can't overwrite each other. Podcast audio isn't synced (too big); other
devices can record their own copy from the synced script.

## Cost

Free on a free-tier Gemini key, or roughly **$1.50–9/month** with billing enabled for daily use
(a live run of every feature once cost $0.17).
**Settings → API spending** tracks actual spend per feature from Gemini's own token counts. The
full breakdown is in [docs/COSTS.md](docs/COSTS.md).

## How it works

```
file / link / notes ──► ingest once ──► Markdown text (IndexedDB)
                         │  PDF, DOCX, PPTX, text: extracted locally (free)
                         │  scans, images, audio, video, YouTube, web: Gemini
                         ▼
                 concept map (5–30 concepts)
                         ▼
   flashcards · questions · guides · podcast · tutor   ◄── every prompt is [material][task]
                         ▼                                  so repeat calls hit Gemini's cache
   FSRS scheduling per card and per concept ──► Smart Study picks due/weak concepts next
```

| Path                     | What                                                   |
| ------------------------ | ------------------------------------------------------ |
| `src/lib/gemini.ts`      | Gemini client: retries, model fallback, cost logging   |
| `src/lib/prompts.ts`     | Every prompt and JSON schema                           |
| `src/lib/ingest.ts`      | Turning sources into text                              |
| `src/lib/study.ts`       | Kit building and each generator                        |
| `src/lib/smart.ts`       | Adaptive question selection, mastery and difficulty    |
| `src/lib/chem.ts`        | RDKit drawing; checking structures against PubChem/OPSIN |
| `src/lib/mol.ts`         | Structure tokens `{{mol:SMILES\|name}}`                |
| `src/lib/calc.ts`        | Evaluating and checking calculation questions          |
| `src/lib/pages.ts`       | Kept page images and finding a question's slide        |
| `src/lib/figures.ts`     | Diagram cards (image occlusion)                        |
| `src/lib/plan.ts`        | Exam-date planning: daily quota, exam-day forecast     |
| `src/lib/pricing.ts`     | Price table and per-call cost                          |
| `src/lib/sync.ts`        | Change tracking, merge, and the sync loop              |
| `src/lib/crypto.ts`      | Sync code, key derivation, encryption                  |
| `api/sync.ts`            | The sync endpoint (Vercel Function + Blob)             |
| `src/pages/`             | One file per screen                                    |

## Future additions

Ideas that fit the "learning data, not more API calls" direction, in rough order:

- **Confidence calibration.** Occasionally (never every question: only on concepts that look
  strong, at most one in five, never twice on a concept in a session) ask "how sure are you?"
  before revealing the answer. Plot stated confidence against actual accuracy and surface the
  concepts she is confidently wrong about.
- **Study reminders.** A browser can't schedule a notification for tomorrow on its own, so this
  needs Web Push: the device would store its push subscription, a nudge time and a pre-written
  one-line message ("12 due, exam in 9 days") next to its encrypted blob, and a daily cron would
  forward it. The plan itself stays on the device. A calendar export (`.ics` with alarms) of the
  daily quota is the zero-server alternative.
- **Fatigue detection.** Accuracy and hint use over the minutes of a session, against her own
  baseline, with a "you're past your peak, stop here" nudge. Time-of-day accuracy across sessions.
- **Honest streaks.** Count a day only when the due reviews got done, with one freeze a week.
- **Error-driven cram sheet.** The night before, a one-pager built only from the concepts with
  the lowest predicted exam-day recall.
- **"Why this question".** One line under each Smart Study question: due for review, weak, or
  new material being interleaved.

## Development

Needs Node 24. Tasks are in the `justfile`:

```sh
just install   # npm ci
just dev       # http://localhost:5173
just test      # unit tests
just build     # typecheck + production build
just smoke     # live run of every feature against Gemini; needs GEMINI_API_KEY in .env
```

`node scripts/e2e.mjs <url>` drives every screen in headless Chromium with Gemini, PubChem and
OPSIN mocked, including two browser profiles pairing through sync, an organic chemistry kit and a
lecture PDF turned into diagram cards (`npx playwright install chromium` once; `E2E_REAL_SYNC=1`
uses the real `/api/sync`; `E2E_ONLY=chem|slides|retry|sync` runs one part;
`E2E_ENGINE=webkit` runs it in WebKit). `SMOKE_FILE=scripts/chem.smoke.test.ts just smoke` checks
the organic chemistry path live (about $0.04), and `node scripts/real-slides.mjs <url> <pdf>...`
runs the slide features on real PDFs. `node scripts/real-study.mjs <url> <pdf>...` runs a
real Smart Study session with real Gemini and dumps the questions and costs to `scratch/real/`.

Hosted on Vercel (connected to this repo: every push to `main` deploys). Sync needs a private
Vercel Blob store connected to the project; `npx vercel storage create <name> --type blob
--access private` and `npx vercel storage connect <name>` set that up. GitHub Actions runs the
tests and build on each push.
