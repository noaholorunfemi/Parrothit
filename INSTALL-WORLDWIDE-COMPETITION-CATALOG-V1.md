# PARROTHIT Worldwide Competition Catalogue + Competition Image Fix (v1)

This is an incremental patch based on `PARROTHIT-livescore-provider-pipeline-patch.zip`. It changes only LiveScore visitor assets, Football Automation Room catalogue controls, two football Edge Functions, and an additive Supabase migration. It does not replace the PARROTHIT project or alter Newsroom Automation.

## What this patch adds

- A separate worldwide competition catalogue, independent of the fixtures returned for the current date.
- A country-grouped competition dropdown plus a search box for competition, cup, league, and country names.
- Competition IDs, type, country metadata, seasons, coverage and logo URLs stored in Supabase.
- Admin-side **Synchronize competitions** action in Football Automation Room → LiveScore Management.
- Match normalization that preserves competition IDs and logo fields and enriches results from the stored catalogue.
- Competition logos in visitor result groups and match-centre headings. Failed or unavailable images fall back to a text crest rather than a broken-image icon.
- Provider-specific behavior: API-Football uses its `/leagues` catalogue; football-data.org uses `/v4/competitions`; OpenLigaDB uses its available-leagues endpoint (which is not worldwide); custom providers can supply a `competitions` endpoint and mapping.

## Deployment steps

1. **Run the SQL migration first.** Open Supabase → SQL Editor and run `supabase/livescore-worldwide-competitions-v1.sql`. This migration depends on the existing `football_api_configs` table created by the Football Automation Room provider migrations.
2. **Deploy both updated Edge Functions.** Deploy `supabase/functions/football-automation-room/index.ts` as `football-automation-room` and `supabase/functions/parrothit-football-public/index.ts` as `parrothit-football-public`. Keep the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `FOOTBALL_API_ENCRYPTION_KEY` secrets configured.
3. **Upload the website files** in this ZIP to the matching paths in the PARROTHIT project root, overwriting only the included files.
4. Open **Admin → Football Automation Room → LiveScore Management**. In **Worldwide competition catalogue**, select an enabled provider and click **Synchronize competitions**. For the broadest country/league/cup catalogue in this integration, choose your API-Football / API-Sports configuration and ensure its API key is saved.
5. Open `livescore.html`. The competition selector should show the synchronized catalogue grouped by country. Use **Find a competition** to search. Select **All competitions** to show the active provider's matches across all available competitions.

## Important provider coverage limits

The catalogue is the list available from the selected provider, not a promise that every football competition worldwide has data. API-Football's official `/leagues` endpoint documents a catalogue of leagues and cups and supplies competition IDs, logos, seasons and coverage metadata. Its guide describes more than 1,200 competitions; fixture/live-score availability and individual data features still vary by competition, season and subscription plan. OpenLigaDB and football-data.org provide narrower provider-specific lists. When an image is absent or its host fails, PARROTHIT shows the competition initials fallback.

The official API documentation recommends storing/caching logo data to avoid delaying the visitor experience. This patch stores logo URLs and competition metadata in Supabase; the browser does not call the provider API or expose its API key.

## Notes

- Sync the catalogue again after changing the active provider, or when the provider adds new competitions/seasons.
- The public dropdown uses the catalogue belonging to the **currently active provider**. Synchronizing a different provider does not change which provider serves the public match feed. Activate that provider separately if you want its competitions and results on the public page.
- If the dropdown remains empty, check that the SQL migration ran successfully, both Edge Functions are deployed, the provider is enabled, and the sync action reports a non-zero count.
- No actual provider account or Supabase project has been accessed from this patch-building environment, so the live API sync must be verified after deployment.
