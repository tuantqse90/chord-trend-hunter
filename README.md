# Chord Trend Hunter

Scores momentum on every busy token of a chain from Chord's board and hourly candles and rides the strongest trends.

An example agent built on [Chord](https://getchord.xyz), the trading API and on-chain data index for agents. Paper by default. Not financial advice.

## Run it

Node 20.12 or newer. Nothing to install and no key for paper mode.

```bash
git clone https://github.com/tuantqse90/chord-trend-hunter
cd chord-trend-hunter
node index.js                    # one cycle on base
node index.js --chain arbitrum   # another chain
node index.js --loop             # every 5 min (--interval <seconds> to change)
```

The report prints to the terminal and is saved to `state/report.md`.

## What it does each cycle

1. Reads the 24h token board and keeps tokens with `MIN_VOLUME_USD` or more (anchors, stablecoins and screened tokens are skipped).
2. Picks the `DEEP_SCAN` most promising by buy share and 24h change and pulls their hourly candles.
3. Scores 0 to 100: volume acceleration (the last hour's run rate against the day), buy share of the day's volume, trend on 1h / 6h / 24h and activity, minus penalties for a vertical candle, an overextended day, a dump in progress, sellers dominating or a thin last hour.
4. Buys up to three tokens at `BUY_SCORE` or more with no flags (size scales with the score) and manages take-profit / stop-loss / trailing / time exits.

## Sample run (16 October 2026, paper)

```text
# Trend Hunter on Base, 2026-10-16T14:29:14.544Z
Board 200 tokens, 101 with $100.0k+ volume, 20 scored from hourly candles. Buy at score 68+ with no flags.

| # | Token | Score | Price | 1h | 6h | 24h | Vol accel | Buy share | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | TRUE | 76 | $0.0703 | -5.4% | +37.5% | +53.3% | 7.43x | 64% | dumping now |
| 2 | ICNT | 72 | $0.158 | +2.5% | +3.6% | +28.5% | 4.23x | 53% | — |
| 3 | TIBBIR | 63 | $0.242 | +0.3% | +18.2% | +43.8% | 0.39x | 60% | — |
| 4 | OVPP | 49 | $0.00156 | -2.1% | +11.5% | +37.0% | 0.76x | 55% | — |
| 5 | AAVE | 39 | $160.52 | +0.3% | -0.6% | +8.1% | 1.27x | 60% | — |
| 6 | DRV | 37 | $0.428 | -0.6% | +6.7% | +16.5% | 0.60x | 56% | — |

Entries this cycle: ICNT
Book: PAPER · open 1 · unrealized $0.00 · realized $0.00 · equity $1000.00
```

## Chains

Ethereum, Base, Arbitrum, BNB Chain, Avalanche, Monad, Robinhood and Arc (keys `ethereum`, `base`, `arbitrum`, `bnb`, `avalanche`, `monad`, `robinhood`, `arc`). Pick one with `CHAIN=` in `.env` or `--chain`.

## Settings

Copy `.env.example` to `.env`. Every setting is optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `CHAIN` | `base` | Chain key or id. |
| `MIN_VOLUME_USD` | `100000` | Smallest 24h volume considered. |
| `DEEP_SCAN` | `20` | Tokens that get the candle pull. |
| `BUY_SCORE` | `68` | Entry threshold. |
| `LIVE` | `0` | 1 = sign and send real transactions with your key. Anything else = paper. |
| `PRIVATE_KEY` | — | Live only. A fresh hot wallet with small funds; the key never leaves this machine. |
| `RPC_URL` | — | Live only. Your RPC endpoint for the chain; transactions are dry-run and sent through it. |
| `MAX_TRADE_USD` | `25` | Largest single entry. |
| `MAX_OPEN_POSITIONS` | `5` | Entries are refused above this. |
| `MAX_SLIPPAGE_BPS` | `100` | Slippage sent with every quote (100 = 1%). |
| `MAX_PRICE_IMPACT_PCT` | `1.5` | Quotes with more price impact are refused. |
| `DAILY_LOSS_LIMIT_USD` | `50` | No new entries for the rest of the UTC day once realized losses reach this. |
| `PAPER_BANKROLL_USD` | `1000` | Starting cash of the paper book. |
| `CHORD_API` | `https://api.getchord.xyz/v1` | Chord API base URL. |
| `CHORD_API_KEY` | — | Optional. Not needed for anything this agent calls. |
| `CHORD_RPM` | `50` | Client-side request cap per minute (anonymous callers get 60 per IP). |

## Paper and live

**Paper (default).** Every quote is a real route from Chord's router; the fill is simulated at the quoted output, after Chord's fee. The book lives in `state/`.

**Live.** Set `LIVE=1`, `PRIVATE_KEY` and `RPC_URL`, then `npm install` (adds `viem`). Each trade goes: Chord quote → unsigned transaction from Chord (`POST /v1/swap`) → approval of Chord's router if needed → dry run on your RPC → your key signs → send → measure the tokens that actually arrived. Chord never takes custody of keys or funds.

Every entry passes the same risk gate: `MAX_TRADE_USD`, `MAX_OPEN_POSITIONS`, `MAX_PRICE_IMPACT_PCT` and `DAILY_LOSS_LIMIT_USD`. Use a fresh wallet with small funds: the cash leg is the chain's main dollar stablecoin, plus a little native coin for gas.

## Built on Chord

Chord calls this agent makes:

- the token board
- `GET /v1/candles`
- `GET /v1/quote` and, in live mode, `POST /v1/swap`

No key is needed: anonymous callers get 60 requests a minute per IP, and the client in `lib/chord.js` stays under that, caches reads briefly and backs off on 429.

- Docs and OpenAPI: https://getchord.xyz/docs
- Hosted MCP server for LLM agents (quotes, unsigned swaps, token boards, trades, wallet PnL; no key): `https://api.getchord.xyz/v1/mcp`. In Claude Code: `claude mcp add --transport http chord https://api.getchord.xyz/v1/mcp`
- More templates: https://github.com/tuantqse90/chord-agent-templates

## Files

```text
index.js          the agent
lib/chord.js      Chord client: rate limit, cache, chain paths from GET /v1/chains
lib/portfolio.js  paper / live book, risk gate, exits
lib/wallet.js     your key and RPC (live mode only)
lib/config.js     settings from .env
lib/util.js       formatting, --loop runner
```

## Disclaimer

Example code, not financial advice. Backtests and paper results do not predict real results. In live mode this program signs real transactions with your key and can lose money.

## License

MIT
