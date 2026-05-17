# Polymarket Live Follow

Chrome extension that automatically clicks Polymarket's `Go to live market`
button after a short adaptive delay.

## Install locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this repository folder:
   `~\polymarket-live-follow`

The extension runs only on Polymarket pages and only clicks visible enabled
controls with the text `Go to live market`.

After following a market, it checks whether the new market loaded with missing
price data such as `--` or a missing `Current Price` value. If that happens, it
refreshes the page and increases the saved delay by one second. The delay is
kept between 3 and 8 seconds, and repeated anomalies reset it toward 5 seconds
instead of allowing it to climb indefinitely.
