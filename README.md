# TRA Car Duty Calculator

Enter a **chassis initial** (e.g. `ACU30`) and a **year** (e.g. `2012`). The app finds the
vehicle in the Tanzania Revenue Authority UMVVS calculator and shows the same
"Vehicle details" popup as https://taxpayerportal.tra.go.tz/#/umvvs/calculator.

When TRA lists more than one option for a step (several models share the chassis code,
or several countries, fuel types or engine sizes), a dropdown appears so you can pick one.

## How it works

```
public/        the page (index.html, style.css, app.js), served as static files
api/duty.js    Vercel serverless function: GET /api/duty?chassis=ACU30&year=2012
lib/tra.js     calls the TRA API: getMakes → getModelBody → getYom →
               getCountryOfOrigin → getFuelType → getEngineCapacity → getVehicleDetails
dev-server.js  run the app locally without the Vercel CLI
```

The browser can't call TRA directly (CORS), so the serverless function does it.
To find the make, it searches every make's model list for the chassis code
(Toyota, Nissan, Honda and other common makes first). Lists are cached in memory while the
function stays warm, so the first search is the slowest.

`/api/duty` returns one of:
- `{"status":"ok","details":{...TRA fields...}}`
- `{"status":"choose","step":"fuel","label":"Energy Type","options":[{"value":"PETROL","label":"PETROL"}, ...]}`
  (call again with `&fuel=PETROL`; the other steps are `model`, `country`, `engine`)
- `{"status":"error","message":"..."}` (for an unlisted year it also returns the years TRA has)

## Deploy to Vercel

No build step and no npm packages are needed.

**From GitHub (easiest)**
1. Push this folder to a GitHub repository.
2. On https://vercel.com/new, import the repository.
3. Leave Framework Preset as **Other**, and leave build and output settings empty. Click **Deploy**.

**From your computer with the Vercel CLI**
```bash
npm i -g vercel
cd vercel-app
vercel          # first time: answer the prompts, accept the defaults
vercel --prod   # deploy to production
```

## Run locally

```bash
node dev-server.js      # Node 18 or newer
# open http://localhost:3000
```

## Notes

- `vercel.json` gives the function up to 60 seconds, which covers a first search across all makes.
- If TRA ever blocks requests from Vercel's default (US) region, set the function region near
  Tanzania by adding `"regions": ["cpt1"]` (Cape Town) to `vercel.json`.
- `TRA_API_BASE` (environment variable) overrides the TRA API address, for testing.
- Figures are TRA's own estimates for the current valuation quarter, as shown on their site.
