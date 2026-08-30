# Sandwich Flight Planner v1.2 — Cloudflare Pages + D1 + FlightAware

This is the Cloudflare version of the sandwich-ticket planner. It keeps the v1.1 functionality and replaces Netlify/Postgres with Cloudflare Pages Functions + D1.

## Included

- Original 20 fare searches from the Excel planner
- Original 48 sandwich-ticket permutations
- Unlimited saved fare options per search
- Cash fares
- Points/miles fares + taxes/fees + cents-per-point optimizer value
- Booking optimizer that updates as fares are entered
- Custom one-way/date-pair searches (X1, X2, ...)
- Custom searches participate in the optimizer
- Segment-by-segment flight entry
- FlightAware schedule lookup for far-future published flights
- FlightAware active-flight lookup when the flight is close
- Aircraft type from FlightAware when available
- Airport-specific local departure/arrival times
- Automatic date-change labels
- Layovers calculated from UTC instants, so timezone/date changes do not break the math

---

# ELI5 Cloudflare setup

## 1. Create the D1 database

In Cloudflare:

1. Go to **Workers & Pages**.
2. Open **D1 SQL Database** / **D1**.
3. Click **Create database**.
4. Name it something like `flight-planner-db`.
5. Create it.

You do not need to put the database ID anywhere in this code if you use the dashboard binding steps below.

## 2. Put the schema into D1

This repo contains:

`schema.sql`

Open your new D1 database in Cloudflare, open its SQL/Console area, paste the entire contents of `schema.sql`, and run it once.

That creates and seeds:

- `searches`
- `fare_options`
- `flight_segments`
- `airport_cache`
- `permutations`

After it runs, this query should return `20`:

```sql
SELECT COUNT(*) FROM searches;
```

And this should return `48`:

```sql
SELECT COUNT(*) FROM permutations;
```

The same SQL is also included at `migrations/0001_initial.sql` if you later prefer Wrangler migrations.

## 3. Upload this project to GitHub

Upload the **contents** of this folder/ZIP to the root of a GitHub repo.

The important repo structure is:

```text
public/
  index.html
  app.js
  optimizer.js
  styles.css

functions/
  api/
    state.js
    searches.js
    options.js
    flight-lookup.js
  _lib/
    db.js
    flightaware.js
    http.js
    time.js

schema.sql
package.json
README.md
```

Do not put the FlightAware key into GitHub.

## 4. Create the Cloudflare Pages project

Cloudflare → **Workers & Pages** → **Create** → **Pages** → connect GitHub → choose this repo.

Use:

- **Framework preset:** None
- **Build command:** `exit 0`
- **Build output directory:** `public`
- **Root directory:** leave blank / repo root

Then deploy.

The root `/functions` folder is intentional. Cloudflare Pages automatically maps those files to API routes:

- `/api/state`
- `/api/searches`
- `/api/options`
- `/api/flight-lookup`

## 5. Bind your D1 database to the Pages project

After the Pages project exists:

1. Open the Pages project.
2. Go to **Settings** → **Bindings** (the exact dashboard label can vary slightly).
3. **Add binding**.
4. Choose **D1 database**.
5. Variable/binding name: **`DB`**
6. Select your `flight-planner-db` database.
7. Save.

The name **must be `DB`** because the server code uses `context.env.DB`.

If Cloudflare lets you configure separate Production and Preview bindings, bind `DB` for Production. You can bind the same database for Preview too if you want preview deploys to use your real planner data; otherwise use a separate test D1 database.

## 6. Add the FlightAware API key

Inside the Pages project:

1. Go to **Settings** → **Variables and Secrets**.
2. Click **Add**.
3. Name: **`FLIGHTAWARE_API_KEY`**
4. Value: your FlightAware AeroAPI key
5. Choose **Encrypt / Secret**.
6. Save.

Again, the name must be exactly:

`FLIGHTAWARE_API_KEY`

Do not add quotes around the key.

## 7. Redeploy

After adding the `DB` binding and FlightAware secret, trigger a new production deployment.

Then open your `*.pages.dev` URL.

If the homepage appears but says it cannot load the planner, the usual causes are:

1. `schema.sql` was not run on the D1 database, or
2. the D1 binding is not named exactly `DB`.

If normal planner data loads but flight lookup fails, check `FLIGHTAWARE_API_KEY`.

---

# How the timezone logic works

FlightAware timestamps are treated as UTC instants. The app gets the IANA timezone for each airport and converts each endpoint independently.

For example, JFK → MUC → BOM:

- JFK departure is displayed in `America/New_York`
- MUC arrival is displayed in `Europe/Berlin`
- MUC onward departure is displayed in `Europe/Berlin`
- BOM arrival is displayed in `Asia/Kolkata`

The layover is **not** calculated from the displayed clock times. It is calculated from:

`next scheduled_out_utc - previous scheduled_in_utc`

That is why DST, date changes, and India's half-hour timezone do not break the result.

For far-future flights, the app queries FlightAware's schedules endpoint with a wider date window, localizes candidate departures to the origin airport, and only accepts the result whose **origin-local departure date** matches the date you entered.

Passenger-facing IATA flight numbers (for example `LH413`) are translated to
the ICAO operator code required by the schedules endpoint (`DLH413`). Enter the
flight number shown on the ticket; either form is accepted for supported major
airlines.

---

# Local testing (optional)

You do not need this to deploy through GitHub/Cloudflare.

The repo includes unit tests for the timezone and optimizer math:

```bash
npm install
npm test
npm run check
```

For Pages + D1 local development, Cloudflare requires a Wrangler configuration with the D1 binding. The production setup above intentionally uses dashboard bindings so you do not have to paste your D1 database ID into the repository.

Never commit `.dev.vars` or `.env` files containing your FlightAware key.
