---
name: explain-sea-level-change
description: Explain WHY sea level at a gauge is rising fast, slowly, or falling, or why two places or two periods differ. Use for "why", "how come", "what causes" questions, including follow-ups about earlier results.
---
# Explain sea-level change

1. Identify the gauges and period from the conversation. If unknown, run the
   `sea-level-at-place` skill first.
2. Gather evidence (don't skip):
   - `get_long_term_trend` for each gauge (century-scale context).
   - `compute_trend` for a longer window (e.g. 1996–2025) to test whether a
     short-window result depends on the chosen years. Look at
     `annual_anomalies_mm` for unusually high or low end years.
3. Check the candidate causes and keep only those that fit the place:
   - **Land subsidence**: groundwater, oil and gas withdrawal, sediment
     compaction (Houston–Galveston, Mississippi delta, Chesapeake Bay,
     Norfolk).
   - **Glacial isostatic adjustment**: peripheral-bulge collapse adds about
     1–2 mm/yr in the mid-Atlantic; rebound uplift lowers relative sea level
     in Alaska.
   - **Tectonics**: uplift in the Pacific Northwest and Alaska.
   - **Ocean dynamics**: Gulf Stream / AMOC changes (Northeast hotspot), the
     2010s Southeast and Gulf hotspot, Loop Current.
   - **Year-to-year variability**: El Niño, NAO, persistent winds, storms,
     river discharge.
   - **Window endpoints**: a low or high first/last year tilts short trends.
4. Answer: lead with the 2–3 causes best supported by the numbers you
   gathered, quote those numbers, list the rest as possible contributors, and
   label general knowledge as such. Suggest one dataset that could confirm it
   (GPS vertical land motion, satellite altimetry, NOAA's VLM estimates).
