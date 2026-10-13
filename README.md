# Letters

A live Solana board, read one glyph at a time.

[![Live site](https://img.shields.io/badge/live-letters.codes-111111)](https://letters.codes)

- **Chain:** Solana
- **Contract address:** pending

## Overview

Letters ranks the ten loudest Solana tokens by 24h turnover and redraws them as tiles while the tab is open. Numbers come straight from a public market feed. Nothing on the board is edited by hand, and nothing on it is a recommendation.

Every outside fact on the site (contract address, social links, market source) lives in a single register record. A record is either stated or it is not. Records that are not stated render inert, with a label and the word "pending" and no link or value.

## Features

- Live top-ten board with price, 24h change, volume, liquidity and a copy button per address
- Ticker, stat tiles, rail lists and roster, all driven by the same feed
- Skeleton loading, staggered fade-in, count-up with flash on change
- Exponential backoff on feed failure, last good data kept, pause while the tab is hidden
- Address slot at the top of the page, inert until an address is stated
- Reduced-motion support throughout

## Links

- Site: https://letters.codes
- X: pending
- GitHub: pending

## Develop

```bash
npm install
npm run build    # writes dist/
npm run gates    # build checks, both register branches
npm run measure  # layout checks at 360, 390, 430, 1366 and 1440
```

`dist/` is the deploy output.

## License

MIT
