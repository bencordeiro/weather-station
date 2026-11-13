(() => {
  'use strict';
  const M = globalThis.WeatherModel;
  const $ = id => document.getElementById(id);
  const text = (id, value) => { $(id).textContent = value; };
  const fmt = (value, decimals = 1) => M.valid(value) ? new Intl.NumberFormat('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value) : '—';
  let config = { ...M.defaults }, configReady = false, latest = null, rows = [], dayRows = [], bucketSeconds = 300;
  let range = '24h', metric = 'temp_c', demo = new URL(location.href).searchParams.get('demo') === '1';
  let unit = 'C', offline = false, busy = false, generation = 0, selectedPoint = -1, plot = null, timer, timeOffset = 0;
  try { unit = localStorage.getItem('shelburne-temperature-unit') === 'F' ? 'F' : 'C'; } catch { /* Private browser storage may be unavailable. */ }
  const dateFormatter = options => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, ...options });
  const now = () => Date.now() + timeOffset;
  const temperature = value => M.temperature(value, unit);

  async function request(path) {
    const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Readings unavailable');
    return response.json();
  }
  function applyConfig() {
    text('brand-title', `ESP Weather ${config.town}`);
    text('footer-brand', `ESP Weather ${config.town}`);
    text('page-title', 'Current conditions');
    text('place-label', `${config.town}, ${config.region}`.toUpperCase());
    text('hero-town', config.town.toUpperCase());
    if (configReady) {
      const elevation = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 3 }).format(config.elevation_m);
      text('station-elevation-value', `${elevation} m`);
      text('station-elevation-status', config.elevation_verified ? 'Station elevation confirmed in settings.' : config.town === 'Shelburne' && config.elevation_m === 500 ? 'Approximate · based on the Shelburne area; station height not yet verified.' : 'Approximate · station height not yet verified.');
      text('elevation-note', `${config.elevation_verified ? 'Station' : 'Approximate'} elevation: ${elevation} m.`);
      text('calibration-height', elevation);
      text('calibration-elevation-status', config.elevation_verified ? 'confirmed' : 'provisional');
    }
    text('footer-timezone', `LOCAL TIME · ${config.timezone.toUpperCase()}`);
    document.title = `ESP Weather ${config.town} · Current conditions`;
    const active = config.wind_enabled || config.rain_enabled;
    text('instruments-caption', active ? 'Available instruments' : 'Physical instruments in progress');
    text('instruments-badge', active ? 'STATION OBSERVATIONS' : 'COMING LATER');
    if (config.wind_enabled) addMetric('wind_kmh', 'Wind speed');
    if (config.rain_enabled) addMetric('rain_tips', 'Rain tip counts');
  }
  function addMetric(value, label) {
    if ([...$('metric').options].some(option => option.value === value)) return;
    const option = document.createElement('option'); option.value = value; option.textContent = label;
    $('metric').append(option);
  }
  function renderTime() {
    text('local-clock', dateFormatter({ hour: 'numeric', minute: '2-digit' }).format(now()));
    const date = dateFormatter({ weekday: 'short', month: 'long', day: 'numeric' }).format(now());
    const zone = dateFormatter({ timeZoneName: 'short' }).formatToParts(now()).find(part => part.type === 'timeZoneName').value;
    text('local-date', `${date} · ${zone}`);
    if (latest) renderFreshness();
  }
  function renderFreshness() {
    const reading = latest?.reading;
    const age = reading ? Math.max(0, (now() - reading.received_at) / 1000) : null;
    const state = offline ? 'offline' : !reading ? 'waiting' : age > config.stale_after_seconds ? 'stale' : 'online';
    document.body.dataset.state = state;
    document.body.dataset.demo = String(demo);
    text('header-status', demo ? 'Sample preview' : { online: 'Station live', stale: 'Awaiting update', waiting: 'Station pending', offline: 'Connection lost' }[state]);
    text('reading-state', demo ? 'Sample reading' : { online: 'Latest observation', stale: 'Last observation', waiting: 'Waiting for station', offline: 'Connection unavailable' }[state]);
    if (reading) {
      const ageText = age < 60 ? `${Math.floor(age)} seconds ago` : age < 3600 ? `${Math.floor(age / 60)} minutes ago` : dateFormatter({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(reading.received_at);
      text('updated-at', demo ? 'Illustrative sample · not live weather' : `Observed ${ageText}`);
    } else text('updated-at', offline ? 'Reconnecting automatically' : 'First reading on its way');
    const note = $('connection-note');
    note.hidden = demo || (!offline && state !== 'stale');
    note.textContent = offline ? 'The station connection is temporarily unavailable. Any displayed readings are the last ones received; we’ll try again automatically.' : state === 'stale' ? 'The station has not sent a recent update. These are the last received observations, not current conditions.' : '';
  }
  function renderReadings() {
    const reading = latest?.reading;
    $('demo-banner').hidden = !demo;
    $('empty-message').hidden = Boolean(reading) || demo;
    $('unit-c').classList.toggle('selected', unit === 'C'); $('unit-c').setAttribute('aria-pressed', String(unit === 'C'));
    $('unit-f').classList.toggle('selected', unit === 'F'); $('unit-f').setAttribute('aria-pressed', String(unit === 'F'));
    text('temperature', fmt(temperature(reading?.temp_c)));
    text('daily-high', `${fmt(temperature(latest?.today?.high_c))}°`);
    text('daily-low', `${fmt(temperature(latest?.today?.low_c))}°`);
    text('temperature-caption', reading ? reading.temp_c === null ? 'Temperature sensor unavailable.' : 'Temperature at the station.' : 'Waiting for temperature data.');
    text('humidity', fmt(reading?.humidity, 0));
    text('humidity-caption', M.valid(reading?.temp_c) && M.valid(reading?.humidity) && reading.humidity > 0 ? `Dew point ${fmt(temperature(dewPoint(reading.temp_c, reading.humidity)))}°${unit} · calculated` : 'Relative humidity');
    text('pressure', fmt(reading?.pressure_sea_level));
    text('raw-pressure', M.valid(reading?.pressure) ? `${fmt(reading.pressure)} hPa` : '—');
    text('pressure-caption', `Sea-level estimate · ${config.elevation_verified ? 'elevation set' : 'provisional'}`);
    const kilolux = M.valid(reading?.lux) && reading.lux >= 1000;
    text('light', fmt(kilolux ? reading.lux / 1000 : reading?.lux, kilolux ? 1 : 0));
    text('light-unit', kilolux ? 'klux' : 'lux'); text('uv', fmt(reading?.uv, 0)); text('sound', fmt(reading?.sound, 0));
    if (config.wind_enabled || config.rain_enabled) {
      const descriptions = [];
      if (config.wind_enabled) descriptions.push(`Wind: ${fmt(reading?.wind_kmh)} km/h.`);
      if (config.rain_enabled) descriptions.push(`Rain today: ${fmt(latest?.today?.rain_tips, 0)} tips${config.rain_mm_per_tip ? ` (${fmt(latest.today.rain_tips * config.rain_mm_per_tip)} mm)` : '; calibration pending'}.`);
      text('instruments-detail', descriptions.join(' '));
    }
    renderPressureStory(); renderTime(); renderMiniCharts(); renderChart();
  }
  function dewPoint(celsius, humidity) {
    const gamma = Math.log(humidity / 100) + 17.625 * celsius / (243.04 + celsius);
    return 243.04 * gamma / (17.625 - gamma);
  }
  function renderPressureStory() {
    const trend = latest?.pressure_trend;
    if (!trend) {
      text('pressure-story-title', 'Pressure trend');
      text('pressure-story-copy', 'Once we have about three hours of readings, the barometer can show whether pressure is rising, falling, or holding steady.');
      text('pressure-delta', 'Collecting local history'); return;
    }
    const stale = !demo && (offline || !latest.reading || now() - latest.reading.received_at > config.stale_after_seconds * 1000);
    const stories = {
      rising: ['Pressure rising', 'Rising pressure can accompany more settled conditions. This is an observed tendency, not a weather forecast.'],
      falling: ['Pressure falling', 'Falling pressure can accompany more unsettled conditions. This is an observed tendency, not a weather forecast.'],
      steady: ['Pressure steady', 'The barometer has changed little over the past few hours. Pressure alone does not provide a local forecast.'],
    };
    const story = stories[trend.direction] || stories.steady;
    text('pressure-story-title', stale ? 'Last pressure trend' : story[0]);
    text('pressure-story-copy', stale ? 'These readings are no longer recent. The last observed pressure change is shown below; a fresh update will restore the current tendency.' : story[1]);
    text('pressure-delta', `${trend.delta_hpa > 0 ? '+' : ''}${fmt(trend.delta_hpa)} hPa over ${fmt(trend.hours)} hours${demo ? ' · sample' : ''}`);
  }
  async function refresh() {
    if (busy) return;
    busy = true; $('refresh').disabled = true;
    const id = ++generation, requestedRange = range;
    try {
      if (demo) {
        const data = M.demo(config, Date.now(), requestedRange);
        latest = M.demo(config).latest; rows = data.readings; bucketSeconds = data.bucket_seconds;
        dayRows = requestedRange === '24h' ? rows : M.demo(config).readings;
        offline = false; timeOffset = 0;
      } else {
        const [current, history, day] = await Promise.all([request('/api/latest'), request(`/api/history?range=${requestedRange}`), requestedRange === '24h' ? Promise.resolve(null) : request('/api/history?range=24h')]);
        if (id !== generation) return;
        latest = current; rows = history.readings; bucketSeconds = history.bucket_seconds;
        dayRows = day?.readings || rows; offline = false;
        timeOffset = current.server_time - Date.now();
      }
      if (id === generation) renderReadings();
    } catch {
      if (id === generation) { offline = true; renderReadings(); }
    } finally {
      busy = false; $('refresh').disabled = false;
      if (id !== generation || requestedRange !== range) refresh();
    }
  }
  function svgNode(name, attributes = {}, content) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function linePath(points, x, y, gap) {
    let previous;
    return points.map(point => {
      const command = !previous || point.time - previous.time > gap ? 'M' : 'L';
      previous = point; return `${command}${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`;
    }).join(' ');
  }
  function chartPalette(key) {
    const styles = getComputedStyle(document.documentElement);
    const token = { temp_c: 'temp', humidity: 'humidity', pressure: 'pressure', pressure_sea_level: 'pressure', lux: 'lux', uv: 'uv', sound: 'sound', wind_kmh: 'humidity', rain_tips: 'humidity' }[key];
    return {
      color: styles.getPropertyValue(`--plot-${token}`).trim() || M.metrics[key].color,
      grid: styles.getPropertyValue('--plot-grid').trim(),
      label: styles.getPropertyValue('--plot-label').trim(),
      surface: styles.getPropertyValue('--chart-surface').trim(),
    };
  }
  function renderMiniCharts() {
    document.querySelectorAll('[data-spark], [data-mini]').forEach(container => {
      const key = container.dataset.spark || container.dataset.mini;
      const palette = chartPalette(key);
      const points = M.points(dayRows, key, unit), small = Boolean(container.dataset.spark);
      container.replaceChildren();
      if (!points.length) {
        if (!small) { const message = document.createElement('div'); message.className = 'mini-empty'; message.textContent = 'History will appear as readings arrive.'; container.append(message); }
        return;
      }
      const width = small ? 104 : 320, height = small ? 42 : 95;
      const low = Math.min(...points.map(p => p.value)), high = Math.max(...points.map(p => p.value));
      const span = Math.max(high - low, .5), padding = small ? 3 : 10;
      const start = now() - M.ranges['24h'];
      const x = time => padding + (time - start) / M.ranges['24h'] * (width - padding * 2);
      const y = value => height - padding - (value - low + span * .1) / (span * 1.2) * (height - padding * 2);
      const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: small ? 'presentation' : 'img', 'aria-label': `${M.metrics[key].name}, last 24 hours` });
      if (!small) svg.append(svgNode('line', { x1: padding, x2: width - padding, y1: height - padding, y2: height - padding, stroke: palette.grid }));
      svg.append(svgNode('path', { d: linePath(points, x, y, 900000), fill: 'none', stroke: palette.color, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
      if (!small) {
        const last = points.at(-1);
        svg.append(svgNode('circle', { cx: x(last.time), cy: y(last.value), r: 2.5, fill: palette.color }));
      }
      container.append(svg);
    });
  }
  function renderChart() {
    const container = $('main-chart'), definition = M.metrics[metric], palette = chartPalette(metric);
    document.querySelector('.legend-dot').style.backgroundColor = palette.color;
    const points = M.points(rows, metric, unit), chartUnit = metric === 'temp_c' ? `°${unit}` : definition.unit;
    text('chart-unit', `${definition.name} · ${chartUnit}`);
    text('chart-footnote', `Toronto local time · ${dateFormatter({ timeZoneName: 'short' }).formatToParts(now()).find(p => p.type === 'timeZoneName').value}${demo ? ' · sample data' : ''}`);
    text('chart-count', `${points.length.toLocaleString('en-CA')} ${demo ? 'sample points' : 'data points'}`);
    $('export-link').href = `/api/export.csv?range=${range}`;
    $('export-link').setAttribute('aria-disabled', String(demo));
    $('export-link').textContent = demo ? 'Sample preview · export disabled' : 'Download readings ↓';
    container.replaceChildren(); plot = null; selectedPoint = -1;
    if (!points.length) {
      const empty = document.createElement('div'); empty.className = 'chart-placeholder'; empty.textContent = 'History will appear as readings arrive.'; container.append(empty);
      text('chart-summary', 'Waiting for observations'); return;
    }
    const values = points.map(p => p.value), min = Math.min(...values), max = Math.max(...values);
    text('chart-summary', `Low ${fmt(min, definition.decimals)} · High ${fmt(max, definition.decimals)} ${chartUnit}`);
    const width = Math.max(240, container.clientWidth), height = Math.max(180, container.clientHeight), padding = { left: 64, right: 12, top: 17, bottom: 38 };
    const start = now() - M.ranges[range], end = now();
    const span = Math.max(max - min, metric.includes('pressure') ? 1 : metric === 'temp_c' ? 2 : 10);
    const low = min - span * .2, high = max + span * .2;
    const x = time => padding.left + (time - start) / (end - start) * (width - padding.left - padding.right);
    const y = value => height - padding.bottom - (value - low) / (high - low) * (height - padding.top - padding.bottom);
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `${definition.name} over the past ${range}. Low ${fmt(min, definition.decimals)}, high ${fmt(max, definition.decimals)} ${chartUnit}.` });
    const defs = svgNode('defs'), gradient = svgNode('linearGradient', { id: 'chart-fill', x1: '0', y1: '0', x2: '0', y2: '1' });
    gradient.append(svgNode('stop', { offset: '0%', 'stop-color': palette.color, 'stop-opacity': '.16' }), svgNode('stop', { offset: '100%', 'stop-color': palette.color, 'stop-opacity': '0' })); defs.append(gradient); svg.append(defs);
    for (let i = 0; i <= 4; i++) {
      const value = low + (high - low) / 4 * i, py = y(value);
      svg.append(svgNode('line', { x1: padding.left, x2: width - padding.right, y1: py, y2: py, stroke: palette.grid, 'stroke-width': '.8', 'stroke-dasharray': '3 5' }));
      svg.append(svgNode('text', { x: padding.left - 12, y: py + 4, fill: palette.label, 'font-size': 12, 'text-anchor': 'end' }, fmt(value, metric === 'lux' || metric === 'uv' || metric === 'sound' ? 0 : 1)));
    }
    const ticks = width < 420 ? 2 : width < 760 ? 3 : 6;
    for (let i = 0; i <= ticks; i++) {
      const time = start + (end - start) * i / ticks;
      const label = dateFormatter(range === '7d' ? { month: 'short', day: 'numeric' } : { hour: 'numeric', minute: '2-digit' }).format(time);
      svg.append(svgNode('text', { x: x(time), y: height - 7, fill: palette.label, 'font-size': 12, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' }, label));
    }
    // Each uninterrupted segment receives its own fill, so missing intervals
    // remain visible rather than being drawn as continuous measurements.
    const segments = [];
    for (const point of points) {
      const segment = segments.at(-1);
      if (!segment || point.time - segment.at(-1).time > bucketSeconds * 3000) segments.push([point]);
      else segment.push(point);
    }
    for (const segment of segments) {
      const path = linePath(segment, x, y, Infinity);
      svg.append(svgNode('path', { d: `${path} L${x(segment.at(-1).time)},${height - padding.bottom} L${x(segment[0].time)},${height - padding.bottom} Z`, fill: 'url(#chart-fill)' }));
      svg.append(svgNode('path', { d: path, fill: 'none', stroke: palette.color, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    }
    const last = points.at(-1); svg.append(svgNode('circle', { cx: x(last.time), cy: y(last.value), r: 3, fill: palette.color }));
    const cursor = svgNode('g', { visibility: 'hidden' }); svg.append(cursor);
    const tooltip = document.createElement('div'); tooltip.className = 'chart-tooltip'; tooltip.hidden = true;
    container.append(svg, tooltip);
    plot = { points, width, height, x, y, start, end, cursor, tooltip, unit: chartUnit, definition, palette };
  }
  function showPoint(index) {
    if (!plot) return;
    selectedPoint = Math.max(0, Math.min(index, plot.points.length - 1));
    const point = plot.points[selectedPoint], cx = plot.x(point.time), cy = plot.y(point.value);
    plot.cursor.replaceChildren(svgNode('line', { x1: cx, x2: cx, y1: 12, y2: plot.height - 38, class: 'chart-crosshair' }), svgNode('circle', { cx, cy, r: 4, fill: plot.palette.color, stroke: plot.palette.surface, 'stroke-width': 2 }));
    plot.cursor.setAttribute('visibility', 'visible');
    const value = document.createElement('strong'); value.textContent = `${fmt(point.value, plot.definition.decimals)} ${plot.unit}`;
    const time = document.createElement('small'); time.textContent = dateFormatter({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(point.time);
    plot.tooltip.replaceChildren(value, time); plot.tooltip.hidden = false;
    const tooltipWidth = plot.tooltip.getBoundingClientRect().width;
    const position = Math.min(Math.max(cx / plot.width * $('main-chart').clientWidth - tooltipWidth / 2, 0), Math.max(0, $('main-chart').clientWidth - tooltipWidth));
    plot.tooltip.style.left = `${position}px`;
    $('main-chart').setAttribute('aria-label', `${plot.definition.name}: ${value.textContent}, ${time.textContent}. Use left and right arrow keys to explore.`);
  }
  $('main-chart').addEventListener('pointermove', event => {
    if (!plot) return;
    const bounds = $('main-chart').getBoundingClientRect();
    const virtualX = (event.clientX - bounds.left) / bounds.width * plot.width;
    let nearest = 0, distance = Infinity;
    plot.points.forEach((point, index) => { const delta = Math.abs(plot.x(point.time) - virtualX); if (delta < distance) { distance = delta; nearest = index; } });
    showPoint(nearest);
  });
  $('main-chart').addEventListener('pointerleave', () => { if (plot && document.activeElement !== $('main-chart')) { plot.cursor.setAttribute('visibility', 'hidden'); plot.tooltip.hidden = true; } });
  $('main-chart').addEventListener('keydown', event => {
    if (!plot || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = selectedPoint < 0 ? plot.points.length - 1 : selectedPoint;
    showPoint(event.key === 'Home' ? 0 : event.key === 'End' ? plot.points.length - 1 : current + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  $('metric').addEventListener('change', () => { metric = $('metric').value; renderChart(); });
  document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
    range = button.dataset.range;
    document.querySelectorAll('[data-range]').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    refresh();
  }));
  document.querySelectorAll('[data-explore]').forEach(button => button.addEventListener('click', () => { metric = button.dataset.explore; $('metric').value = metric; renderChart(); $('trends').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  for (const value of ['C', 'F']) $('unit-' + value.toLowerCase()).addEventListener('click', () => { unit = value; try { localStorage.setItem('shelburne-temperature-unit', unit); } catch {} renderReadings(); });
  $('refresh').addEventListener('click', refresh);
  $('export-link').addEventListener('click', event => { if (demo) event.preventDefault(); });
  function setDemo(value) {
    demo = value; generation++; latest = null; rows = []; dayRows = []; timeOffset = 0;
    const url = new URL(location.href); value ? url.searchParams.set('demo', '1') : url.searchParams.delete('demo');
    history.replaceState(null, '', url);
    renderReadings();
    if (!busy) refresh();
  }
  $('enter-demo').addEventListener('click', () => setDemo(true)); $('exit-demo').addEventListener('click', () => setDemo(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderChart, 100); });
  window.addEventListener('weather-theme-change', () => { renderMiniCharts(); renderChart(); });
  document.querySelectorAll('.site-header nav a').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.site-header nav a').forEach(item => item.classList.toggle('active', item === link));
  }));
  document.querySelectorAll('a[href="#pressure-notes"]').forEach(link => link.addEventListener('click', () => { $('pressure-notes').open = true; }));
  async function init() {
    applyConfig(); renderTime();
    try { config = { ...M.defaults, ...await request('/api/config') }; configReady = true; applyConfig(); } catch { text('station-elevation-status', 'Station elevation unavailable.'); offline = !demo; }
    await refresh();
    timer = setInterval(() => { if (!document.hidden) refresh(); }, config.refresh_seconds * 1000);
    setInterval(() => { if (!document.hidden) { renderTime(); renderPressureStory(); } }, 1000);
  }
  window.addEventListener('pagehide', () => clearInterval(timer));
  init();
})();
