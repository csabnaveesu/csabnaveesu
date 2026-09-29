# Running Pine Script locally with PineTS

Put your own scripts in `pine/private/` (gitignored) or anywhere outside the repo.

```bash
npm install
npm run pine -- pine/private/my_script.pine          # synthetic 5m data, works offline
npm run pine -- my.pine --csv data.csv --ticker SPY --tf 5
npm run pine -- my.pine --symbol BTCUSDT --tf 5m --bars 500   # Binance (needs internet)
npm run pine -- my.pine --json out.json              # dump plot series
DEBUG=1 npm run pine -- ...                          # stack traces
```

CSV columns: `time (ms or ISO), open, high, low, close, volume` (header optional).
Higher-timeframe `request.security` calls are resampled from the base data.

## Known PineTS 0.10.0 gap: outer variable as `ta.*()[offset]` in `request.security`

```pine
// fails: "n is not defined"
[a, b] = request.security(syminfo.tickerid, "15", [close[n], ta.atr(14)[n]])

// works: pass the offset in as an argument and index a local series
f(int _i) =>
    _atr = ta.atr(14)
    [close[_i], _atr[_i]]
[a, b] = request.security(syminfo.tickerid, "15", f(n))
```
