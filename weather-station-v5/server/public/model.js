globalThis.WeatherModel = (() => {
  const ranges = { '6h': 21600000, '24h': 86400000, '7d': 604800000 };
  const defaults = { town: 'Shelburne', region: 'Ontario', timezone: 'America/Toronto', refresh_seconds: 30, stale_after_seconds: 300, elevation_m: 500, elevation_verified: false, pressure_offset_hpa: 0, rain_mm_per_tip: null, wind_enabled: false, rain_enabled: false };
  const metrics = {
    temp_c: { name: 'Temperature', unit: '°C', decimals: 1, color: '#b85b3b' },
    humidity: { name: 'Relative humidity', unit: '% RH', decimals: 1, color: '#477a78' },
    pressure_sea_level: { name: 'Sea-level pressure estimate', unit: 'hPa', decimals: 1, color: '#426d50' },
    pressure: { name: 'Sensor pressure', unit: 'hPa', decimals: 1, color: '#426d50' },
    lux: { name: 'Ambient light', unit: 'lux', decimals: 0, color: '#ae823c' },
    uv: { name: 'UV sensor · raw', unit: 'ADC', decimals: 0, color: '#947252' },
    sound: { name: 'Sound amplitude · raw', unit: 'ADC', decimals: 0, color: '#768375' },
    wind_kmh: { name: 'Wind speed', unit: 'km/h', decimals: 1, color: '#477a78' },
    rain_tips: { name: 'Rain tips', unit: 'tips', decimals: 0, color: '#477a78' },
  };
  const valid = value => typeof value === 'number' && Number.isFinite(value);
  const temperature = (value, unit) => valid(value) ? unit === 'F' ? value * 9 / 5 + 32 : value : null;
  const seaLevel = (pressure, elevation = 500, offset = 0) => valid(pressure) ? (pressure + offset) / (1 - 0.0065 * elevation / 288) ** 5.2561 : null;
  function points(rows, key, unit = 'C') {
    return rows.filter(row => valid(row.received_at) && valid(row[key])).map(row => ({ time: row.received_at, value: key === 'temp_c' ? temperature(row[key], unit) : row[key] }));
  }
  function demo(config = defaults, now = Date.now(), range = '24h') {
    const step = range === '7d' ? 1800000 : range === '6h' ? 60000 : 300000;
    const end = Math.floor(now / step) * step;
    const start = end - ranges[range];
    const rows = [];
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    for (let time = start; time <= end; time += step) {
      const parts = hour.formatToParts(time);
      const localHour = Number(parts.find(p => p.type === 'hour').value) + Number(parts.find(p => p.type === 'minute').value) / 60;
      const dayWave = Math.sin((localHour - 8) / 24 * 2 * Math.PI);
      const texture = Math.sin(time / 3700000) * 0.25 + Math.sin(time / 1700000) * 0.1;
      const pressure = 954.8 + Math.sin(time / 30000000) * 1.8;
      const row = { received_at: time, temp_c: 12 + dayWave * 5.7 + texture,
        humidity: 64 - dayWave * 16 + texture * 2, pressure, alt_m: 500,
        lux: Math.max(0, Math.sin((localHour - 7) / 12 * Math.PI)) * (localHour >= 7 && localHour <= 19 ? 23500 : 0),
        uv: Math.max(0, dayWave * 650 + 120), sound: 90 + Math.sin(time / 470000) * 25 + Math.sin(time / 740000) * 14,
        wind_kmh: null, rain_tips: null, samples: step / 60000,
        pressure_calibrated: pressure + config.pressure_offset_hpa, pressure_sea_level: seaLevel(pressure, config.elevation_m, config.pressure_offset_hpa) };
      rows.push(row);
    }
    const reading = { ...rows.at(-1), received_at: now - 18000 };
    const todayLabel = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const todayRows = rows.filter(r => todayLabel.format(r.received_at) === todayLabel.format(now));
    const temperatures = todayRows.map(r => r.temp_c);
    const baseline = rows.reduce((best, row) => Math.abs(row.received_at - (now - 10800000)) < Math.abs(best.received_at - (now - 10800000)) ? row : best, rows[0]);
    const delta = reading.pressure - baseline.pressure;
    return { readings: rows, bucket_seconds: step / 1000, latest: {
      reading, today: { samples: todayRows.length, low_c: Math.min(...temperatures), high_c: Math.max(...temperatures), rain_tips: null, peak_wind_kmh: null },
      server_time: now, station: { state: 'online', age_seconds: 18, bme280_ok: true },
      pressure_trend: { delta_hpa: delta, hours: 3, direction: delta > .5 ? 'rising' : delta < -.5 ? 'falling' : 'steady' },
    } };
  }
  return Object.freeze({ ranges, defaults, metrics, valid, temperature, seaLevel, points, demo });
})();
