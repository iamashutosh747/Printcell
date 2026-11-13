# Printcell

Backup of the Print Cell web apps and the database changes behind them. Everything runs on one Supabase project (`csrc-system`) and three Vercel projects behind `ashutosh-sharma.com` subdomains.

| Folder | What it is | Live at | Vercel project |
|---|---|---|---|
| `portal/` | Master login. One sign-in, then open the apps a person may use. Admin pages for people, access and activity. | printcell.ashutosh-sharma.com | `printcell-portal` |
| `dpr/` | Customer dues report (DPR): customers, PDC cheques, sent cheques, PDF/Excel exports. | dpr.ashutosh-sharma.com | `dpr-report` |
| `tasks/` | Compiled Tasks app (no source here). Copied from the live site; `assets/printcell-theme.css` recolours it to the shared light palette. | tasks.ashutosh-sharma.com | `task-list` |
| `supabase/functions/` | The two server functions behind the portal. | Supabase Edge Functions | |
| `supabase/migrations/` | SQL for the DPR table renames, the portal tables and the signed-out lockdown. | Supabase database | |

Both web apps are plain static files: no build step, no dependencies. Deploy a folder as it is.

## How sign-in works

- A person signs in once at the portal with a username and password.
- Each portal person is linked to their existing CSRC account, Tasks account and DPR role (`portal_users` table). The portal shows only the apps they are linked to.
- **Open CSRC / Tasks:** the `portal-launch` function checks the person's access, creates a fresh session for their linked account and sends the browser to the app with that session in the URL hash. The app's Supabase client picks it up on load.
- **Open DPR:** same hand-off, but DPR reads the person's own DPR role (`full`, `pdc` or `agent`, plus export on/off) from `portal_users`. DPR access codes still work.
- `portal-admin` lets portal admins add people, link accounts, set DPR access and reset passwords. It checks the caller is an active admin on every request.
- **Open Coverage** (coverage.ashutosh-sharma.com, the `toner-pilferage` repo): the coverage site has its own accounts and signed cookie. The portal posts the person's own token to the coverage site's `/sso` route, which asks the database who they are there (`portal_coverage_identity`) and sets the normal cookie. Only posts from the portal's address are accepted. This relies on the portal sending `Referrer-Policy: strict-origin` (see `portal/vercel.json`): with `no-referrer` or `same-origin` browsers label the post `Origin: null` and the coverage site correctly refuses it.
- Sign-ins and app opens are logged to `portal_activity` (admins only).

## Deploying

**Portal and DPR:** deploy the `portal/` and `dpr/` folders as separate Vercel projects (Other / no framework, no build command, output = the folder). Each has a `vercel.json` with security headers.

The portal (`printcell-portal`) deploys from this repo's GitHub source. **Always set Root Directory to `portal`** (and `dpr` / `tasks` for those projects) (in the Vercel project settings, or `projectSettings.rootDirectory` in an API deploy). Without it Vercel serves the repo root and the site returns 404.

**Edge functions:** deploy `supabase/functions/portal-admin` and `portal-launch` with `verify_jwt` off. They do their own sign-in checks. They read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase provides to every function automatically.

```bash
supabase functions deploy portal-admin --no-verify-jwt --project-ref fbtddbcypmevfokpiyzo
supabase functions deploy portal-launch --no-verify-jwt --project-ref fbtddbcypmevfokpiyzo
```

**Database:** apply the files in `supabase/migrations/` in order. Earlier history (CSRC tables, Tasks tables and the original DPR setup) is in the Supabase project's migration history and is not duplicated here. Run `supabase db pull` to bring it into this repo.

## Colours

All five apps share one light palette: background `#f6f7f5`, surfaces `#ffffff`, text `#2a2e35`, muted `#697079`, lines `#e6e7e3`, accent blue `#1e7ab0` (hover and text-on-tint `#186a99`, tint `#e7f2f9`), red `#b5434f`, green `#2e7a56`, amber `#8a6608`. CMYK inks for app markers: cyan `#3fa9d8`, magenta `#d95b9b`, yellow `#eec646`, key `#7b808a`.

## Secrets

None are stored in this repo. The Supabase publishable key that appears in the web apps is public by design. It is safe in the browser because row-level security and the lockdown migration stop signed-out visitors reading tables. The service-role key exists only inside Supabase and is never in the code.

## Not included

- **CSRC** source (csrc.ashutosh-sharma.com) lives in its own repo, `csrc`.
- **Tasks** source. Only the compiled build is here (`tasks/`). Colour changes go in `tasks/assets/printcell-theme.css`, never in the hashed bundle files. If the source turns up, move the palette into its `:root` tokens.
- **Coverage** source lives in its own repo, `toner-pilferage` (dashboard in `dashboard/`). The portal needs its `/sso` route.
- The **accounting-sync** project that feeds DPR.
