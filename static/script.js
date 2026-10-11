const form = document.getElementById('prediction-form');
const errorMessage = document.getElementById('error-message');
const chart = document.getElementById('turnout-chart');
const legend = document.getElementById('chart-legend');
const chartTooltip = document.getElementById('chart-tooltip');
const SVG_NS = 'http://www.w3.org/2000/svg';
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const meals = [
  { key: 'breakfast_count', label: 'Breakfast', color: '#2e6958', dash: '', marker: 'triangle' },
  { key: 'lunch_count', label: 'Lunch', color: '#d9963d', dash: '', marker: 'square' },
  { key: 'snacks_count', label: 'Snacks', color: '#d96f59', dash: '', marker: 'diamond' },
  { key: 'dinner_count', label: 'Dinner', color: '#6489a4', dash: '', marker: 'circle' },
];
let chartData = null;
const activeMeals = new Set(meals.map((meal) => meal.key));

const mealFields = {
  breakfast_count: document.getElementById('breakfast_value'),
  lunch_count: document.getElementById('lunch_value'),
  snacks_count: document.getElementById('snacks_value'),
  dinner_count: document.getElementById('dinner_value'),
  total_turnout: document.getElementById('total_value'),
};

function svgElement(tag, attributes = {}, text = '') {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
}

function mealMarker(meal, x, y, radius = 4.5) {
  const common = {
    fill: '#ffffff',
    stroke: meal.color,
    'stroke-width': 2,
    class: 'chart-point',
    tabindex: 0,
  };

  if (meal.marker === 'triangle') {
    return svgElement('polygon', {
      ...common,
      points: `${x},${y - radius - 1} ${x - radius},${y + radius - 1} ${x + radius},${y + radius - 1}`,
    });
  }
  if (meal.marker === 'square') {
    return svgElement('rect', {
      ...common,
      x: x - radius,
      y: y - radius,
      width: radius * 2,
      height: radius * 2,
      rx: 1,
    });
  }
  if (meal.marker === 'diamond') {
    return svgElement('polygon', {
      ...common,
      points: `${x},${y - radius - 1} ${x + radius},${y} ${x},${y + radius + 1} ${x - radius},${y}`,
    });
  }
  return svgElement('circle', { ...common, cx: x, cy: y, r: radius });
}

function showChartTooltip(marker, day, meal, value) {
  const frame = chart.parentElement;
  const markerBounds = marker.getBoundingClientRect();
  const frameBounds = frame.getBoundingClientRect();
  chartTooltip.textContent = `${day} · ${meal.label}: ${Math.round(value).toLocaleString()} servings`;
  chartTooltip.hidden = false;

  const left = markerBounds.left - frameBounds.left + frame.scrollLeft
    + markerBounds.width / 2 - chartTooltip.offsetWidth / 2;
  const top = markerBounds.top - frameBounds.top + frame.scrollTop
    - chartTooltip.offsetHeight - 8;
  chartTooltip.style.left = `${Math.max(8, Math.min(left, frame.scrollWidth - chartTooltip.offsetWidth - 8))}px`;
  chartTooltip.style.top = `${Math.max(4, top)}px`;
}

function renderChart() {
  chart.replaceChildren();
  if (!chartData) return;

  const width = 960;
  const height = 360;
  const plot = { left: 68, right: 940, top: 62, bottom: 300 };
  const values = meals.flatMap((meal) =>
    activeMeals.has(meal.key)
      ? weekdays.map((day) => chartData.averages[day]?.[meal.key]).filter(Number.isFinite)
      : [],
  );

  if (!values.length) {
    chart.append(svgElement('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'chart-empty' }, 'No meal averages available'));
    return;
  }

  const maxValue = Math.max(...values);
  const tickStep = Math.max(100, Math.ceil(maxValue / 4 / 100) * 100);
  const yMax = tickStep * 4;
  const x = (index) => plot.left + (index * (plot.right - plot.left)) / (weekdays.length - 1);
  const y = (value) => plot.bottom - (value / yMax) * (plot.bottom - plot.top);

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = tick * tickStep;
    const yPosition = y(value);
    chart.append(svgElement('line', { x1: plot.left, y1: yPosition, x2: plot.right, y2: yPosition, class: 'chart-grid' }));
    chart.append(svgElement('text', { x: plot.left - 12, y: yPosition + 4, 'text-anchor': 'end', class: 'chart-axis-label' }, value.toLocaleString()));
  }

  weekdays.forEach((day, index) => {
    chart.append(svgElement('text', { x: x(index), y: plot.bottom + 32, 'text-anchor': 'middle', class: 'chart-x-label' }, day.slice(0, 3)));
    const averageTotal = chartData.averages[day]?.average_total;
    if (Number.isFinite(averageTotal)) {
      chart.append(svgElement('text', {
        x: x(index),
        y: 40,
        'text-anchor': 'middle',
        class: 'chart-total-label',
        'aria-label': `${day} average total turnout: ${Math.round(averageTotal).toLocaleString()} servings`,
      }, Math.round(averageTotal).toLocaleString()));
    }
  });

  meals.filter((meal) => activeMeals.has(meal.key)).forEach((meal) => {
    const points = weekdays
      .map((day, index) => ({ day, index, value: chartData.averages[day]?.[meal.key] }))
      .filter((point) => Number.isFinite(point.value));
    if (!points.length) return;

    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.index)} ${y(point.value)}`).join(' ');
    const lineAttributes = { d: path, class: 'chart-line', stroke: meal.color };
    if (meal.dash) lineAttributes['stroke-dasharray'] = meal.dash;
    chart.append(svgElement('path', lineAttributes));

    points.forEach((point) => {
      const marker = mealMarker(meal, x(point.index), y(point.value));
      marker.setAttribute('aria-label', `${point.day} ${meal.label}: ${Math.round(point.value).toLocaleString()} servings`);
      marker.append(svgElement('title', {}, `${point.day} · ${meal.label}: ${Math.round(point.value).toLocaleString()} servings`));
      marker.addEventListener('pointerenter', () => showChartTooltip(marker, point.day, meal, point.value));
      marker.addEventListener('focus', () => showChartTooltip(marker, point.day, meal, point.value));
      marker.addEventListener('pointerleave', () => { chartTooltip.hidden = true; });
      marker.addEventListener('blur', () => { chartTooltip.hidden = true; });
      chart.append(marker);
    });
  });
}

function renderLegend() {
  legend.replaceChildren();
  meals.forEach((meal) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'legend-toggle';
    button.setAttribute('aria-pressed', String(activeMeals.has(meal.key)));
    button.setAttribute('aria-label', `${activeMeals.has(meal.key) ? 'Hide' : 'Show'} ${meal.label}`);
    const swatch = svgElement('svg', { viewBox: '0 0 44 16', class: 'legend-swatch', 'aria-hidden': 'true' });
    const lineAttributes = { x1: 1, y1: 8, x2: 43, y2: 8, stroke: meal.color, 'stroke-width': 2.5 };
    if (meal.dash) lineAttributes['stroke-dasharray'] = meal.dash;
    swatch.append(svgElement('line', lineAttributes));
    swatch.append(mealMarker(meal, 22, 8, 3.5));
    const label = document.createElement('span');
    label.textContent = meal.label;
    button.append(swatch, label);
    button.addEventListener('click', () => {
      if (activeMeals.has(meal.key)) activeMeals.delete(meal.key);
      else activeMeals.add(meal.key);
      renderLegend();
      renderChart();
    });
    legend.append(button);
  });
}

async function loadAnalytics() {
  const response = await fetch('/analytics');
  if (!response.ok) throw new Error('Could not load meal averages.');
  chartData = await response.json();
  document.getElementById('period-label').textContent = chartData.period_label;
  document.getElementById('record-count').textContent = chartData.record_count.toLocaleString();
  const note = `${chartData.excluded_break_rows} semester-break rows skipped; averages use the latest ${chartData.record_count} eligible records.`;
  document.getElementById('data-note').textContent = note;
  renderLegend();
  renderChart();
}

if (chart && legend && chartTooltip) {
  loadAnalytics().catch((error) => {
    document.getElementById('period-label').textContent = 'Data unavailable';
    document.getElementById('data-note').textContent = error.message;
    chart.append(svgElement('text', { x: 480, y: 180, 'text-anchor': 'middle', class: 'chart-empty' }, 'Unable to load meal averages'));
  });
}

if (form) form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  const predictButton = document.getElementById('predict-button');
  const buttonText = predictButton.querySelector('span');
  const originalButtonText = buttonText.textContent;
  predictButton.disabled = true;
  buttonText.textContent = 'Calculating';

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch('/predict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Prediction failed.');
    }

    const predictions = result.predictions || {};
    mealFields.breakfast_count.textContent = `${predictions.breakfast_count ?? '--'} people`;
    mealFields.lunch_count.textContent = `${predictions.lunch_count ?? '--'} people`;
    mealFields.snacks_count.textContent = `${predictions.snacks_count ?? '--'} people`;
    mealFields.dinner_count.textContent = `${predictions.dinner_count ?? '--'} people`;
    mealFields.total_turnout.textContent = `${result.total_servings ?? '--'} servings`;
    document.getElementById('result-day').textContent = payload.day_of_week;
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
  } finally {
    predictButton.disabled = false;
    buttonText.textContent = originalButtonText;
  }
});
