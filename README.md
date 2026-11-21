# Twitch tournament bracket

A userscript that adds a live tournament view to Twitch streams of ongoing esports tournaments. The data comes from [Liquipedia](https://liquipedia.net).

When the stream you are watching belongs to an ongoing tournament, a **Bracket** button appears next to Follow. It shows or hides a floating window that follows the stage being played:

- **Group stages:** standings (with advancing and elimination zones) and the match list with start times.
- **Playoffs:** the bracket with team logos and scores.
- **Tabs** for every stage of the tournament. A red dot marks the stage the stream is on, and the match on stream has a red outline.
- **Drafts:** click a played match to see each game's picks (with Radiant/Dire), bans, length and winner, once Liquipedia has them.
- **This game (Dota 2):** on streams that run the *Dota 2 Tooltips – Tournament Edition* extension, a live tab with the kill score, the net-worth lead and its history, and for each player their position (1–5), hero, level, K/D/A, last hits, net worth, damage and items.

## Install

1. Install a userscript manager such as [Violentmonkey](https://violentmonkey.github.io/) or Tampermonkey.
2. Open [`twitch-tournament-bracket.user.js`](https://github.com/Ephpotle/twitch-tournament-bracket/raw/main/twitch-tournament-bracket.user.js) and confirm the installation.

## Use

- Click **Bracket** next to the Follow button to show or hide the window. The choice is remembered.
- Click a tab to look at another stage. When the stream moves on to a new stage or game, the window follows it again.
- Drag the title bar to move the window; drag the top-left or bottom-right corner to resize it. The content scales to fit. Double-click the title bar to reset size and position.
- Hover a team to highlight it in the bracket, standings and match list.
- The window refreshes every 3 minutes while it is open (the live tab every few seconds). The refresh button in the title bar refreshes on demand.

## How a tournament is detected

The script reads the game category of the stream, loads the list of current matches from the Liquipedia wiki for that game, and shows the button when one of these is true:

1. Liquipedia lists the channel as a stream of a current match.
2. The stream title names both teams of a current match.
3. The stream title contains the tournament name, or the name of its series.

## Limitations

- Tested on Dota 2. Every game with a Liquipedia wiki is mapped (59 wikis, including the alpha wikis, covering about 100 Twitch categories whose names were checked against Twitch), but only Dota 2 has been seen working end to end. Games without a Liquipedia wiki, such as Heroes of Might and Magic, are not supported.
- Liquipedia allows one page request per 30 seconds, so the first view on a new channel can take up to half a minute to appear.
- Drafts appear only after Liquipedia's editors add them, usually shortly after each game.
- The live tab only works on streams running the Dota 2 Tooltips extension. Its data format is undocumented and can change. Player positions come from each team's roster for the tournament on Liquipedia, so a stand-in shows "?".
- The script relies on Twitch page markup and Liquipedia markup, either of which can change.

## Privacy and network access

The script contacts:

- `liquipedia.net`: its API, and team logo images.
- `api.opendota.com`: OpenDota's public list of Dota 2 item names, fetched at most once a week, for item icons.
- `cdn.cloudflare.steamstatic.com`: Valve's hero and item images.

It also runs inside the Dota 2 Tooltips extension's frame on Twitch, where it only passes the extension's public game data to the window; it ignores the extension's login messages. It sends no data anywhere else and has no analytics. Settings and a small cache are kept in the browser local storage for twitch.tv.

## Data and licence

Tournament data and logos are from [Liquipedia](https://liquipedia.net), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). This project is not affiliated with Liquipedia, Twitch, Valve or OpenDota.

The code is released under the [MIT licence](LICENSE).
