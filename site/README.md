# CareerFlow landing site

A static marketing page for showing the project publicly without opening the app: hero
animation, a recorded walkthrough, a swipeable tour of the workbench and a waitlist form.
No backend; any static host works.

## Rebuild the screenshots and the walkthrough video

The pictures and `assets/demo.mp4` are recorded from the real app in fixture mode, with a
fictional candidate and demo roles. Nothing is read from a real account.

```bash
PORT=8792 LOCAL_DB_PORT=55442 LOCAL_DB_DIR=.runtime/pglite-site APP_ORIGIN=http://localhost:8792 \
  PROVIDER_MODE=fixture JOB_SOURCE=fixtures OPENAI_API_KEY= OPENAI_NATIVE_API_KEY= \
  LANGSMITH_TRACING=false node scripts/local-run.mjs
npx playwright test -c site/record/playwright.config.ts
ffmpeg -y -i .runtime/site-record/*/video.webm -c:v libx264 -pix_fmt yuv420p \
  -movflags +faststart -crf 26 site/assets/demo.mp4
```

## Waitlist

`WAITLIST_ENDPOINT` in `index.html` is empty, so the form says plainly that nothing was sent.
Point it at a form service (Formspree, Tally, Basin) or a small serverless function to collect
addresses.

## Preview

```bash
python3 -m http.server 8793 --directory site
```
