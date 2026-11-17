# Twitch tournament bracket

A userscript that adds a live tournament bracket to Twitch streams of ongoing esports tournaments. The data comes from [Liquipedia](https://liquipedia.net).

When the stream you are watching belongs to an ongoing tournament, a **Bracket** button appears next to Follow. It shows or hides a floating window with the bracket: team logos, scores, the match being played right now, and upcoming match times.

## Install

1. Install a userscript manager such as [Violentmonkey](https://violentmonkey.github.io/) or Tampermonkey.
2. Open [`twitch-tournament-bracket.user.js`](https://github.com/Ephpotle/twitch-tournament-bracket/raw/main/twitch-tournament-bracket.user.js) and confirm the installation.

## Use

- Click **Bracket** next to the Follow button to show or hide the window. The choice is remembered.
- Drag the title bar to move the window; drag the top-left or bottom-right corner to resize it. The bracket scales to fit. Double-click the title bar to reset size and position.
- Hover a team to highlight its path through the bracket.
- The bracket refreshes every 3 minutes while it is open. The refresh button in the title bar refreshes on demand.

## How a tournament is detected

The script reads the game category of the stream, loads the list of current matches from the Liquipedia wiki for that game, and shows the button when one of these is true:

1. Liquipedia lists the channel as a stream of a current match.
2. The stream title names both teams of a current match.
3. The stream title contains the tournament name.

## Limitations

- Tested on Dota 2 with a double-elimination bracket. About 20 other games are mapped to their Liquipedia wikis, but those mappings are not all verified.
- Only brackets are drawn. Group stages, Swiss rounds and league tables are not shown.
- Liquipedia allows one page request per 30 seconds, so the first bracket on a new channel can take up to half a minute to appear.
- The script relies on Twitch page markup and Liquipedia bracket markup, either of which can change.

## Privacy and network access

The script only contacts `liquipedia.net` (its API and team logo images). It sends no data anywhere else and has no analytics. Settings and a small cache are kept in the browser local storage for twitch.tv.

## Data and licence

Tournament data and logos are from [Liquipedia](https://liquipedia.net), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). This project is not affiliated with Liquipedia or Twitch.

The code is released under the [MIT licence](LICENSE).
