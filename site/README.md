# CareerFlow landing site

A static marketing page for showing the project publicly without opening the app: hero
animation, a recorded walkthrough, a swipeable tour of the workbench and a waitlist form.
No backend; any static host works.

## Rebuild the screenshots and the walkthrough video

The pictures and `assets/demo.mp4` are recorded from the real app in fixture mode, with a
fictional candidate and demo roles. Nothing is read from a real account. The recording draws a
caption for each step and a cursor, and writes the step times to `assets/demo-chapters.json` for
the chapter buttons under the video. The live-call picture comes from a second window that plays
scripted realtime events, as in the browser tests; it is not part of the video.

```bash
PORT=8792 LOCAL_DB_PORT=55442 LOCAL_DB_DIR=.runtime/pglite-site APP_ORIGIN=http://localhost:8792 \
  PROVIDER_MODE=fixture JOB_SOURCE=fixtures OPENAI_API_KEY= OPENAI_NATIVE_API_KEY= \
  LANGSMITH_TRACING=false node scripts/local-run.mjs
npx playwright test -c site/record/playwright.config.ts
ffmpeg -y -i .runtime/site-record/*/video.webm -c:v libx264 -pix_fmt yuv420p \
  -movflags +faststart -crf 27 -preset slow site/assets/demo.mp4
```

## Party and chapters

The Meet your party section uses the app's own agent faces and rules. After changing them, or
after a new recording, refresh the data in the page:

```bash
npx tsx site/record/party-export.tsx > site/assets/party.json
node site/record/inline-data.mjs
```

## Languages

The page is in English and Chinese; the button in the top bar switches between them. The first
visit follows the browser language, the choice is remembered in the browser, and `?lang=zh` or
`?lang=en` in the address forces one.

English is the text in `index.html` itself. Each translated element carries a `data-i18n` key
(`data-i18n-alt`, `data-i18n-aria-label` and so on for attributes), and the Chinese for that key
is in `STR.zh` in the page script. When you add or change text, add the key and its Chinese
there. Agent names, rules and video chapter labels come from the exported data; their Chinese
is in `DATA_ZH`, keyed by the English text, so new entries show in English until they are added.
The screenshots and the video stay in English.

## Publish

GitHub Pages serves the `gh-pages` branch: copy `index.html` and `assets/` there and push.

## Waitlist

`WAITLIST_ENDPOINT` in `index.html` is empty, so the form points people to the contact email.
Point it at a form service (Formspree, Tally, Basin) or a small serverless function to collect
addresses.

## Preview

```bash
python3 -m http.server 8793 --directory site
```
