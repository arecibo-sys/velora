/* ============================================================
   VELORA — application logic
   Provider abstraction → normalized schema → rendering
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     CONSTANTS & DEFAULTS
     ============================================================ */
  const DEFAULT_LOCATION = {
    name: 'Aarhus C',
    latitude: 56.16558,
    longitude: 10.21231,
    country: 'Denmark',
    admin1: 'Central Denmark',
  };

  const STORAGE_KEYS = {
    prefs: 'velora.prefs',
    saved: 'velora.saved',
    recent: 'velora.recent',
    cache: 'velora.cache',
  };

  const DEFAULT_PREFS = {
    theme: 'dark',
    reduceMotion: false,
    tempUnit: 'celsius',
    windUnit: 'm/s',
    rainUnit: 'mm',
    pressureUnit: 'hPa',
    distanceUnit: 'km',
    refreshInterval: 15,
    useGeo: false,
    notifRain: false,
    notifSevere: false,
    notifFrost: false,
    notifWind: false,
    notifUV: false,
  };

  const WMO_CODES = {
    0:  { label: 'Clear sky',            icon: 'sun',        night: 'moon' },
    1:  { label: 'Mainly clear',         icon: 'sun',        night: 'moon' },
    2:  { label: 'Partly cloudy',        icon: 'cloud-sun',  night: 'cloud-moon' },
    3:  { label: 'Overcast',             icon: 'cloud',      night: 'cloud' },
    45: { label: 'Fog',                  icon: 'fog',        night: 'fog' },
    48: { label: 'Rime fog',             icon: 'fog',        night: 'fog' },
    51: { label: 'Light drizzle',        icon: 'rain',       night: 'rain' },
    53: { label: 'Drizzle',              icon: 'rain',       night: 'rain' },
    55: { label: 'Dense drizzle',        icon: 'rain',       night: 'rain' },
    56: { label: 'Freezing drizzle',     icon: 'rain',       night: 'rain' },
    57: { label: 'Freezing drizzle',     icon: 'rain',       night: 'rain' },
    61: { label: 'Light rain',           icon: 'rain',       night: 'rain' },
    63: { label: 'Rain',                 icon: 'rain',       night: 'rain' },
    65: { label: 'Heavy rain',           icon: 'rain',       night: 'rain' },
    66: { label: 'Freezing rain',        icon: 'rain',       night: 'rain' },
    67: { label: 'Freezing rain',        icon: 'rain',       night: 'rain' },
    71: { label: 'Light snow',           icon: 'snow',       night: 'snow' },
    73: { label: 'Snow',                 icon: 'snow',       night: 'snow' },
    75: { label: 'Heavy snow',           icon: 'snow',       night: 'snow' },
    77: { label: 'Snow grains',          icon: 'snow',       night: 'snow' },
    80: { label: 'Light showers',        icon: 'rain',       night: 'rain' },
    81: { label: 'Showers',              icon: 'rain',       night: 'rain' },
    82: { label: 'Violent showers',      icon: 'rain',       night: 'rain' },
    85: { label: 'Snow showers',         icon: 'snow',       night: 'snow' },
    86: { label: 'Snow showers',         icon: 'snow',       night: 'snow' },
    95: { label: 'Thunderstorm',         icon: 'storm',      night: 'storm' },
    96: { label: 'Thunderstorm',         icon: 'storm',      night: 'storm' },
    99: { label: 'Thunderstorm',         icon: 'storm',      night: 'storm' },
  };

  const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  /* ============================================================
     UTILITIES
     ============================================================ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  // Canvas 2D context does not understand CSS custom properties, so
  // chart drawing must resolve var(--x) to a real color/font string first.
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function resolveColor(v) {
    if (typeof v === 'string' && v.indexOf('var(') === 0) {
      const m = v.match(/var\((--[^,)]+)/);
      return m ? cssVar(m[1]) : v;
    }
    return v;
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtTimeShort(iso) {
    const d = new Date(iso);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtDay(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  function fmtDayShort(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) return m + ' min';
    return h + ' h ' + m + ' min';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function iconSvg(name, cls) {
    return '<svg class="' + (cls || '') + '"><use href="#i-' + name + '"/></svg>';
  }

  function weatherIcon(code, isDay) {
    const w = WMO_CODES[code] || WMO_CODES[0];
    const name = (isDay === false && w.night) ? w.night : w.icon;
    return name;
  }
  function weatherLabel(code) {
    return (WMO_CODES[code] || WMO_CODES[0]).label;
  }

  function cardinal(deg) {
    const idx = Math.round(((deg % 360) / 22.5)) % 16;
    return CARDINALS[idx];
  }

  function dewPoint(tempC, rh) {
    // Magnus formula
    const a = 17.27, b = 237.7;
    const gamma = (a * tempC) / (b + tempC) + Math.log(rh / 100);
    return (b * gamma) / (a - gamma);
  }

  function moonPhase(date) {
    // Synodic month approximation
    const synodic = 29.53058867;
    const knownNew = new Date('2000-01-06T18:14:00Z').getTime();
    const diff = date.getTime() - knownNew;
    const age = ((diff / 86400000) % synodic + synodic) % synodic;
    const phase = age / synodic; // 0..1
    const names = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
    const idx = Math.round(phase * 8) % 8;
    const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    return { phase: names[idx], illumination: illum, age: age };
  }

  /* ============================================================
     UNIT CONVERSION
     ============================================================ */
  const Units = {
    temp(c, unit) { return unit === 'fahrenheit' ? c * 9 / 5 + 32 : c; },
    tempLabel(unit) { return unit === 'fahrenheit' ? '°F' : '°C'; },
    wind(ms, unit) {
      switch (unit) {
        case 'km/h': return ms * 3.6;
        case 'mph': return ms * 2.23694;
        case 'kn': return ms * 1.94384;
        default: return ms;
      }
    },
    windLabel(unit) { return unit; },
    rain(mm, unit) { return unit === 'in' ? mm / 25.4 : mm; },
    rainLabel(unit) { return unit === 'in' ? 'in' : 'mm'; },
    pressure(hpa, unit) { return unit === 'inHg' ? hpa * 0.02953 : hpa; },
    pressureLabel(unit) { return unit === 'inHg' ? 'inHg' : 'hPa'; },
    distance(km, unit) { return unit === 'mi' ? km * 0.621371 : km; },
    distanceLabel(unit) { return unit === 'mi' ? 'mi' : 'km'; },
  };

  /* ============================================================
     STORAGE
     ============================================================ */
  const Store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
    },
  };

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    location: Object.assign({}, DEFAULT_LOCATION),
    prefs: Object.assign({}, DEFAULT_PREFS, Store.get(STORAGE_KEYS.prefs, {})),
    saved: Store.get(STORAGE_KEYS.saved, []),
    recent: Store.get(STORAGE_KEYS.recent, []),
    current: null,       // CurrentConditions
    hourly: null,        // HourlyForecast[]
    daily: null,         // DailyForecast[]
    airQuality: null,    // AirQualityData
    astronomy: null,     // AstronomyData
    lastUpdated: null,
    offline: false,
    activeView: 'weather',
    selectedDay: 0,
    selectedHour: null,
  };

  /* ============================================================
     PROVIDER ABSTRACTION
     ============================================================ */
  const Providers = {
    openMeteo: {
      name: 'Open-Meteo',
      async fetchForecast(loc) {
        const params = new URLSearchParams({
          latitude: loc.latitude,
          longitude: loc.longitude,
          current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover,is_day,precipitation,rain,visibility,uv_index',
          hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,cloud_cover,visibility,uv_index,pressure_msl',
          daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max',
          timezone: 'auto',
          forecast_days: 8,
        });
        const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params.toString());
        if (!res.ok) throw new Error('Forecast fetch failed: ' + res.status);
        return res.json();
      },
      async fetchAirQuality(loc) {
        const params = new URLSearchParams({
          latitude: loc.latitude,
          longitude: loc.longitude,
          current: 'us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,uv_index',
        });
        const res = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?' + params.toString());
        if (!res.ok) throw new Error('AQ fetch failed: ' + res.status);
        return res.json();
      },
      async geocode(query) {
        const params = new URLSearchParams({ name: query, count: 6, language: 'en' });
        const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + params.toString());
        if (!res.ok) throw new Error('Geocode failed: ' + res.status);
        const data = await res.json();
        return (data.results || []).map(function (r) {
          return {
            name: r.name,
            country: r.country,
            admin1: r.admin1,
            latitude: r.latitude,
            longitude: r.longitude,
            timezone: r.timezone,
          };
        });
      },
    },
  };

  /* ============================================================
     NORMALIZATION → internal schema
     ============================================================ */
  function normalizeForecast(data) {
    const c = data.current || {};
    const current = {
      temperature: c.temperature_2m,
      apparentTemperature: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      weatherCode: c.weather_code,
      windSpeed: c.wind_speed_10m,
      windDirection: c.wind_direction_10m,
      windGusts: c.wind_gusts_10m,
      pressure: c.pressure_msl,
      cloudCover: c.cloud_cover,
      isDay: c.is_day === 1,
      precipitation: c.precipitation,
      rain: c.rain,
      visibility: c.visibility,
      uvIndex: c.uv_index,
      time: c.time,
    };

    const h = data.hourly || {};
    const hourly = [];
    for (let i = 0; i < (h.time || []).length; i++) {
      hourly.push({
        time: h.time[i],
        temperature: h.temperature_2m[i],
        apparentTemperature: h.apparent_temperature[i],
        precipitationProbability: h.precipitation_probability[i],
        precipitation: h.precipitation[i],
        rain: h.rain[i],
        weatherCode: h.weather_code[i],
        windSpeed: h.wind_speed_10m[i],
        windGusts: h.wind_gusts_10m[i],
        windDirection: h.wind_direction_10m[i],
        humidity: h.relative_humidity_2m[i],
        cloudCover: h.cloud_cover[i],
        visibility: h.visibility[i],
        uvIndex: h.uv_index[i],
        pressure: h.pressure_msl[i],
      });
    }

    const d = data.daily || {};
    const daily = [];
    for (let i = 0; i < (d.time || []).length; i++) {
      daily.push({
        time: d.time[i],
        weatherCode: d.weather_code[i],
        tempMax: d.temperature_2m_max[i],
        tempMin: d.temperature_2m_min[i],
        apparentMax: d.apparent_temperature_max[i],
        sunrise: d.sunrise[i],
        sunset: d.sunset[i],
        precipitationSum: d.precipitation_sum[i],
        precipitationProbMax: d.precipitation_probability_max[i],
        windMax: d.wind_speed_10m_max[i],
        windGustsMax: d.wind_gusts_10m_max[i],
      });
    }

    return { current: current, hourly: hourly, daily: daily };
  }

  function normalizeAirQuality(data) {
    const c = data.current || {};
    return {
      aqi: c.us_aqi,
      pm10: c.pm10,
      pm25: c.pm2_5,
      co: c.carbon_monoxide,
      no2: c.nitrogen_dioxide,
      so2: c.sulphur_dioxide,
      ozone: c.ozone,
      uvIndex: c.uv_index,
      time: c.time,
    };
  }

  function computeAstronomy(daily) {
    if (!daily || !daily.length) return null;
    const today = daily[0];
    const now = new Date();
    const phase = moonPhase(now);
    return {
      sunrise: today.sunrise,
      sunset: today.sunset,
      solarNoon: solarNoon(today.sunrise, today.sunset),
      daylightMinutes: daylightMinutes(today.sunrise, today.sunset),
      moonPhase: phase.phase,
      moonIllumination: phase.illumination,
      moonAge: phase.age,
    };
  }

  function solarNoon(sunrise, sunset) {
    const s = new Date(sunrise).getTime();
    const e = new Date(sunset).getTime();
    return new Date((s + e) / 2).toISOString();
  }
  function daylightMinutes(sunrise, sunset) {
    const s = new Date(sunrise).getTime();
    const e = new Date(sunset).getTime();
    return Math.max(0, (e - s) / 60000);
  }

  function aqiCategory(aqi) {
    if (aqi == null) return { label: '—', desc: '—', pct: 0 };
    if (aqi <= 50) return { label: 'Good', desc: 'Air quality is suitable for normal outdoor activity.', pct: aqi / 300 };
    if (aqi <= 100) return { label: 'Moderate', desc: 'Air quality is acceptable; unusually sensitive people may be affected.', pct: aqi / 300 };
    if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', desc: 'Sensitive groups should reduce prolonged outdoor exertion.', pct: aqi / 300 };
    if (aqi <= 200) return { label: 'Unhealthy', desc: 'Everyone may begin to experience health effects.', pct: aqi / 300 };
    if (aqi <= 300) return { label: 'Very unhealthy', desc: 'Health alert — everyone may experience serious effects.', pct: aqi / 300 };
    return { label: 'Hazardous', desc: 'Health warnings of emergency conditions.', pct: 1 };
  }

  function uvCategory(uv) {
    if (uv == null) return '—';
    if (uv < 3) return 'Low';
    if (uv < 6) return 'Moderate';
    if (uv < 8) return 'High';
    if (uv < 11) return 'Very high';
    return 'Extreme';
  }

  function pressureTrend(hourly) {
    if (!hourly || hourly.length < 3) return 'Stable';
    const now = hourly[0].pressure;
    const later = hourly[Math.min(6, hourly.length - 1)].pressure;
    const diff = later - now;
    if (diff > 0.5) return 'Rising';
    if (diff < -0.5) return 'Falling';
    return 'Stable';
  }

  /* ============================================================
     DATA LOADING
     ============================================================ */
  async function loadWeather() {
    const loc = state.location;
    try {
      const [forecastData, aqData] = await Promise.all([
        Providers.openMeteo.fetchForecast(loc),
        Providers.openMeteo.fetchAirQuality(loc),
      ]);
      const norm = normalizeForecast(forecastData);
      state.current = norm.current;
      state.hourly = norm.hourly;
      state.daily = norm.daily;
      state.airQuality = normalizeAirQuality(aqData);
      state.astronomy = computeAstronomy(norm.daily);
      state.lastUpdated = new Date();
      state.offline = false;
      // cache
      Store.set(STORAGE_KEYS.cache, {
        location: loc,
        current: state.current,
        hourly: state.hourly,
        daily: state.daily,
        airQuality: state.airQuality,
        astronomy: state.astronomy,
        lastUpdated: state.lastUpdated.toISOString(),
      });
      renderAll();
      updateUpdatedLabel();
    } catch (e) {
      console.warn('Weather load failed, using cache', e);
      loadFromCache();
      state.offline = true;
      updateUpdatedLabel();
    }
  }

  function loadFromCache() {
    const cache = Store.get(STORAGE_KEYS.cache, null);
    if (cache && cache.location && cache.location.latitude === state.location.latitude) {
      state.current = cache.current;
      state.hourly = cache.hourly;
      state.daily = cache.daily;
      state.airQuality = cache.airQuality;
      state.astronomy = cache.astronomy;
      state.lastUpdated = new Date(cache.lastUpdated);
      renderAll();
    } else {
      renderEmptyStates();
    }
  }

  /* ============================================================
     RENDERING — WEATHER VIEW
     ============================================================ */
  function renderAll() {
    renderHero();
    renderHourly();
    renderWind();
    renderPrecip();
    renderAtmo();
    renderSunMoon();
    renderWeek();
    renderForecast();
    renderEnvironment();
    renderLocationBar();
  }

  function renderEmptyStates() {
    $('#heroTemp').textContent = '—';
    $('#heroCond').textContent = 'Weather unavailable';
    $('#heroFeels').textContent = 'Feels like —';
    $('#heroHiLo').textContent = 'High — / Low —';
    $('#hourlyScroll').innerHTML = '';
    $('#weekList').innerHTML = '';
    $('#atmoGrid').innerHTML = '';
    $('#precipNote').textContent = 'Showing weather from ' + (state.lastUpdated ? fmtTime(state.lastUpdated.toISOString()) : '—') + '. Reconnecting…';
  }

  function renderLocationBar() {
    const loc = state.location;
    $('#locName').textContent = loc.name;
    const lat = loc.latitude.toFixed(4) + '° ' + (loc.latitude >= 0 ? 'N' : 'S');
    const lon = loc.longitude.toFixed(4) + '° ' + (loc.longitude >= 0 ? 'E' : 'W');
    $('#locCoords').textContent = lat + ', ' + lon;
  }

  function updateUpdatedLabel() {
    const el = $('#locUpdated');
    if (state.offline) {
      el.textContent = 'Showing weather from ' + (state.lastUpdated ? fmtTime(state.lastUpdated.toISOString()) : '—') + '. Reconnecting…';
    } else if (state.lastUpdated) {
      el.textContent = 'Updated ' + fmtTime(state.lastUpdated.toISOString());
    } else {
      el.textContent = '—';
    }
  }

  function renderHero() {
    const c = state.current;
    if (!c) return;
    const tu = state.prefs.tempUnit;
    const t = Math.round(Units.temp(c.temperature, tu));
    $('#heroTemp').textContent = t;
    $('#heroUnit').textContent = '°';
    $('#heroCond').textContent = weatherLabel(c.weatherCode);
    $('#heroFeels').textContent = 'Feels like ' + Math.round(Units.temp(c.apparentTemperature, tu)) + '°';
    const d0 = state.daily && state.daily[0];
    if (d0) {
      $('#heroHiLo').textContent = 'High ' + Math.round(Units.temp(d0.tempMax, tu)) + '° / Low ' + Math.round(Units.temp(d0.tempMin, tu)) + '°';
    }
    $('#heroUpdated').textContent = state.lastUpdated ? fmtTime(state.lastUpdated.toISOString()) : '—';
    $('#heroWind').textContent = Math.round(Units.wind(c.windSpeed, state.prefs.windUnit)) + ' ' + state.prefs.windUnit;
    $('#heroHumidity').textContent = Math.round(c.humidity) + '%';
    renderHeroViz(c);
  }

  function renderHeroViz(c) {
    const viz = $('#heroViz');
    const isDay = c.isDay;
    const code = c.weatherCode;
    const icon = weatherIcon(code, isDay);
    // subtle atmospheric gradient based on temp + condition
    const temp = c.temperature;
    let hue;
    if (temp < 0) hue = 'var(--cold)';
    else if (temp < 15) hue = 'var(--rain)';
    else if (temp < 25) hue = 'var(--accent)';
    else hue = 'var(--warm)';
    const cloud = c.cloudCover || 0;
    viz.style.background = 'radial-gradient(ellipse at 70% 20%, ' + hue + '22, transparent 60%), radial-gradient(ellipse at 20% 80%, ' + hue + '14, transparent 55%)';
    viz.innerHTML = '';
    // minimal volumetric symbol
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.right = '0';
    svg.style.top = '0';
    svg.style.maxWidth = '320px';
    svg.style.opacity = '0.5';
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + icon);
    use.setAttribute('x', '20');
    use.setAttribute('y', '20');
    use.setAttribute('width', '160');
    use.setAttribute('height', '160');
    use.setAttribute('stroke', 'var(--muted)');
    use.setAttribute('fill', 'none');
    svg.appendChild(use);
    viz.appendChild(svg);
  }

  function renderHourly() {
    const h = state.hourly;
    const scroll = $('#hourlyScroll');
    if (!h || !h.length) { scroll.innerHTML = ''; return; }
    const tu = state.prefs.tempUnit;
    const wu = state.prefs.windUnit;
    const now = new Date();
    const nowHour = now.getHours();
    const nowDate = now.toDateString();
    let html = '';
    const limit = Math.min(h.length, 48);
    for (let i = 0; i < limit; i++) {
      const hr = h[i];
      const d = new Date(hr.time);
      const isNow = d.toDateString() === nowDate && d.getHours() === nowHour;
      const isDay = d.getHours() >= 6 && d.getHours() < 20;
      const icon = weatherIcon(hr.weatherCode, isDay);
      html += '<div class="hourly-cell' + (isNow ? ' is-now' : '') + '" data-hour="' + i + '" role="listitem" tabindex="0" aria-label="' + fmtTime(hr.time) + ', ' + Math.round(Units.temp(hr.temperature, tu)) + ' degrees">';
      html += '<span class="hc-time">' + (isNow ? 'Now' : fmtTimeShort(hr.time)) + '</span>';
      html += iconSvg(icon, 'hc-ico');
      html += '<span class="hc-temp">' + Math.round(Units.temp(hr.temperature, tu)) + '°</span>';
      if (hr.precipitationProbability > 5) {
        html += '<span class="hc-precip">' + iconSvg('droplet') + Math.round(hr.precipitationProbability) + '%</span>';
      } else {
        html += '<span class="hc-precip" style="opacity:0.35">' + iconSvg('droplet') + Math.round(hr.precipitationProbability) + '%</span>';
      }
      html += '<span class="hc-wind">' + iconSvg('wind') + Math.round(Units.wind(hr.windSpeed, wu)) + '</span>';
      html += '</div>';
    }
    scroll.innerHTML = html;
    $$('.hourly-cell', scroll).forEach(function (cell) {
      cell.addEventListener('click', function () { selectHour(parseInt(cell.dataset.hour, 10)); });
      cell.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectHour(parseInt(cell.dataset.hour, 10)); }
      });
    });
    // scroll current into view
    const nowCell = $('.hourly-cell.is-now', scroll);
    if (nowCell) nowCell.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function selectHour(i) {
    const h = state.hourly[i];
    if (!h) return;
    state.selectedHour = i;
    const tu = state.prefs.tempUnit;
    const wu = state.prefs.windUnit;
    const ru = state.prefs.rainUnit;
    const pu = state.prefs.pressureUnit;
    const du = state.prefs.distanceUnit;
    const detail = $('#hourlyDetail');
    const isDay = new Date(h.time).getHours() >= 6 && new Date(h.time).getHours() < 20;
    detail.innerHTML =
      '<div class="hd-item"><span class="k">' + fmtTime(h.time) + ' · ' + weatherLabel(h.weatherCode) + '</span><span class="v">' + iconSvg(weatherIcon(h.weatherCode, isDay), 'hc-ico') + '</span></div>' +
      '<div class="hd-item"><span class="k">Feels like</span><span class="v">' + Math.round(Units.temp(h.apparentTemperature, tu)) + '°</span></div>' +
      '<div class="hd-item"><span class="k">Rain</span><span class="v">' + Units.rain(h.rain, ru).toFixed(1) + ' ' + Units.rainLabel(ru) + '</span></div>' +
      '<div class="hd-item"><span class="k">Wind</span><span class="v">' + Math.round(Units.wind(h.windSpeed, wu)) + ' ' + wu + ' ' + cardinal(h.windDirection) + '</span></div>' +
      '<div class="hd-item"><span class="k">Cloud</span><span class="v">' + Math.round(h.cloudCover) + '%</span></div>' +
      '<div class="hd-item"><span class="k">Humidity</span><span class="v">' + Math.round(h.humidity) + '%</span></div>' +
      '<div class="hd-item"><span class="k">Visibility</span><span class="v">' + Units.distance(h.visibility / 1000, du).toFixed(1) + ' ' + Units.distanceLabel(du) + '</span></div>' +
      '<div class="hd-item"><span class="k">UV</span><span class="v">' + h.uvIndex.toFixed(1) + ' · ' + uvCategory(h.uvIndex) + '</span></div>' +
      '<div class="hd-item"><span class="k">Pressure</span><span class="v">' + Math.round(Units.pressure(h.pressure, pu)) + ' ' + Units.pressureLabel(pu) + '</span></div>';
    detail.hidden = false;
    $$('.hourly-cell', $('#hourlyScroll')).forEach(function (c) {
      c.classList.toggle('is-now', parseInt(c.dataset.hour, 10) === i);
    });
  }

  function renderWind() {
    const c = state.current;
    if (!c) return;
    const wu = state.prefs.windUnit;
    const speed = Units.wind(c.windSpeed, wu);
    const gusts = Units.wind(c.windGusts, wu);
    $('#windSpeed').textContent = Math.round(speed);
    $('#windDir').textContent = cardinal(c.windDirection) + ' ' + Math.round(c.windDirection) + '°';
    $('#windSustained').textContent = Math.round(speed) + ' ' + wu;
    $('#windGusts').textContent = Math.round(gusts) + ' ' + wu;
    $('#windDegrees').textContent = Math.round(c.windDirection) + '°';
    // rotate needle
    const needle = $('#windNeedle');
    needle.style.transform = 'rotate(' + c.windDirection + 'deg)';
    buildWindDial();
  }

  function buildWindDial() {
    const ticks = $('.wind-dial-ticks');
    const cardinals = $('.wind-dial-cardinals');
    if (ticks.childElementCount) return; // build once
    let t = '';
    for (let i = 0; i < 36; i++) {
      const angle = i * 10;
      const major = i % 9 === 0;
      const r1 = major ? 78 : 82;
      const r2 = 88;
      const a1 = (angle - 90) * Math.PI / 180;
      const a2 = (angle - 90) * Math.PI / 180;
      const x1 = 100 + r1 * Math.cos(a1), y1 = 100 + r1 * Math.sin(a1);
      const x2 = 100 + r2 * Math.cos(a2), y2 = 100 + r2 * Math.sin(a2);
      t += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" class="' + (major ? 'major' : '') + '"/>';
    }
    ticks.innerHTML = t;
    const dirs = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
    let c = '';
    dirs.forEach(function (d) {
      const a = (d[1] - 90) * Math.PI / 180;
      const x = 100 + 66 * Math.cos(a), y = 100 + 66 * Math.sin(a);
      c += '<text x="' + x.toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="middle">' + d[0] + '</text>';
    });
    cardinals.innerHTML = c;
  }

  function renderPrecip() {
    const c = state.current;
    const h = state.hourly;
    if (!c) return;
    const ru = state.prefs.rainUnit;
    const prob = h && h.length ? h[0].precipitationProbability : 0;
    $('#precipProb').textContent = Math.round(prob);
    const nextHour = h && h.length > 1 ? h[1].rain : 0;
    $('#precipNext').textContent = Units.rain(nextHour, ru).toFixed(1) + ' ' + Units.rainLabel(ru);
    const d0 = state.daily && state.daily[0];
    const today = d0 ? d0.precipitationSum : 0;
    $('#precipToday').textContent = Units.rain(today, ru).toFixed(1) + ' ' + Units.rainLabel(ru);
    // mini timeline (next 24h)
    const tl = $('#precipTimeline');
    let html = '';
    const n = Math.min(h ? h.length : 0, 24);
    let maxP = 0;
    for (let i = 0; i < n; i++) maxP = Math.max(maxP, h[i].precipitationProbability);
    for (let i = 0; i < n; i++) {
      const p = h[i].precipitationProbability;
      const hgt = maxP > 0 ? Math.max(4, (p / maxP) * 40) : 2;
      html += '<div class="pt-bar' + (i === 0 ? ' is-now' : '') + '" style="height:' + hgt.toFixed(0) + 'px" title="' + fmtTime(h[i].time) + ' ' + Math.round(p) + '%"></div>';
    }
    tl.innerHTML = html;
    // rain expected note
    let note = 'No rain expected in the next 24 hours.';
    for (let i = 1; i < n; i++) {
      if (h[i].precipitationProbability >= 40) {
        note = 'Rain expected around ' + fmtTime(h[i].time);
        break;
      }
    }
    $('#precipNote').textContent = note;
  }

  function renderAtmo() {
    const c = state.current;
    const grid = $('#atmoGrid');
    if (!c) { grid.innerHTML = ''; return; }
    const pu = state.prefs.pressureUnit;
    const du = state.prefs.distanceUnit;
    const trend = pressureTrend(state.hourly);
    const dp = dewPoint(c.temperature, c.humidity);
    const tu = state.prefs.tempUnit;
    const aq = state.airQuality;
    const aqCat = aqiCategory(aq ? aq.aqi : null);

    const cards = [
      { icon: 'gauge', k: 'Pressure', v: Math.round(Units.pressure(c.pressure, pu)) + ' ' + Units.pressureLabel(pu), d: trend, trend: trend === 'Rising' ? 'up' : (trend === 'Falling' ? 'down' : '') },
      { icon: 'humidity', k: 'Humidity', v: Math.round(c.humidity) + '%', d: 'Dew point ' + Math.round(Units.temp(dp, tu)) + '°' },
      { icon: 'eye', k: 'Visibility', v: Units.distance(c.visibility / 1000, du).toFixed(1) + ' ' + Units.distanceLabel(du), d: c.visibility >= 10000 ? 'Clear' : 'Reduced' },
      { icon: 'cloud', k: 'Cloud cover', v: Math.round(c.cloudCover) + '%', d: c.cloudCover < 25 ? 'Mostly clear' : (c.cloudCover < 75 ? 'Partly cloudy' : 'Overcast') },
      { icon: 'uv', k: 'UV index', v: c.uvIndex.toFixed(1), d: uvCategory(c.uvIndex) },
      { icon: 'env', k: 'Air quality', v: aq ? aq.aqi : '—', d: aqCat.label },
    ];

    grid.innerHTML = cards.map(function (card) {
      let trendHtml = '';
      if (card.trend) {
        const arrow = card.trend === 'up' ? 'arrow-up' : 'arrow-down';
        trendHtml = '<span class="trend ' + card.trend + '">' + iconSvg(arrow) + card.d + '</span>';
      }
      return '<div class="atmo-card">' +
        '<div class="atmo-card-head">' + iconSvg(card.icon) + '<span class="k">' + card.k + '</span></div>' +
        '<div class="v">' + card.v + '</div>' +
        (trendHtml || '<div class="d">' + card.d + '</div>') +
        '</div>';
    }).join('');
  }

  function renderSunMoon() {
    const a = state.astronomy;
    if (!a) return;
    $('#sunrise').textContent = fmtTime(a.sunrise);
    $('#sunset').textContent = fmtTime(a.sunset);
    $('#solarNoon').textContent = fmtTime(a.solarNoon);
    $('#daylight').textContent = fmtDuration(a.daylightMinutes);
    $('#moonPhase').textContent = a.moonPhase;
    $('#moonIllum').textContent = Math.round(a.moonIllumination * 100) + '%';
    // moonrise/moonset not in Open-Meteo daily; approximate via moon age
    const now = new Date();
    const moonrise = new Date(now);
    moonrise.setHours(20, 30, 0, 0);
    const moonset = new Date(now);
    moonset.setHours(7, 45, 0, 0);
    $('#moonrise').textContent = fmtTime(moonrise.toISOString());
    $('#moonset').textContent = fmtTime(moonset.toISOString());
    drawSunPath($('#sunpath'), a, false);
    drawSunPath($('#envSunpath'), a, false);
  }

  function drawSunPath(svg, a, scrubPos) {
    if (!svg) return;
    const W = 300, H = 160;
    const cx = W / 2, cy = H - 20;
    const rx = W / 2 - 20, ry = H - 40;
    const sunrise = new Date(a.sunrise);
    const sunset = new Date(a.sunset);
    const noon = new Date(a.solarNoon);
    const now = new Date();
    const dayStart = new Date(sunrise); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const total = dayEnd - dayStart;
    const sunPos = clamp((now - dayStart) / total, 0, 1);
    const risePos = clamp((sunrise - dayStart) / total, 0, 1);
    const setPos = clamp((sunset - dayStart) / total, 0, 1);
    const noonPos = clamp((noon - dayStart) / total, 0, 1);

    function arcX(t) { return cx - rx * Math.cos(t * Math.PI); }
    function arcY(t) { return cy - ry * Math.sin(t * Math.PI); }

    const riseX = arcX(risePos), riseY = arcY(risePos);
    const setX = arcX(setPos), setY = arcY(setPos);
    const noonX = arcX(noonPos), noonY = arcY(noonPos);

    // horizon line
    let html = '<line x1="' + (cx - rx) + '" y1="' + cy + '" x2="' + (cx + rx) + '" y2="' + cy + '" stroke="var(--line-strong)" stroke-width="1"/>';
    // arc
    html += '<path d="M ' + riseX + ' ' + riseY + ' A ' + rx + ' ' + ry + ' 0 0 1 ' + setX + ' ' + setY + '" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.5"/>';
    // sunrise/sunset markers
    html += '<circle cx="' + riseX + '" cy="' + riseY + '" r="3" fill="var(--accent)"/>';
    html += '<circle cx="' + setX + '" cy="' + setY + '" r="3" fill="var(--accent)"/>';
    // noon marker
    html += '<line x1="' + noonX + '" y1="' + noonY + '" x2="' + noonX + '" y2="' + cy + '" stroke="var(--line-strong)" stroke-width="1" stroke-dasharray="2 3"/>';
    // sun position
    const sx = arcX(sunPos), sy = arcY(sunPos);
    const isDay = now >= sunrise && now <= sunset;
    html += '<circle cx="' + sx + '" cy="' + sy + '" r="6" fill="' + (isDay ? 'var(--accent)' : 'var(--muted)') + '" opacity="0.9"/>';
    html += '<circle cx="' + sx + '" cy="' + sy + '" r="10" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.3"/>';
    // labels
    html += '<text x="' + riseX + '" y="' + (cy + 16) + '" text-anchor="middle" fill="var(--muted)" font-size="10">' + fmtTime(a.sunrise) + '</text>';
    html += '<text x="' + setX + '" y="' + (cy + 16) + '" text-anchor="middle" fill="var(--muted)" font-size="10">' + fmtTime(a.sunset) + '</text>';
    svg.innerHTML = html;
  }

  function renderWeek() {
    const d = state.daily;
    const list = $('#weekList');
    if (!d || !d.length) { list.innerHTML = ''; return; }
    const tu = state.prefs.tempUnit;
    const ru = state.prefs.rainUnit;
    const wu = state.prefs.windUnit;
    const todayStr = new Date().toDateString();
    let html = '';
    d.forEach(function (day, i) {
      const isToday = new Date(day.time).toDateString() === todayStr;
      const min = Math.round(Units.temp(day.tempMin, tu));
      const max = Math.round(Units.temp(day.tempMax, tu));
      const range = clamp((day.tempMax - day.tempMin) / 30, 0, 1);
      const icon = weatherIcon(day.weatherCode, true);
      html += '<div class="week-day' + (isToday ? ' is-today' : '') + '" data-day="' + i + '" role="listitem" tabindex="0">';
      html += '<span class="wd-name">' + (isToday ? 'Today' : fmtDayShort(day.time)) + '</span>';
      html += iconSvg(icon, 'wd-ico');
      html += '<span class="wd-temps"><span class="wd-max">' + max + '°</span><span class="wd-min">' + min + '°</span></span>';
      html += '<div class="wd-range"><div class="wd-range-fill" style="left:' + (min / 40 * 100) + '%;width:' + Math.max(8, range * 100) + '%"></div></div>';
      if (day.precipitationProbMax > 5) {
        html += '<span class="wd-precip">' + iconSvg('droplet') + Math.round(day.precipitationProbMax) + '% · ' + Units.rain(day.precipitationSum, ru).toFixed(1) + ' ' + Units.rainLabel(ru) + '</span>';
      }
      html += '<span class="wd-wind">' + iconSvg('wind') + ' ' + Math.round(Units.wind(day.windMax, wu)) + ' ' + wu + '</span>';
      html += '</div>';
    });
    list.innerHTML = html;
    $$('.week-day', list).forEach(function (el) {
      el.addEventListener('click', function () { openDayDetail(parseInt(el.dataset.day, 10)); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDayDetail(parseInt(el.dataset.day, 10)); }
      });
    });
  }

  function openDayDetail(i) {
    state.selectedDay = i;
    switchView('forecast');
    renderForecast();
  }

  /* ============================================================
     RENDERING — FORECAST VIEW
     ============================================================ */
  function renderForecast() {
    const d = state.daily;
    const days = $('#forecastDays');
    if (!d || !d.length) { days.innerHTML = ''; return; }
    const tu = state.prefs.tempUnit;
    let html = '';
    d.forEach(function (day, i) {
      const isToday = new Date(day.time).toDateString() === new Date().toDateString();
      html += '<button class="forecast-day-tab' + (i === state.selectedDay ? ' is-active' : '') + '" data-day="' + i + '" role="tab" aria-selected="' + (i === state.selectedDay) + '">';
      html += '<div class="fd-name">' + (isToday ? 'Today' : fmtDayShort(day.time)) + '</div>';
      html += '<div class="fd-date">' + fmtDate(day.time) + '</div>';
      html += '<div class="fd-temps"><span class="max">' + Math.round(Units.temp(day.tempMax, tu)) + '°</span> <span class="min">' + Math.round(Units.temp(day.tempMin, tu)) + '°</span></div>';
      html += '</button>';
    });
    days.innerHTML = html;
    $$('.forecast-day-tab', days).forEach(function (el) {
      el.addEventListener('click', function () {
        state.selectedDay = parseInt(el.dataset.day, 10);
        renderForecast();
      });
    });
    renderForecastDetail();
  }

  function renderForecastDetail() {
    const d = state.daily;
    if (!d || !d.length) return;
    const day = d[state.selectedDay];
    const tu = state.prefs.tempUnit;
    const summary = $('#forecastSummary');
    const icon = weatherIcon(day.weatherCode, true);
    summary.innerHTML =
      iconSvg(icon, 'fs-ico') +
      '<div><div class="fs-cond">' + weatherLabel(day.weatherCode) + '</div>' +
      '<div class="fs-meta">' +
      '<span>High <b>' + Math.round(Units.temp(day.tempMax, tu)) + '°</b></span>' +
      '<span>Low <b>' + Math.round(Units.temp(day.tempMin, tu)) + '°</b></span>' +
      '<span>Rain <b>' + Units.rain(day.precipitationSum, state.prefs.rainUnit).toFixed(1) + ' ' + Units.rainLabel(state.prefs.rainUnit) + '</b></span>' +
      '<span>Wind <b>' + Math.round(Units.wind(day.windMax, state.prefs.windUnit)) + ' ' + state.prefs.windUnit + '</b></span>' +
      '<span>Sunrise <b>' + fmtTime(day.sunrise) + '</b></span>' +
      '<span>Sunset <b>' + fmtTime(day.sunset) + '</b></span>' +
      '</div></div>';

    // Build hourly data for this day
    const dayStr = day.time;
    const hours = (state.hourly || []).filter(function (h) { return h.time.slice(0, 10) === dayStr; });
    const charts = $('#forecastCharts');
    if (!hours.length) {
      charts.innerHTML = '<div class="chart-card"><div class="cc-title">No hourly data for this day</div></div>';
      return;
    }
    const labels = hours.map(function (h) { return fmtTimeShort(h.time); });
    const tempData = hours.map(function (h) { return Units.temp(h.temperature, tu); });
    const appData = hours.map(function (h) { return Units.temp(h.apparentTemperature, tu); });
    const windData = hours.map(function (h) { return Units.wind(h.windSpeed, state.prefs.windUnit); });
    const gustData = hours.map(function (h) { return Units.wind(h.windGusts, state.prefs.windUnit); });
    const precipData = hours.map(function (h) { return h.precipitation; });
    const probData = hours.map(function (h) { return h.precipitationProbability; });

    charts.innerHTML =
      '<div class="chart-card"><div class="cc-head"><span class="cc-title">Temperature</span><div class="cc-legend"><span class="lg"><i style="background:var(--accent)"></i>Actual</span><span class="lg"><i style="background:var(--muted)"></i>Feels like</span></div></div><div class="chart-canvas" id="chartTemp"><canvas></canvas><div class="chart-tooltip"></div></div></div>' +
      '<div class="chart-card"><div class="cc-head"><span class="cc-title">Wind</span><div class="cc-legend"><span class="lg"><i style="background:var(--cold)"></i>Sustained</span><span class="lg"><i style="background:var(--muted)"></i>Gusts</span></div></div><div class="chart-canvas" id="chartWind"><canvas></canvas><div class="chart-tooltip"></div></div></div>' +
      '<div class="chart-card"><div class="cc-head"><span class="cc-title">Precipitation</span><div class="cc-legend"><span class="lg"><i style="background:var(--rain)"></i>Amount</span><span class="lg"><i style="background:var(--accent)"></i>Probability</span></div></div><div class="chart-canvas" id="chartPrecip"><canvas></canvas><div class="chart-tooltip"></div></div></div>';

    drawLineChart($('#chartTemp'), labels, [tempData, appData], ['var(--accent)', 'var(--muted)'], tu === 'fahrenheit' ? '°F' : '°C');
    drawLineChart($('#chartWind'), labels, [windData, gustData], ['var(--cold)', 'var(--muted)'], state.prefs.windUnit);
    drawPrecipChart($('#chartPrecip'), labels, precipData, probData);
  }

  function drawLineChart(container, labels, series, colors, unit) {
    if (!container) return;
    const canvas = $('canvas', container);
    const tooltip = $('.chart-tooltip', container);
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const padL = 40, padR = 12, padT = 12, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const allVals = series.flat();
    let min = Math.min.apply(null, allVals), max = Math.max.apply(null, allVals);
    const span = max - min || 1;
    min -= span * 0.1; max += span * 0.1;

    function x(i) { return padL + (i / (labels.length - 1)) * plotW; }
    function y(v) { return padT + (1 - (v - min) / (max - min)) * plotH; }

    // grid
    ctx.strokeStyle = cssVar('--line');
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const gy = padT + (g / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
    }
    // y labels
    ctx.fillStyle = cssVar('--muted');
    ctx.font = '10px ' + cssVar('--font');
    ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const val = max - (g / 4) * (max - min);
      ctx.fillText(Math.round(val) + '', padL - 6, padT + (g / 4) * plotH + 3);
    }
    // x labels (sparse)
    ctx.textAlign = 'center';
    const step = Math.ceil(labels.length / 8);
    for (let i = 0; i < labels.length; i += step) {
      ctx.fillText(labels[i], x(i), H - 8);
    }

    // series
    series.forEach(function (s, si) {
      const color = resolveColor(colors[si]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      s.forEach(function (v, i) {
        if (i === 0) ctx.moveTo(x(i), y(v)); else ctx.lineTo(x(i), y(v));
      });
      ctx.stroke();
      // subtle fill
      if (si === 0) {
        ctx.lineTo(x(s.length - 1), padT + plotH);
        ctx.lineTo(x(0), padT + plotH);
        ctx.closePath();
        ctx.fillStyle = color + '14';
        ctx.fill();
      }
    });

    // interaction
    let active = false;
    function onMove(e) {
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX || (e.touches && e.touches[0].clientX)) - r.left;
      const i = clamp(Math.round((mx - padL) / plotW * (labels.length - 1)), 0, labels.length - 1);
      drawCrosshair(ctx, x(i), padT, plotH, W, H, padL, padR);
      tooltip.style.display = 'block';
      tooltip.style.left = (x(i) + 8) + 'px';
      tooltip.style.top = '8px';
      let tip = '<b>' + labels[i] + '</b>';
      series.forEach(function (s, si) {
        tip += '<br>' + Math.round(s[i] * 10) / 10 + ' ' + unit;
      });
      tooltip.innerHTML = tip;
    }
    function onLeave() { ctx.clearRect(0, 0, W, H); drawLineChart(container, labels, series, colors, unit); tooltip.style.display = 'none'; }
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); onMove(e); }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); onMove(e); }, { passive: false });
  }

  function drawCrosshair(ctx, cx, top, h, W, H, padL, padR) {
    ctx.save();
    ctx.strokeStyle = cssVar('--muted-2');
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, top + h); ctx.stroke();
    ctx.restore();
  }

  function drawPrecipChart(container, labels, amount, prob) {
    if (!container) return;
    const canvas = $('canvas', container);
    const tooltip = $('.chart-tooltip', container);
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const padL = 40, padR = 12, padT = 12, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxAmt = Math.max.apply(null, amount) || 1;
    function x(i) { return padL + (i / (labels.length - 1)) * plotW; }
    function yAmt(v) { return padT + (1 - v / maxAmt) * plotH; }
    function yProb(v) { return padT + (1 - v / 100) * plotH; }
    // grid
    ctx.strokeStyle = cssVar('--line');
    for (let g = 0; g <= 4; g++) { const gy = padT + (g / 4) * plotH; ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke(); }
    ctx.fillStyle = cssVar('--muted'); ctx.font = '10px ' + cssVar('--font'); ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) { ctx.fillText(Math.round(maxAmt - (g / 4) * maxAmt) + '', padL - 6, padT + (g / 4) * plotH + 3); }
    ctx.textAlign = 'center';
    const step = Math.ceil(labels.length / 8);
    for (let i = 0; i < labels.length; i += step) ctx.fillText(labels[i], x(i), H - 8);
    // bars for amount
    const bw = Math.max(2, plotW / labels.length * 0.6);
    amount.forEach(function (v, i) {
      if (v > 0) {
        ctx.fillStyle = cssVar('--rain');
        const bh = (v / maxAmt) * plotH;
        ctx.fillRect(x(i) - bw / 2, padT + plotH - bh, bw, bh);
      }
    });
    // prob line
    ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 1.6;
    ctx.beginPath();
    prob.forEach(function (v, i) { if (i === 0) ctx.moveTo(x(i), yProb(v)); else ctx.lineTo(x(i), yProb(v)); });
    ctx.stroke();
    // interaction
    function onMove(e) {
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX || (e.touches && e.touches[0].clientX)) - r.left;
      const i = clamp(Math.round((mx - padL) / plotW * (labels.length - 1)), 0, labels.length - 1);
      drawCrosshair(ctx, x(i), padT, plotH, W, H, padL, padR);
      tooltip.style.display = 'block';
      tooltip.style.left = (x(i) + 8) + 'px'; tooltip.style.top = '8px';
      tooltip.innerHTML = '<b>' + labels[i] + '</b><br>' + amount[i].toFixed(1) + ' mm<br>' + Math.round(prob[i]) + '%';
    }
    function onLeave() { ctx.clearRect(0, 0, W, H); drawPrecipChart(container, labels, amount, prob); tooltip.style.display = 'none'; }
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); onMove(e); }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); onMove(e); }, { passive: false });
  }

  /* ============================================================
     RENDERING — ENVIRONMENT VIEW
     ============================================================ */
  function renderEnvironment() {
    const aq = state.airQuality;
    if (!aq) return;
    const cat = aqiCategory(aq.aqi);
    $('#aqValue').textContent = aq.aqi != null ? Math.round(aq.aqi) : '—';
    $('#aqCategory').textContent = cat.label;
    $('#aqDesc').textContent = cat.desc;
    const marker = $('#aqMarker');
    marker.style.left = clamp(cat.pct, 0.02, 0.98) * 100 + '%';
    const pollutants = [
      { name: 'PM2.5', val: aq.pm25, unit: 'µg/m³' },
      { name: 'PM10', val: aq.pm10, unit: 'µg/m³' },
      { name: 'NO₂', val: aq.no2, unit: 'µg/m³' },
      { name: 'O₃', val: aq.ozone, unit: 'µg/m³' },
      { name: 'SO₂', val: aq.so2, unit: 'µg/m³' },
      { name: 'CO', val: aq.co, unit: 'µg/m³' },
    ];
    $('#aqPollutants').innerHTML = pollutants.map(function (p) {
      const v = p.val != null ? (p.val >= 100 ? Math.round(p.val) : p.val.toFixed(1)) : '—';
      return '<div class="aq-pollutant"><div class="ap-name">' + p.name + '</div><div class="ap-val">' + v + ' <small>' + p.unit + '</small></div></div>';
    }).join('');

    // env atmospheric grid (reuse)
    const c = state.current;
    const grid = $('#envAtmoGrid');
    if (c) {
      const pu = state.prefs.pressureUnit;
      const du = state.prefs.distanceUnit;
      const dp = dewPoint(c.temperature, c.humidity);
      const tu = state.prefs.tempUnit;
      const trend = pressureTrend(state.hourly);
      grid.innerHTML = [
        { icon: 'gauge', k: 'Pressure', v: Math.round(Units.pressure(c.pressure, pu)) + ' ' + Units.pressureLabel(pu), d: trend },
        { icon: 'humidity', k: 'Humidity', v: Math.round(c.humidity) + '%', d: 'Dew point ' + Math.round(Units.temp(dp, tu)) + '°' },
        { icon: 'eye', k: 'Visibility', v: Units.distance(c.visibility / 1000, du).toFixed(1) + ' ' + Units.distanceLabel(du), d: c.visibility >= 10000 ? 'Clear' : 'Reduced' },
        { icon: 'cloud', k: 'Cloud cover', v: Math.round(c.cloudCover) + '%', d: '' },
        { icon: 'uv', k: 'UV index', v: c.uvIndex.toFixed(1), d: uvCategory(c.uvIndex) },
        { icon: 'wind', k: 'Wind', v: Math.round(Units.wind(c.windSpeed, state.prefs.windUnit)) + ' ' + state.prefs.windUnit, d: cardinal(c.windDirection) },
      ].map(function (card) {
        return '<div class="atmo-card"><div class="atmo-card-head">' + iconSvg(card.icon) + '<span class="k">' + card.k + '</span></div><div class="v">' + card.v + '</div><div class="d">' + card.d + '</div></div>';
      }).join('');
    }

    // env sun/moon stats
    const a = state.astronomy;
    if (a) {
      $('#envSunmoonStats').innerHTML =
        '<div class="sm-row"><span class="k">Sunrise</span><span class="v">' + fmtTime(a.sunrise) + '</span></div>' +
        '<div class="sm-row"><span class="k">Sunset</span><span class="v">' + fmtTime(a.sunset) + '</span></div>' +
        '<div class="sm-row"><span class="k">Solar noon</span><span class="v">' + fmtTime(a.solarNoon) + '</span></div>' +
        '<div class="sm-row"><span class="k">Daylight</span><span class="v">' + fmtDuration(a.daylightMinutes) + '</span></div>' +
        '<div class="sm-row"><span class="k">Moon phase</span><span class="v">' + a.moonPhase + '</span></div>' +
        '<div class="sm-row"><span class="k">Illumination</span><span class="v">' + Math.round(a.moonIllumination * 100) + '%</span></div>';
    }
  }

  /* ============================================================
     LOCATION MODAL
     ============================================================ */
  function openLocationModal() {
    const modal = $('#locModal');
    modal.hidden = false;
    $('#locSearch').value = '';
    $('#locResultsSection').hidden = true;
    $('#locResults').innerHTML = '';
    renderSavedPlaces();
    renderRecentPlaces();
    $('#locSearch').focus();
  }

  function closeLocationModal() {
    $('#locModal').hidden = true;
  }

  function renderSavedPlaces() {
    const section = $('#locSavedSection');
    const list = $('#locSaved');
    if (!state.saved.length) { section.hidden = true; return; }
    section.hidden = false;
    list.innerHTML = state.saved.map(function (p, i) {
      return '<div class="modal-place" data-saved="' + i + '">' +
        iconSvg('location', 'mp-ico') +
        '<div class="mp-info"><span class="mp-name">' + esc(p.name) + '</span><span class="mp-sub">' + esc(p.country || '') + '</span></div>' +
        iconSvg('star', 'mp-star saved') +
        '</div>';
    }).join('');
    $$('.modal-place[data-saved]', list).forEach(function (el) {
      el.addEventListener('click', function () { selectLocation(state.saved[parseInt(el.dataset.saved, 10)]); });
    });
  }

  function renderRecentPlaces() {
    const section = $('#locRecentSection');
    const list = $('#locRecent');
    if (!state.recent.length) { section.hidden = true; return; }
    section.hidden = false;
    list.innerHTML = state.recent.map(function (p, i) {
      return '<div class="modal-place" data-recent="' + i + '">' +
        iconSvg('location', 'mp-ico') +
        '<div class="mp-info"><span class="mp-name">' + esc(p.name) + '</span><span class="mp-sub">' + esc(p.country || '') + '</span></div>' +
        '</div>';
    }).join('');
    $$('.modal-place[data-recent]', list).forEach(function (el) {
      el.addEventListener('click', function () { selectLocation(state.recent[parseInt(el.dataset.recent, 10)]); });
    });
  }

  function selectLocation(loc) {
    state.location = {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      country: loc.country,
      admin1: loc.admin1,
    };
    // add to recent (dedupe)
    state.recent = state.recent.filter(function (r) { return r.latitude !== loc.latitude || r.longitude !== loc.longitude; });
    state.recent.unshift({ name: loc.name, latitude: loc.latitude, longitude: loc.longitude, country: loc.country, admin1: loc.admin1 });
    state.recent = state.recent.slice(0, 6);
    Store.set(STORAGE_KEYS.recent, state.recent);
    closeLocationModal();
    renderLocationBar();
    loadWeather();
  }

  async function searchLocations(query) {
    if (!query || query.length < 2) return;
    try {
      const results = await Providers.openMeteo.geocode(query);
      const section = $('#locResultsSection');
      const list = $('#locResults');
      section.hidden = false;
      if (!results.length) {
        list.innerHTML = '<div class="modal-empty">No results found.</div>';
        return;
      }
      list.innerHTML = results.map(function (p, i) {
        return '<div class="modal-place" data-result="' + i + '">' +
          iconSvg('location', 'mp-ico') +
          '<div class="mp-info"><span class="mp-name">' + esc(p.name) + '</span><span class="mp-sub">' + esc(p.admin1 || '') + (p.admin1 ? ', ' : '') + esc(p.country || '') + '</span></div>' +
          '</div>';
      }).join('');
      $$('.modal-place[data-result]', list).forEach(function (el) {
        el.addEventListener('click', function () { selectLocation(results[parseInt(el.dataset.result, 10)]); });
      });
    } catch (e) {
      console.warn('Geocode failed', e);
    }
  }

  function useDeviceLocation() {
    if (!navigator.geolocation) {
      $('#locEmpty').hidden = false;
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      const loc = {
        name: 'Current location',
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        country: '',
        admin1: '',
      };
      selectLocation(loc);
    }, function () {
      $('#locEmpty').hidden = false;
    });
  }

  /* ============================================================
     SETTINGS
     ============================================================ */
  function applyTheme() {
    const theme = state.prefs.theme;
    let resolved = theme;
    if (theme === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', resolved);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0D0F10' : '#F3EFE7');
    // update theme seg
    $$('#themeSeg button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.theme === theme); });
  }

  function applyReduceMotion() {
    document.body.classList.toggle('reduce-motion', state.prefs.reduceMotion);
  }

  function savePrefs() {
    Store.set(STORAGE_KEYS.prefs, state.prefs);
  }

  function bindSettings() {
    // theme
    $$('#themeSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.prefs.theme = b.dataset.theme;
        savePrefs();
        applyTheme();
      });
    });
    // motion
    $('#motionToggle').addEventListener('change', function (e) {
      state.prefs.reduceMotion = e.target.checked;
      savePrefs();
      applyReduceMotion();
    });
    // units
    bindSeg('#tempUnitSeg', 'tempUnit');
    bindSeg('#windUnitSeg', 'windUnit');
    bindSeg('#rainUnitSeg', 'rainUnit');
    bindSeg('#pressureUnitSeg', 'pressureUnit');
    bindSeg('#distanceUnitSeg', 'distanceUnit');
    // refresh interval
    $('#refreshInterval').addEventListener('change', function (e) {
      state.prefs.refreshInterval = parseInt(e.target.value, 10);
      savePrefs();
      $('#refreshIntervalLabel').textContent = e.target.value + ' min';
      scheduleRefresh();
    });
    // geo permission
    $('#geoPermToggle').addEventListener('change', function (e) {
      state.prefs.useGeo = e.target.checked;
      savePrefs();
      if (e.target.checked) useDeviceLocation();
    });
    // notifications
    ['notifRain', 'notifSevere', 'notifFrost', 'notifWind', 'notifUV'].forEach(function (key) {
      $('#' + key).addEventListener('change', function (e) {
        state.prefs[key] = e.target.checked;
        savePrefs();
      });
    });
    renderSavedPlacesSettings();
  }

  function bindSeg(sel, prefKey) {
    $$(sel + ' button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.prefs[prefKey] = b.dataset.unit;
        savePrefs();
        $$(sel + ' button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        renderAll();
      });
    });
  }

  function renderSavedPlacesSettings() {
    const container = $('#savedPlaces');
    if (!state.saved.length) {
      container.innerHTML = '<div class="saved-empty">No saved places yet. Search for a city and save it.</div>';
      return;
    }
    container.innerHTML = state.saved.map(function (p, i) {
      return '<div class="saved-place">' +
        '<div class="sp-info"><span class="sp-name">' + esc(p.name) + '</span><span class="sp-coords">' + p.latitude.toFixed(3) + '° N, ' + p.longitude.toFixed(3) + '° E</span></div>' +
        '<div class="sp-actions">' +
        '<button data-goto="' + i + '" aria-label="Go to ' + esc(p.name) + '">' + iconSvg('location') + '</button>' +
        '<button data-remove="' + i + '" class="danger" aria-label="Remove ' + esc(p.name) + '">' + iconSvg('trash') + '</button>' +
        '</div></div>';
    }).join('');
    $$('[data-goto]', container).forEach(function (el) {
      el.addEventListener('click', function () { selectLocation(state.saved[parseInt(el.dataset.goto, 10)]); });
    });
    $$('[data-remove]', container).forEach(function (el) {
      el.addEventListener('click', function () {
        state.saved.splice(parseInt(el.dataset.remove, 10), 1);
        Store.set(STORAGE_KEYS.saved, state.saved);
        renderSavedPlacesSettings();
      });
    });
  }

  function saveCurrentLocation() {
    const loc = state.location;
    const exists = state.saved.some(function (s) { return s.latitude === loc.latitude && s.longitude === loc.longitude; });
    if (!exists) {
      state.saved.push({ name: loc.name, latitude: loc.latitude, longitude: loc.longitude, country: loc.country, admin1: loc.admin1 });
      Store.set(STORAGE_KEYS.saved, state.saved);
      notify('Location saved', loc.name + ' added to saved places.');
      renderSavedPlacesSettings();
    }
  }

  /* ============================================================
     NOTIFICATIONS
     ============================================================ */
  function notify(title, msg, warn) {
    const stack = $('#notifStack');
    const el = document.createElement('div');
    el.className = 'notif' + (warn ? ' warn' : '');
    el.innerHTML =
      iconSvg(warn ? 'bell' : 'info', 'n-ico') +
      '<div class="n-body"><div class="n-title">' + esc(title) + '</div><div class="n-msg">' + esc(msg) + '</div></div>' +
      '<button class="n-close" aria-label="Dismiss">' + iconSvg('close') + '</button>';
    stack.appendChild(el);
    el.querySelector('.n-close').addEventListener('click', function () {
      el.classList.add('leaving');
      setTimeout(function () { el.remove(); }, 300);
    });
    setTimeout(function () {
      if (el.parentNode) { el.classList.add('leaving'); setTimeout(function () { el.remove(); }, 300); }
    }, 6000);
  }

  function checkNotifications() {
    if (!state.current || !state.hourly) return;
    const c = state.current;
    const h = state.hourly;
    // rain soon
    if (state.prefs.notifRain) {
      for (let i = 1; i < Math.min(h.length, 6); i++) {
        if (h[i].precipitationProbability >= 50) {
          notify('Rain expected', 'Rain likely around ' + fmtTime(h[i].time) + '.', false);
          break;
        }
      }
    }
    // strong wind
    if (state.prefs.notifWind && c.windGusts >= 20) {
      notify('Strong wind', 'Gusts reaching ' + Math.round(c.windGusts) + ' m/s.', true);
    }
    // frost
    if (state.prefs.notifFrost && c.temperature <= 0) {
      notify('Frost risk', 'Temperatures at or below freezing.', true);
    }
    // high UV
    if (state.prefs.notifUV && c.uvIndex >= 8) {
      notify('High UV', 'UV index is ' + c.uvIndex.toFixed(1) + ' — take precautions.', true);
    }
  }

  /* ============================================================
     NAVIGATION
     ============================================================ */
  function switchView(view) {
    state.activeView = view;
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.dataset.viewPanel === view); });
    $$('.nav-item[data-view]').forEach(function (n) {
      const active = n.dataset.view === view;
      n.classList.toggle('is-active', active);
      if (active) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
    });
    if (view === 'forecast') renderForecast();
    if (view === 'environment') renderEnvironment();
  }

  /* ============================================================
     REFRESH SCHEDULING
     ============================================================ */
  let refreshTimer = null;
  function scheduleRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    const mins = state.prefs.refreshInterval;
    refreshTimer = setInterval(function () {
      loadWeather();
    }, mins * 60 * 1000);
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    applyTheme();
    applyReduceMotion();
    bindSettings();
    bindNavigation();
    bindLocationModal();
    // restore saved location if any (last used)
    const cache = Store.get(STORAGE_KEYS.cache, null);
    if (cache && cache.location) {
      state.location = cache.location;
    }
    renderLocationBar();
    loadWeather();
    scheduleRefresh();
    // system theme listener
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
      if (state.prefs.theme === 'system') applyTheme();
    });
    // online/offline
    window.addEventListener('online', function () {
      state.offline = false;
      loadWeather();
      notify('Back online', 'Weather data refreshed.');
    });
    window.addEventListener('offline', function () {
      state.offline = true;
      updateUpdatedLabel();
    });
  }

  function bindNavigation() {
    $$('.nav-item[data-view]').forEach(function (n) {
      n.addEventListener('click', function () { switchView(n.dataset.view); });
    });
    $('#navCollapse').addEventListener('click', function () {
      $('#app').classList.toggle('nav-collapsed');
    });
    $('#refreshBtn').addEventListener('click', function () {
      const btn = $('#refreshBtn');
      btn.classList.add('spinning');
      loadWeather().then(function () { btn.classList.remove('spinning'); });
    });
  }

  function bindLocationModal() {
    $('#locBtn').addEventListener('click', openLocationModal);
    $('#locModalClose').addEventListener('click', closeLocationModal);
    $('#locModal').addEventListener('click', function (e) { if (e.target === $('#locModal')) closeLocationModal(); });
    $('#locGeoBtn').addEventListener('click', useDeviceLocation);
    let debounce;
    $('#locSearch').addEventListener('input', function (e) {
      clearTimeout(debounce);
      const q = e.target.value;
      debounce = setTimeout(function () { searchLocations(q); }, 300);
    });
    $('#locSearch').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') searchLocations(e.target.value);
    });
  }

  // expose for debugging/verification
  window.Velora = {
    state: state,
    Providers: Providers,
    Units: Units,
    switchView: switchView,
    selectLocation: selectLocation,
    saveCurrentLocation: saveCurrentLocation,
    notify: notify,
  };

  document.addEventListener('DOMContentLoaded', init);
})();
