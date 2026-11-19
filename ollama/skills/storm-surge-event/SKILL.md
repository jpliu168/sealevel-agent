---
name: storm-surge-event
description: Peak water level and storm surge at a place during a storm or flood on specific dates.
---
Steps:
1. geocode(place) -> find_stations(lat, lon, 50). Use the nearest gauge.
2. Dates as YYYYMMDD. If the user gives a storm name without dates, use the
   dates you know, say so, and add 2 days on each side (max 31 days).
3. get_water_levels(station_id, begin_date, end_date).
4. Answer: peak water level (m above MLLW) and time, peak surge
   (observed minus predicted tide) and time, gauge name and id, CSV path.
   Times are GMT; Eastern time is GMT minus 4 h (summer) or 5 h (winter).
