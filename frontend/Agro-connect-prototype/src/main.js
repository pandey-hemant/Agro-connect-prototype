// AgroConnect Farmer Journey - Main Application Logic
const API_BASE = 'http://localhost:5001/api';

let currentState = {
  crop: '',
  state: '',
  quantity: 1000,
  currentPrice: null,
  prediction: null,
  marketPrices: [],
};

// Initialize event listeners
document.addEventListener('DOMContentLoaded', () => {
  const cropSelect = document.getElementById('cropSelect');
  const stateSelect = document.getElementById('stateSelect');
  const loadPricesBtn = document.getElementById('loadPricesBtn');
  const quantityInput = document.getElementById('quantityInput');
  const calculateNetBtn = document.getElementById('calculateNetBtn');

  // Enable Load Prices button when both selections are made
  const checkSelections = () => {
    const crop = cropSelect.value;
    const state = stateSelect.value;
    loadPricesBtn.disabled = !(crop && state);
  };

  cropSelect.addEventListener('change', checkSelections);
  stateSelect.addEventListener('change', checkSelections);

  loadPricesBtn.addEventListener('click', async () => {
    currentState.crop = cropSelect.value;
    currentState.state = stateSelect.value;
    await loadMarketPrices();
    await loadMLPrediction();
    showSection('quantitySection');
    activateStep(4);
  });

  calculateNetBtn.addEventListener('click', async () => {
    currentState.quantity = parseInt(quantityInput.value) || 1000;
    await calculateNetRealization();
    showRecommendation();
    activateStep(7);
  });
});

// Show/hide sections
function showSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (section) {
    section.classList.remove('hidden');
  }
}

function hideSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (section) {
    section.classList.add('hidden');
  }
}

// Activate journey step
function activateStep(stepNumber) {
  document.querySelectorAll('.step').forEach(step => {
    const num = parseInt(step.dataset.step);
    if (num <= stepNumber) {
      step.classList.add('active');
    } else {
      step.classList.remove('active');
    }
  });
}

// Load current market prices
async function loadMarketPrices() {
  const section = document.getElementById('marketPricesSection');
  const content = document.getElementById('marketPricesContent');

  showSection('marketPricesSection');
  content.innerHTML = '<div class="loading"><div class="spinner"></div> Loading market prices...</div>';
  activateStep(2);

  try {
    const response = await fetch(`${API_BASE}/market-prices?crop=${currentState.crop}&state=${currentState.state}`);
    const data = await response.json();

    currentState.marketPrices = data.results || [];

    if (currentState.marketPrices.length === 0) {
      content.innerHTML = '<div class="alert alert-warning">No current market prices available for this crop/location combination.</div>';
      return;
    }

    // Calculate average current price
    const validPrices = currentState.marketPrices
      .map(r => r.price_per_kg)
      .filter(p => p != null && p > 0);

    const avgPrice = validPrices.length > 0
      ? validPrices.reduce((a, b) => a + b, 0) / validPrices.length
      : null;

    currentState.currentPrice = avgPrice;

    // Display market prices summary
    const latestDate = currentState.marketPrices[0]?.price_date || 'N/A';
    const minPrice = Math.min(...validPrices);
    const maxPrice = Math.max(...validPrices);

    content.innerHTML = `
      <div class="prediction-main">
        <div class="prediction-stat">
          <div class="label">Average Price</div>
          <div class="value">₹${avgPrice ? avgPrice.toFixed(2) : '--'}/kg</div>
        </div>
        <div class="prediction-stat">
          <div class="label">Price Range</div>
          <div class="value" style="font-size: 1.3em;">₹${minPrice.toFixed(2)} - ₹${maxPrice.toFixed(2)}</div>
        </div>
        <div class="prediction-stat">
          <div class="label">Markets</div>
          <div class="value">${currentState.marketPrices.length}</div>
        </div>
        <div class="prediction-stat">
          <div class="label">Latest Data</div>
          <div class="value" style="font-size: 1.2em;">${latestDate}</div>
        </div>
      </div>
      <div class="alert alert-info">
        <strong>Data Source:</strong> ${data.source === 'agmarknet' ? 'AGMARKNET Historical Data' : data.source}
      </div>
    `;

  } catch (error) {
    console.error('Error loading market prices:', error);
    content.innerHTML = '<div class="alert alert-warning">Failed to load market prices. Please try again.</div>';
  }
}

// Load ML prediction
async function loadMLPrediction() {
  const section = document.getElementById('mlPredictionSection');
  const content = document.getElementById('mlPredictionContent');

  showSection('mlPredictionSection');
  content.innerHTML = '<div class="loading"><div class="spinner"></div> Generating AI prediction...</div>';
  activateStep(3);

  try {
    const response = await fetch(
      `${API_BASE}/market-prices/prediction-ml?crop=${currentState.crop}&state=${currentState.state}&days=7&min_history_dates=10`
    );
    const prediction = await response.json();

    currentState.prediction = prediction;

    if (!prediction.available) {
      content.innerHTML = `
        <div class="alert alert-warning">
          <strong>Insufficient Data:</strong> ${prediction.message}
          <br><br>
          <small>Distinct dates found: ${prediction.distinct_dates} (minimum required: ${prediction.min_history_dates_required})</small>
        </div>
      `;
      return;
    }

    // Build prediction display
    const firstProj = prediction.projection[0];
    const lastProj = prediction.projection[prediction.projection.length - 1];

    const trendClass = prediction.trend_direction === 'up' ? 'trend-up' :
                       prediction.trend_direction === 'down' ? 'trend-down' : 'trend-flat';
    const trendIcon = prediction.trend_direction === 'up' ? '↗' :
                      prediction.trend_direction === 'down' ? '↘' : '→';

    const confidenceClass = `confidence-${prediction.confidence}`;

    content.innerHTML = `
      <div class="prediction-card">
        <div class="prediction-main">
          <div class="prediction-stat">
            <div class="label">Current Price</div>
            <div class="value">₹${prediction.current_price}/kg</div>
            <small>(${prediction.history_summary.last_date})</small>
          </div>
          <div class="prediction-stat">
            <div class="label">Tomorrow's Forecast</div>
            <div class="value ${trendClass}">${trendIcon} ₹${firstProj.chosen_point}/kg</div>
            <small>Range: ₹${firstProj.low} - ₹${firstProj.high}</small>
          </div>
          <div class="prediction-stat">
            <div class="label">7-Day Forecast</div>
            <div class="value ${trendClass}">₹${lastProj.chosen_point}/kg</div>
            <small>${lastProj.date}</small>
          </div>
          <div class="prediction-stat">
            <div class="label">Confidence</div>
            <div class="value" style="font-size: 1.3em;">
              <span class="confidence-badge ${confidenceClass}">${prediction.confidence.toUpperCase()}</span>
            </div>
            <small>Method: ${prediction.method.replace(/_/g, ' ')}</small>
          </div>
        </div>

        <div style="margin-top: 20px;">
          <strong>Historical Context:</strong>
          <ul style="margin-top: 10px; padding-left: 20px;">
            <li>Data points: ${prediction.distinct_dates} days (${prediction.history_summary.first_date} to ${prediction.history_summary.last_date})</li>
            <li>Historical range: ₹${prediction.historical_min} - ₹${prediction.historical_max}/kg</li>
            <li>Trend: <span class="${trendClass}"><strong>${prediction.trend_direction.toUpperCase()}</strong></span></li>
            <li>Data source: <strong>${prediction.source_used === 'agmarknet' ? 'AGMARKNET Historical' : prediction.source_used}</strong></li>
          </ul>
        </div>

        <div class="disclaimer">
          ${prediction.disclaimer}
        </div>
      </div>
    `;

  } catch (error) {
    console.error('Error loading ML prediction:', error);
    content.innerHTML = '<div class="alert alert-warning">Failed to load prediction. Please try again.</div>';
  }
}

// Calculate net realization
async function calculateNetRealization() {
  const section = document.getElementById('offerComparisonSection');
  const netSection = document.getElementById('netRealizationSection');
  const offerContent = document.getElementById('offerComparisonContent');
  const netContent = document.getElementById('netRealizationContent');

  showSection('offerComparisonSection');
  showSection('netRealizationSection');
  activateStep(5);
  activateStep(6);

  // Simulate offers (in real app, these would come from backend)
  const currentPrice = currentState.currentPrice || currentState.prediction?.current_price || 20;
  const quantity = currentState.quantity;

  const offers = [
    {
      type: 'Mandi (Local Market)',
      price: currentPrice * 0.95, // 5% below market price
      transportCost: 2000,
      otherCosts: 500,
      isBest: false
    },
    {
      type: 'Company Buyer',
      price: currentPrice * 1.02, // 2% above market price
      transportCost: 3000,
      otherCosts: 1000,
      isBest: true
    },
    {
      type: 'Trader',
      price: currentPrice * 0.92, // 8% below market price
      transportCost: 1500,
      otherCosts: 300,
      isBest: false
    }
  ];

  // Calculate net for each offer
  offers.forEach(offer => {
    offer.gross = offer.price * quantity;
    offer.totalCosts = offer.transportCost + offer.otherCosts;
    offer.net = offer.gross - offer.totalCosts;
    offer.netPerKg = offer.net / quantity;
  });

  // Find best offer
  const bestOffer = offers.reduce((best, offer) =>
    offer.net > best.net ? offer : best
  );
  bestOffer.isBest = true;

  // Display offer comparison
  offerContent.innerHTML = `
    <div class="offer-comparison">
      ${offers.map(offer => `
        <div class="offer-card ${offer.isBest ? 'best' : ''}">
          <div class="offer-type">${offer.type}${offer.isBest ? ' ⭐ BEST' : ''}</div>
          <div class="offer-price">₹${offer.price.toFixed(2)}/kg</div>
          <div class="offer-details">
            <div style="margin: 10px 0;">
              <strong>For ${quantity} kg:</strong><br>
              Gross: ₹${offer.gross.toFixed(0)}<br>
              Transport: ₹${offer.transportCost}<br>
              Other costs: ₹${offer.otherCosts}<br>
            </div>
            <div style="padding-top: 10px; border-top: 2px solid #eee;">
              <strong>Net: ₹${offer.net.toFixed(0)}</strong><br>
              <small>(₹${offer.netPerKg.toFixed(2)}/kg)</small>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Display net realization summary
  netContent.innerHTML = `
    <div class="net-calculator">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
        <div>
          <strong>Quantity:</strong><br>
          ${quantity} kg
        </div>
        <div>
          <strong>Best Price:</strong><br>
          ₹${bestOffer.price.toFixed(2)}/kg
        </div>
        <div>
          <strong>Total Costs:</strong><br>
          ₹${bestOffer.totalCosts}
        </div>
        <div>
          <strong>Gross Revenue:</strong><br>
          ₹${bestOffer.gross.toFixed(0)}
        </div>
      </div>

      <div class="net-result">
        <div>Your Net Realization:</div>
        <div class="amount">₹${bestOffer.net.toFixed(0)}</div>
        <div style="color: #666; margin-top: 5px;">
          (₹${bestOffer.netPerKg.toFixed(2)} per kg after all costs)
        </div>
      </div>
    </div>
  `;

  currentState.bestOffer = bestOffer;
}

// Show final recommendation
function showRecommendation() {
  const section = document.getElementById('recommendationSection');
  const content = document.getElementById('recommendationContent');

  showSection('recommendationSection');

  const prediction = currentState.prediction;
  const bestOffer = currentState.bestOffer;

  let decision = 'WAIT';
  let rationale = '';
  let actionColor = '#ffc107';

  if (bestOffer && bestOffer.price > (currentState.currentPrice * 0.98)) {
    decision = 'SELL NOW';
    actionColor = '#28a745';
    rationale = `The company buyer is offering ₹${bestOffer.price.toFixed(2)}/kg, which is above the current market average. This is a strong offer.`;
  } else if (prediction && prediction.trend_direction === 'down') {
    decision = 'CONSIDER SELLING';
    actionColor = '#ffc107';
    rationale = `The AI predicts a downward trend. Consider accepting the current offer to avoid potential losses.`;
  } else if (prediction && prediction.trend_direction === 'up') {
    decision = 'WAIT';
    actionColor = '#17a2b8';
    rationale = `The AI predicts an upward trend. Waiting may get you a better price, but monitor the market closely.`;
  } else {
    decision = 'MONITOR CLOSELY';
    actionColor = '#6c757d';
    rationale = `The market trend is flat. Continue monitoring and be ready to act on better offers.`;
  }

  content.innerHTML = `
    <div class="recommendation" style="background: ${actionColor};">
      <h3>📊 Our Recommendation</h3>
      <div class="action">${decision}</div>
      <p style="margin-top: 15px; font-size: 1.05em;">${rationale}</p>

      ${prediction && prediction.available ? `
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.3);">
          <strong>AI Analysis:</strong> ${prediction.method.replace(/_/g, ' ')} model with ${prediction.confidence} confidence.
          ${prediction.distinct_dates} days of AGMARKNET data analyzed.
        </div>
      ` : ''}
    </div>
  `;
}
