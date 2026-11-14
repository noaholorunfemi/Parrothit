/* PARROTHIT LiveScore: 50 curated football highlights discovery presets.
   Presets point to public publisher channels/search pages, not embedded player IDs.
   Admin must select an individual public video or playlist and test embedding before activation. */
(function(){
  'use strict';
  window.PARROTHIT_HIGHLIGHT_PRESETS = [
  {
    "key": "fifa",
    "name": "FIFA Football Highlights",
    "category": "International Football",
    "discovery_url": "https://www.youtube.com/results?search_query=FIFA+official+football+highlights",
    "description": "World football highlights, FIFA tournament clips, archive moments and official features."
  },
  {
    "key": "uefa",
    "name": "UEFA Football Highlights",
    "category": "UEFA Football",
    "discovery_url": "https://www.youtube.com/@uefa",
    "description": "UEFA official channel: highlights and features across European football."
  },
  {
    "key": "uefa-champions-league",
    "name": "UEFA Champions League",
    "category": "UEFA Football",
    "discovery_url": "https://www.youtube.com/results?search_query=UEFA+Champions+League+official+highlights",
    "description": "Champions League match highlights and competition features."
  },
  {
    "key": "uefa-europa-league",
    "name": "UEFA Europa League",
    "category": "UEFA Football",
    "discovery_url": "https://www.youtube.com/results?search_query=UEFA+Europa+League+official+highlights",
    "description": "Europa League match highlights and competition features."
  },
  {
    "key": "conmebol",
    "name": "CONMEBOL Football",
    "category": "South American Football",
    "discovery_url": "https://www.youtube.com/results?search_query=CONMEBOL+official+football+highlights",
    "description": "South American national-team and competition highlights."
  },
  {
    "key": "conmebol-libertadores",
    "name": "CONMEBOL Libertadores",
    "category": "South American Football",
    "discovery_url": "https://www.youtube.com/results?search_query=CONMEBOL+Libertadores+official+highlights",
    "description": "Copa Libertadores official match highlights and recaps."
  },
  {
    "key": "concacaf",
    "name": "Concacaf Football",
    "category": "North & Central American Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Concacaf+official+football+highlights",
    "description": "Gold Cup, Nations League and regional competition highlights."
  },
  {
    "key": "caf",
    "name": "CAF Football",
    "category": "African Football",
    "discovery_url": "https://www.youtube.com/results?search_query=CAF+official+football+highlights",
    "description": "African national-team and club competition highlights. Check official CAF publisher identity."
  },
  {
    "key": "afc",
    "name": "Asian Football Confederation",
    "category": "Asian Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Asian+Football+Confederation+official+highlights",
    "description": "Asian national-team and club competition highlights."
  },
  {
    "key": "the-fa",
    "name": "The FA Football",
    "category": "English Football",
    "discovery_url": "https://www.youtube.com/results?search_query=The+FA+official+football+highlights",
    "description": "FA Cup and England football content."
  },
  {
    "key": "premier-league",
    "name": "Premier League Highlights",
    "category": "English Football",
    "discovery_url": "https://www.youtube.com/@premierleague",
    "description": "Premier League official channel and match highlights."
  },
  {
    "key": "efl",
    "name": "English Football League",
    "category": "English Football",
    "discovery_url": "https://www.youtube.com/results?search_query=EFL+official+football+highlights",
    "description": "Championship, League One and League Two content."
  },
  {
    "key": "laliga",
    "name": "LaLiga Highlights",
    "category": "Spanish Football",
    "discovery_url": "https://www.youtube.com/laliga",
    "description": "LaLiga official channel discovery link and match highlights."
  },
  {
    "key": "serie-a",
    "name": "Serie A Highlights",
    "category": "Italian Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Serie+A+official+football+highlights",
    "description": "Italian top-flight league highlights and features."
  },
  {
    "key": "bundesliga",
    "name": "Bundesliga Highlights",
    "category": "German Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Bundesliga+official+football+highlights",
    "description": "German top-flight league highlights and features."
  },
  {
    "key": "ligue-1",
    "name": "Ligue 1 Highlights",
    "category": "French Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Ligue+1+official+football+highlights",
    "description": "French top-flight league highlights and features."
  },
  {
    "key": "eredivisie",
    "name": "Eredivisie Highlights",
    "category": "European Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Eredivisie+official+football+highlights",
    "description": "Dutch top-flight league highlights and features."
  },
  {
    "key": "liga-portugal",
    "name": "Liga Portugal Highlights",
    "category": "European Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Liga+Portugal+official+football+highlights",
    "description": "Portuguese league highlights and features."
  },
  {
    "key": "mls",
    "name": "Major League Soccer",
    "category": "North American Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Major+League+Soccer+official+highlights",
    "description": "MLS match highlights and league features."
  },
  {
    "key": "spfl",
    "name": "Scottish Professional Football League",
    "category": "European Football",
    "discovery_url": "https://www.youtube.com/results?search_query=SPFL+official+football+highlights",
    "description": "Scottish professional football highlights and features."
  },
  {
    "key": "nff",
    "name": "Nigeria Football Federation",
    "category": "Nigerian Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Nigeria+Football+Federation+official+YouTube+highlights",
    "description": "Nigeria national teams and domestic football features. Verify the official publisher channel."
  },
  {
    "key": "england-football",
    "name": "England Football",
    "category": "International Football",
    "discovery_url": "https://www.youtube.com/results?search_query=England+Football+official+YouTube+highlights",
    "description": "England national teams, FA competitions and football features."
  },
  {
    "key": "fff",
    "name": "France Football Federation",
    "category": "International Football",
    "discovery_url": "https://www.youtube.com/results?search_query=FFF+France+Football+Federation+official+YouTube",
    "description": "France national-team official video content."
  },
  {
    "key": "dfb",
    "name": "German Football Association (DFB)",
    "category": "International Football",
    "discovery_url": "https://www.youtube.com/results?search_query=DFB+German+Football+Association+official+YouTube",
    "description": "Germany national teams and DFB competition content."
  },
  {
    "key": "cbf",
    "name": "Brazil Football Confederation (CBF)",
    "category": "International Football",
    "discovery_url": "https://www.youtube.com/results?search_query=CBF+Brazil+Football+official+YouTube",
    "description": "Brazil national-team and federation content."
  },
  {
    "key": "afa",
    "name": "Argentine Football Association (AFA)",
    "category": "International Football",
    "discovery_url": "https://www.youtube.com/results?search_query=AFA+Argentina+Football+official+YouTube",
    "description": "Argentina national-team and federation content."
  },
  {
    "key": "ussoccer",
    "name": "U.S. Soccer",
    "category": "International Football",
    "discovery_url": "https://www.youtube.com/results?search_query=US+Soccer+official+YouTube+highlights",
    "description": "United States national teams and federation content."
  },
  {
    "key": "canada-soccer",
    "name": "Canada Soccer",
    "category": "International Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Canada+Soccer+official+YouTube+highlights",
    "description": "Canada national teams and federation content."
  },
  {
    "key": "ghana-fa",
    "name": "Ghana Football Association",
    "category": "African Football",
    "discovery_url": "https://www.youtube.com/results?search_query=Ghana+Football+Association+official+YouTube",
    "description": "Ghana national teams and federation content."
  },
  {
    "key": "safa",
    "name": "South African Football Association",
    "category": "African Football",
    "discovery_url": "https://www.youtube.com/results?search_query=South+African+Football+Association+official+YouTube",
    "description": "South African national teams and federation content."
  },
  {
    "key": "arsenal",
    "name": "Arsenal FC",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@arsenal",
    "description": "Arsenal official club channel; public highlights and features."
  },
  {
    "key": "man-city",
    "name": "Manchester City",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@mancity",
    "description": "Manchester City official club channel; public highlights and features."
  },
  {
    "key": "man-utd",
    "name": "Manchester United",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@manutd",
    "description": "Manchester United official club channel; public highlights and features."
  },
  {
    "key": "liverpool",
    "name": "Liverpool FC",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@LiverpoolFC",
    "description": "Liverpool official club channel; public highlights and features."
  },
  {
    "key": "chelsea",
    "name": "Chelsea FC",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@chelseafc",
    "description": "Chelsea official club channel; public highlights and features."
  },
  {
    "key": "tottenham",
    "name": "Tottenham Hotspur",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@TottenhamHotspur",
    "description": "Tottenham official club channel; public highlights and features."
  },
  {
    "key": "newcastle",
    "name": "Newcastle United",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@NUFC",
    "description": "Newcastle official club channel; public highlights and features."
  },
  {
    "key": "aston-villa",
    "name": "Aston Villa",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@avfcofficial",
    "description": "Aston Villa official club channel; public highlights and features."
  },
  {
    "key": "brighton",
    "name": "Brighton & Hove Albion",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@officialbhafc",
    "description": "Brighton official club channel; public highlights and features."
  },
  {
    "key": "everton",
    "name": "Everton FC",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@Everton",
    "description": "Everton official club channel; public highlights and features."
  },
  {
    "key": "west-ham",
    "name": "West Ham United",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/results?search_query=West+Ham+United+official+YouTube+channel",
    "description": "West Ham official club channel discovery and public highlights."
  },
  {
    "key": "wolves",
    "name": "Wolverhampton Wanderers",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@OfficialWolvesVideo",
    "description": "Wolves official club channel; public highlights and features."
  },
  {
    "key": "bournemouth",
    "name": "AFC Bournemouth",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@AFCBournemouth",
    "description": "AFC Bournemouth official club channel; public highlights and features."
  },
  {
    "key": "crystal-palace",
    "name": "Crystal Palace",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@OfficialCPFC",
    "description": "Crystal Palace official club channel; public highlights and features."
  },
  {
    "key": "brentford",
    "name": "Brentford FC",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/@BrentfordFC",
    "description": "Brentford official club channel; public highlights and features."
  },
  {
    "key": "barcelona",
    "name": "FC Barcelona",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/results?search_query=FC+Barcelona+official+YouTube+channel+highlights",
    "description": "FC Barcelona official club channel discovery and public highlights."
  },
  {
    "key": "real-madrid",
    "name": "Real Madrid",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/results?search_query=Real+Madrid+official+YouTube+channel+highlights",
    "description": "Real Madrid official club channel discovery and public highlights."
  },
  {
    "key": "atletico-madrid",
    "name": "Atlético de Madrid",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/results?search_query=Atletico+Madrid+official+YouTube+channel+highlights",
    "description": "Atlético de Madrid official club channel discovery and public highlights."
  },
  {
    "key": "bayern",
    "name": "FC Bayern Munich",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/results?search_query=FC+Bayern+Munich+official+YouTube+channel+highlights",
    "description": "FC Bayern official club channel discovery and public highlights."
  },
  {
    "key": "dortmund",
    "name": "Borussia Dortmund",
    "category": "Club Highlights",
    "discovery_url": "https://www.youtube.com/results?search_query=Borussia+Dortmund+official+YouTube+channel+highlights",
    "description": "Borussia Dortmund official club channel discovery and public highlights."
  }
];
})();
