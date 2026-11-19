---
name: custom-analysis
description: Any sea-level analysis the other skills don't cover — acceleration, decadal rates, seasonal cycle, extremes, correlations between gauges, comparisons with global rates, custom plots or tables. Uses the CSVs saved by the MCP tools.
---
# Custom analysis

1. Get the data with the MCP tools (`get_monthly_mean` or `get_water_levels`).
   They save CSVs in `data/` and return the path:
   - monthly: `year,month,msl_m` (meters relative to station MSL datum)
   - hourly: `time_gmt,observed_m,predicted_m,surge_m` (meters, MLLW)
2. Write a small, readable script in `outputs/scripts/` (Python preferred;
   Node if Python packages are missing). Print the key numbers; save figures
   to `outputs/`.
3. Methods to use by default:
   - remove the mean seasonal cycle before fitting trends;
   - acceleration: quadratic fit, report 2× the quadratic coefficient in
     mm/yr² with its standard error;
   - rates by decade or moving windows: OLS on deseasonalized data;
   - always state uncertainty and the number of months used.
4. Explain the result in plain language, give file paths, and mention
   limitations (gaps, datum changes, short records).
