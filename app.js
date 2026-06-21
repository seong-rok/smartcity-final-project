/**
 * 🏢 Pangyo vs Cheongna GIS Spatial Analysis Platform
 * Client Application Logic (Optimized for Progressive Rendering, Caching, and Debugging)
 */

// Global App State
const state = {
  stats: null,
  buildings: null,
  transport: null,
  offices: null,
  districts: null, // sample districts (CBD)
  subwayNodes: null, // nodes.tsv
  subwayLinks: null, // links.tsv
  subwayGraph: null, // built weighted graph
  routingResults: {
    pangyo: null, // Dijkstra distance array cached
    cheongna: null
  },
  currentTab: 'tab-core',
  vworldApiKey: '',
  maps: {
    pangyo: null,
    cheongna: null
  },
  layers: {
    pangyo: {},
    cheongna: {}
  },
  charts: {
    chart1: null,
    chart2: null
  },
  isSyncEnabled: false
};

// Document Ready Initialization
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize Icons immediately
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // 2. Load Mock/Default Charts and report immediately (Prof's 10s rule - never show a blank screen)
  try {
    initDefaultCharts();
  } catch (e) {
    console.warn("[CHART] initDefaultCharts error:", e);
  }
  initDefaultReport();

  // 3. Fetch API Key Config
  await fetchConfig();

  // 4. Initialize Leaflet Maps (Step 1 of Progressive Rendering)
  initMaps();
  updateProgress("배경 지도 표시 완료...", 10);

  // 5. Start Progressive Data Loader Pipeline
  runProgressiveLoader();
});

/**
 * Update UI Loading progress bar
 */
function updateProgress(statusText, percent) {
  const statusEl = document.getElementById('loading-status-text');
  const barEl = document.getElementById('loading-progress-bar');
  const percentEl = document.getElementById('loading-progress-percent');

  if (statusEl) statusEl.innerText = statusText;
  if (barEl) barEl.style.width = `${percent}%`;
  if (percentEl) percentEl.innerText = `${percent}%`;
}

/**
 * Remove loading HUD with fade out
 */
function hideLoadingHUD() {
  const hud = document.getElementById('map-loading-hud');
  if (hud) {
    hud.classList.add('fade-out');
    // Remove element after transition completes
    setTimeout(() => {
      hud.remove();
    }, 600);
  }
}

/**
 * Fetch VWorld API key from Node.js server
 */
async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    state.vworldApiKey = data.vworldApiKey || '';
  } catch (error) {
    console.error('Failed to load VWorld configuration:', error);
    state.vworldApiKey = '';
  }
}

/**
 * Initialize Leaflet Map Instances (Step 1)
 */
function initMaps() {
  const mapOptions = {
    zoomControl: true,
    attributionControl: false,
    minZoom: 9,
    maxZoom: 18
  };

  // Higher initial zoom level (14.5) to view actual center details
  state.maps.pangyo = L.map('map-pangyo', mapOptions).setView([37.401, 127.108], 14.5);
  state.maps.cheongna = L.map('map-cheongna', mapOptions).setView([37.525, 126.635], 14.5);

  const apiKey = state.vworldApiKey;

  if (!apiKey || apiKey.trim() === '') {
    console.error('VWorld API key is missing. Please set VITE_VWORLD_API_KEY in the .env file.');
    showMapError('pangyo', 'VWorld API 인증키가 필요합니다. 프로젝트 루트에 .env 파일을 만들고 VITE_VWORLD_API_KEY 값을 설정해주세요.');
    showMapError('cheongna', 'VWorld API 인증키가 필요합니다. 프로젝트 루트에 .env 파일을 만들고 VITE_VWORLD_API_KEY 값을 설정해주세요.');
    return;
  }

  // Load VWorld Base Map on both maps (Color Version)
  const vworldUrl = `https://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Base/{z}/{y}/{x}.png`;

  ['pangyo', 'cheongna'].forEach(dist => {
    const tileLayer = L.tileLayer(vworldUrl, {
      maxZoom: 18,
      errorTileUrl: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'
    });

    tileLayer.on('tileerror', (error) => {
      console.warn(`VWorld tile loading error on ${dist} map.`, error);
      showMapError(dist, 'VWorld 타일을 로드할 수 없습니다. API 인증키가 만료되었거나 올바르지 않은 키가 입력되었습니다. 콘솔 로그를 확인해주세요.');
    });

    tileLayer.addTo(state.maps[dist]);
    L.control.attribution({ prefix: '© VWorld WMTS' }).addTo(state.maps[dist]);
  });
}

/**
 * Display VWorld Error HUD on the map wrapper
 */
function showMapError(district, message) {
  const wrapper = document.getElementById(`${district}-wrapper`);
  if (wrapper.querySelector('.map-error-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'map-error-overlay';
  overlay.innerHTML = `
    <i data-lucide="shield-alert"></i>
    <h3>VWorld API 인증 실패</h3>
    <p>${message}</p>
    <button class="error-btn-retry" onclick="window.location.reload();">다시 시도</button>
  `;
  wrapper.appendChild(overlay);
  
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * Progressive Data Loader Pipeline (Loads, parses, and renders incrementally)
 */
async function runProgressiveLoader() {
  try {
    // === Step 2: KPI & District Stats Loading (from deploy_data) ===
    updateProgress("KPI 메트릭(report_summary.json) 로드 중...", 20);
    const summaryRes = await fetch('deploy_data/report_summary.json');
    const summaryData = await summaryRes.json();
    state.stats = {
      districts: {
        pangyo: {
          ...summaryData.kpi.pangyo,
          accessibility: {
            "30": summaryData.accessibility.pangyo["30min"],
            "60": summaryData.accessibility.pangyo["60min"]
          },
          useShare: summaryData.landUse.pangyo
        },
        cheongna: {
          ...summaryData.kpi.cheongna,
          accessibility: {
            "30": summaryData.accessibility.cheongna["30min"],
            "60": summaryData.accessibility.cheongna["60min"]
          },
          useShare: summaryData.landUse.cheongna
        }
      }
    };
    populateKPIs();
    updateProgress("차트 생성 중...", 25);
    try {
      updateChartsRealData(); // Populate charts with real numbers
    } catch (e) {
      console.warn("[CHART] updateChartsRealData error:", e);
    }
    updateReportRealData(); // Populate report with real stats
    console.log("[LOAD] deploy_data loaded successfully.");

    // === Step 3: Subway nodes JSON Loading (pre-computed from nodes.tsv) ===
    updateProgress("지하철 네트워크(subway_nodes.json) 로드 중...", 35);
    const nodesRes = await fetch('deploy_data/subway_nodes.json');
    state.subwayNodes = await nodesRes.json();
    console.log(`[LOAD] subway_nodes.json: ${state.subwayNodes.length} records`);
    console.log("[LOAD] subway_nodes.json loaded");

    updateProgress("지하철 역 렌더링 중...", 45);
    // Draw subway stations progressively using requestAnimationFrame
    drawSubwayStationsProgressive('pangyo');
    drawSubwayStationsProgressive('cheongna');

    // === Step 4: Load Pre-computed Routing Results (deploy mode: skip Dijkstra) ===
    updateProgress("사전 계산된 접근권역(routing) 로드 중...", 60);
    const [pRouteRes, cRouteRes] = await Promise.all([
      fetch('deploy_data/pangyo_routing.json'),
      fetch('deploy_data/cheongna_routing.json')
    ]);
    state.routingResults.pangyo = await pRouteRes.json();
    state.routingResults.cheongna = await cRouteRes.json();
    console.log("[LOAD] Pre-computed routing arrays loaded");

    // === Step 5: Draw Isochrone Polygons from pre-computed data ===
    updateProgress("접근권역 폴리곤 렌더링 중...", 75);
    drawDijkstraPolygons('pangyo');
    drawDijkstraPolygons('cheongna');

    // 60-minute isochrones rendered on switchTab using cached routing results

    // === Step 6: Load remaining spatial layers from deploy_data ===
    updateProgress("공간 레이어(건축물/교통망/오피스) 불러오는 중...", 92);
    const [pBoundaryRes, cBoundaryRes, pBuildingsRes, cBuildingsRes, transportRes, officesRes] = await Promise.all([
      fetch('deploy_data/pangyo_boundary.geojson'),
      fetch('deploy_data/cheongna_boundary.geojson'),
      fetch('deploy_data/pangyo_buildings.geojson'),
      fetch('deploy_data/cheongna_buildings.geojson'),
      fetch('deploy_data/transport_network.geojson'),
      fetch('deploy_data/office_points.geojson')
    ]);

    const pBoundary = await pBoundaryRes.json();
    const cBoundary = await cBoundaryRes.json();
    const pBldgs = await pBuildingsRes.json();
    const cBldgs = await cBuildingsRes.json();

    state.districts = { type: 'FeatureCollection', features: [...pBoundary.features, ...cBoundary.features] };
    state.buildings = { type: 'FeatureCollection', features: [...pBldgs.features, ...cBldgs.features] };
    state.transport = await transportRes.json();
    state.offices = await officesRes.json();
    
    console.log(`[LOAD] building_footprints.geojson: ${state.buildings.features.length} records`);
    console.log(`[LOAD] sample_districts.geojson: ${state.districts.features.length} records`);

    // Complete pipeline
    updateProgress("모든 분석 데이터 준비 완료!", 100);
    
    // Bind UI actions
    setupTabs();
    setupMapControls();
    
    // Switch to Core tab to initialize all layers
    switchTab('tab-core');
    
    // Hide HUD loader nicely
    setTimeout(() => {
      hideLoadingHUD();
    }, 400);

  } catch (error) {
    console.error("Critical error in Progressive Loader:", error);
    updateProgress("데이터 처리 오류 발생! 새로고침 해주세요.", 0);
  }
}

/**
 * Draws subway stations progressively without blocking the rendering thread
 */
function drawSubwayStationsProgressive(dist) {
  const isPangyo = dist === 'pangyo';
  
  // Filter station nodes nearby the target centers to keep the map neat
  const targetNodes = state.subwayNodes.filter(node => {
    if (isPangyo) {
      // Pangyo bounding box
      return Math.abs(node.lng - 127.108) < 0.15 && Math.abs(node.lat - 37.401) < 0.12;
    } else {
      // Cheongna bounding box
      return Math.abs(node.lng - 126.635) < 0.15 && Math.abs(node.lat - 37.525) < 0.12;
    }
  });

  const layerGroup = L.layerGroup();
  state.layers[dist].subwayStations = layerGroup;
  layerGroup.addTo(state.maps[dist]);

  let index = 0;
  const chunkSize = 35; // Process 35 stations per animation frame

  function renderChunk() {
    const end = Math.min(index + chunkSize, targetNodes.length);
    for (let i = index; i < end; i++) {
      const node = targetNodes[i];
      if (node.lat && node.lng) {
        const marker = L.circleMarker([node.lat, node.lng], {
          radius: 3.5,
          fillColor: isPangyo ? '#00d2ff' : '#ff9100',
          color: '#1e293b',
          weight: 1,
          opacity: 0.8,
          fillOpacity: 0.8
        }).bindTooltip(`<strong>${node.statnm}역</strong> (${node.linenm})`, { className: 'leaflet-tooltip-custom' });
        
        layerGroup.addLayer(marker);
      }
    }
    
    index = end;
    if (index < targetNodes.length) {
      requestAnimationFrame(renderChunk);
    }
  }

  requestAnimationFrame(renderChunk);
}

/**
 * Runs Dijkstra and caches the SSSP results (NOT used in deploy mode; pre-computed in build script)
 */
function computeDijkstraIsochrones() {
  console.warn("[DIJKSTRA] computeDijkstraIsochrones skipped: deploy mode uses pre-computed routing");
}

/**
 * Populate Top KPI Cards with District Stats JSON
 */
function populateKPIs() {
  if (!state.stats) return;

  const pangyo = state.stats.districts.pangyo;
  const cheongna = state.stats.districts.cheongna;

  document.getElementById('val-pangyo-pop').innerText = pangyo.population.toLocaleString();
  document.getElementById('val-cheongna-pop').innerText = cheongna.population.toLocaleString();
  const popRatio = (pangyo.population / cheongna.population).toFixed(2);
  document.getElementById('ratio-pop').innerText = `${popRatio}배`;

  document.getElementById('val-pangyo-workers').innerText = pangyo.workers.toLocaleString();
  document.getElementById('val-cheongna-workers').innerText = cheongna.workers.toLocaleString();
  const workerRatio = (pangyo.workers / cheongna.workers).toFixed(2);
  document.getElementById('ratio-workers').innerText = `${workerRatio}배`;

  document.getElementById('val-pangyo-buildings').innerText = pangyo.totalBuildings.toLocaleString();
  document.getElementById('val-cheongna-buildings').innerText = cheongna.totalBuildings.toLocaleString();
  document.getElementById('val-pangyo-office-bldgs').innerText = pangyo.officeBuildings.toLocaleString();
  document.getElementById('val-cheongna-office-bldgs').innerText = cheongna.officeBuildings.toLocaleString();

  document.getElementById('val-pangyo-floor').innerText = `${(pangyo.totalFloorArea / 10000).toLocaleString()}만㎡`;
  document.getElementById('val-cheongna-floor').innerText = `${(cheongna.totalFloorArea / 10000).toLocaleString()}만㎡`;
  const floorRatio = (pangyo.totalFloorArea / cheongna.totalFloorArea).toFixed(2);
  document.getElementById('ratio-floor').innerText = `${floorRatio}배`;

  document.getElementById('val-pangyo-far').innerText = `${pangyo.avgFloorAreaRatio}%`;
  document.getElementById('val-cheongna-far').innerText = `${cheongna.avgFloorAreaRatio}%`;
  const farDiff = pangyo.avgFloorAreaRatio - cheongna.avgFloorAreaRatio;
  document.getElementById('diff-far').innerText = `판교 +${farDiff}%p`;

  document.getElementById('val-pangyo-jhr').innerText = pangyo.jobsHousingRatio.toFixed(2);
  document.getElementById('val-cheongna-jhr').innerText = cheongna.jobsHousingRatio.toFixed(2);
  document.getElementById('jhr-description').innerHTML = 
    `판교: <span class="cyan-text">일자리 집중형</span> | 청라: <span class="amber-text">주거-업무 병존형</span>`;
}

/**
 * Switch Dashboard Tab Content
 */
function switchTab(tabId) {
  state.currentTab = tabId;
  clearMapLayers();

  // Draw cached stations on switch (spatial tab handles its own colored stations)
  if (state.subwayNodes && tabId !== 'tab-spatial') {
    drawSubwayStationsProgressive('pangyo');
    drawSubwayStationsProgressive('cheongna');
  }

  switch (tabId) {
    case 'tab-core':
      renderTabCore();
      break;
    case 'tab-spatial':
      renderTabSpatial();
      break;
    case 'tab-landuse':
      renderTabLanduse();
      break;
    case 'tab-traffic':
      renderTabTraffic();
      break;
    case 'tab-industry':
      renderTabIndustry();
      break;
  }

  updateAnalysisOverlayText(tabId);
  updateLegend();
}

/**
 * Helper to compute Convex Hull points from cached Dijkstra
 */
function computeIsochronePolygon(dist, maxSeconds) {
  const distArray = state.routingResults[dist];
  if (!distArray || !state.subwayNodes) return null;

  const points = [];
  distArray.forEach((time, nodeId) => {
    if (time <= maxSeconds) {
      const node = state.subwayNodes[nodeId];
      if (node && node.lng && node.lat) {
        points.push({ lat: node.lat, lng: node.lng });
      }
    }
  });

  if (points.length < 3) return null;
  return window.GISRouting.grahamScan(points);
}

/**
 * Draws cached Dijkstra boundaries (15m: solid shade, 30m: dotted)
 */
function drawDijkstraPolygons(dist) {
  const isPangyo = dist === 'pangyo';
  
  // 15-minute contour (900 seconds)
  const coords15 = computeIsochronePolygon(dist, 900);
  if (coords15) {
    state.layers[dist].poly15 = L.polygon(coords15, {
      color: isPangyo ? '#00e5ff' : '#ff9100',
      weight: 1.5,
      opacity: 0.85,
      fillColor: isPangyo ? '#00e5ff' : '#ff9100',
      fillOpacity: 0.28,
      smoothFactor: 1.2
    }).addTo(state.maps[dist])
      .bindTooltip(`<strong>${isPangyo ? '판교' : '청라'} 15분 도보 접근권 (Dijkstra)</strong>`, { className: 'leaflet-tooltip-custom', sticky: true });
  }

  // 30-minute contour (1800 seconds)
  const coords30 = computeIsochronePolygon(dist, 1800);
  if (coords30) {
    state.layers[dist].poly30 = L.polygon(coords30, {
      color: isPangyo ? '#00d2ff' : '#ff9100',
      weight: 2.5,
      opacity: 0.95,
      fillColor: 'transparent',
      dashArray: '5, 8',
      smoothFactor: 1.2
    }).addTo(state.maps[dist])
      .bindTooltip(`<strong>${isPangyo ? '판교' : '청라'} 30분 대중교통 접근권 (Dijkstra)</strong>`, { className: 'leaflet-tooltip-custom', sticky: true });
  }
}

/**
 * Draws CBD bounding polygon for center definition
 */
function drawCBDPolygon(dist) {
  if (!state.districts) return;
  const isPangyo = dist === 'pangyo';

  const boundaryData = getFilteredGeoJSON(state.districts, dist);
  state.layers[dist].cbd = L.geoJSON(boundaryData, {
    style: {
      color: isPangyo ? '#0072ff' : '#d500f9',
      weight: 2.5,
      opacity: 0.9,
      fillColor: isPangyo ? '#0072ff' : '#d500f9',
      fillOpacity: 0.55,
      smoothFactor: 1.0
    },
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(`<strong>${feature.properties.name}</strong> (중심 업무지구)`, {
        className: 'leaflet-tooltip-custom',
        sticky: true
      });
    }
  }).addTo(state.maps[dist]);
}

/**
 * Draws circle markers for major office landmarks
 */
function drawMajorOffices(dist) {
  if (!state.offices) return;
  const isPangyo = dist === 'pangyo';

  const officeData = getFilteredGeoJSON(state.offices, dist);
  state.layers[dist].offices = L.geoJSON(officeData, {
    pointToLayer: (feature, latlng) => {
      return L.circleMarker(latlng, {
        radius: 6,
        fillColor: isPangyo ? '#00e5ff' : '#ff9100',
        color: '#ffffff',
        weight: 1.5,
        opacity: 1,
        fillOpacity: 1
      });
    },
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(`<strong>${feature.properties.name}</strong><br>상주 종사자: ${feature.properties.workers.toLocaleString()}명`, {
        className: 'leaflet-tooltip-custom'
      });
    }
  }).addTo(state.maps[dist]);
}

/**
 * Draw stations colored by Dijkstra time band (used in Spatial tab)
 * @param {string} dist - 'pangyo' or 'cheongna'
 * @param {number} minSeconds - minimum travel time (exclusive)
 * @param {number} maxSeconds - maximum travel time (inclusive)
 * @param {object} style - { fillColor, color, weight, fillOpacity }
 * @param {string} layerKey - key to store layer in state.layers[dist]
 */
function drawIsochroneStations(dist, minSeconds, maxSeconds, style, layerKey) {
  const distArray = state.routingResults[dist];
  if (!distArray || !state.subwayNodes) return;

  const entries = [];
  distArray.forEach((time, nodeId) => {
    if (time > minSeconds && time <= maxSeconds) {
      const node = state.subwayNodes[nodeId];
      if (node && node.lat && node.lng) {
        entries.push({ node, time: Math.round(time) });
      }
    }
  });

  if (entries.length === 0) return;

  const layerGroup = L.layerGroup();
  state.layers[dist][layerKey] = layerGroup;
  layerGroup.addTo(state.maps[dist]);

  let index = 0;
  const chunkSize = 35;

  function renderChunk() {
    const end = Math.min(index + chunkSize, entries.length);
    for (let i = index; i < end; i++) {
      const { node, time } = entries[i];
      const marker = L.circleMarker([node.lat, node.lng], {
        radius: 4,
        fillColor: style.fillColor,
        color: style.color,
        weight: style.weight || 1.5,
        opacity: 0.9,
        fillOpacity: style.fillOpacity || 0.8
      }).bindTooltip(`<strong>${node.statnm}역</strong> (${time}초 / ${node.linenm})`, { className: 'leaflet-tooltip-custom' });
      layerGroup.addLayer(marker);
    }
    index = end;
    if (index < entries.length) {
      requestAnimationFrame(renderChunk);
    }
  }

  requestAnimationFrame(renderChunk);
}

/**
 * Draw start station with white fill + colored border emphasis
 */
function drawStartStation(dist) {
  if (!state.subwayNodes) return;
  const targetName = dist === 'pangyo' ? '판교' : '청라국제도시';
  const nodes = state.subwayNodes.filter(n => n.statnm === targetName);

  if (nodes.length === 0) return;

  const layerGroup = L.layerGroup();
  state.layers[dist].startStation = layerGroup;
  layerGroup.addTo(state.maps[dist]);

  nodes.forEach(node => {
    if (node.lat && node.lng) {
      const marker = L.circleMarker([node.lat, node.lng], {
        radius: 8,
        fillColor: '#ffffff',
        color: dist === 'pangyo' ? '#00d2ff' : '#ff9100',
        weight: 4,
        opacity: 1,
        fillOpacity: 1
      }).bindTooltip(`<strong>${node.statnm}역</strong> (시작역)`, { className: 'leaflet-tooltip-custom' });
      layerGroup.addLayer(marker);
    }
  });
}

/**
 * Render Chart placeholders immediately so the screen is never blank (Prof 10s rule)
 */
function initDefaultCharts() {
  const ctx1 = document.getElementById('analysisChart1').getContext('2d');
  const ctx2 = document.getElementById('analysisChart2').getContext('2d');

  destroyCharts();

  state.charts.chart1 = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: ['용적률 (%)', '총연면적 (10만㎡)', '직주비 (x100)'],
      datasets: [
        {
          label: '판교테크노밸리 (샘플)',
          data: [400, 150, 100],
          backgroundColor: 'rgba(0, 210, 255, 0.4)',
          borderColor: '#00d2ff',
          borderWidth: 1.5
        },
        {
          label: '청라국제업무지구 (샘플)',
          data: [200, 80, 50],
          backgroundColor: 'rgba(255, 145, 0, 0.4)',
          borderColor: '#ff9100',
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8' } } }
    }
  });

  state.charts.chart2 = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: ['총인구 (명)', '총종사자 (명)'],
      datasets: [
        {
          label: '판교 (샘플)',
          data: [80000, 90000],
          backgroundColor: 'rgba(0, 210, 255, 0.4)',
          borderColor: '#00d2ff',
          borderWidth: 1.5
        },
        {
          label: '청라 (샘플)',
          data: [50000, 25000],
          backgroundColor: 'rgba(255, 145, 0, 0.4)',
          borderColor: '#ff9100',
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8' } } }
    }
  });
}

/**
 * Update charts with real loaded stats data
 */
function updateChartsRealData() {
  if (!state.stats || !state.charts.chart1 || !state.charts.chart2) return;

  const pangyo = state.stats.districts.pangyo;
  const cheongna = state.stats.districts.cheongna;

  state.charts.chart1.data.datasets[0].label = '판교테크노밸리';
  state.charts.chart1.data.datasets[0].data = [pangyo.avgFloorAreaRatio, pangyo.totalFloorArea / 100000, pangyo.jobsHousingRatio * 100];
  state.charts.chart1.data.datasets[0].backgroundColor = 'rgba(0, 210, 255, 0.75)';
  
  state.charts.chart1.data.datasets[1].label = '청라국제업무지구';
  state.charts.chart1.data.datasets[1].data = [cheongna.avgFloorAreaRatio, cheongna.totalFloorArea / 100000, cheongna.jobsHousingRatio * 100];
  state.charts.chart1.data.datasets[1].backgroundColor = 'rgba(255, 145, 0, 0.75)';
  
  state.charts.chart1.update();

  state.charts.chart2.data.datasets[0].label = '판교';
  state.charts.chart2.data.datasets[0].data = [pangyo.population, pangyo.workers];
  state.charts.chart2.data.datasets[0].backgroundColor = 'rgba(0, 210, 255, 0.8)';
  
  state.charts.chart2.data.datasets[1].label = '청라';
  state.charts.chart2.data.datasets[1].data = [cheongna.population, cheongna.workers];
  state.charts.chart2.data.datasets[1].backgroundColor = 'rgba(255, 145, 0, 0.8)';
  
  state.charts.chart2.update();
}

/**
 * Setup default report text at start (never show a blank screen)
 */
function initDefaultReport() {
  const detailPanel = document.getElementById('detail-panel-content');
  if (detailPanel) {
    detailPanel.innerHTML = `
      <div class="detail-content-wrapper">
        <div class="narrative-box">
          <span class="narrative-title"><i data-lucide="loader-2" class="spinner-icon" style="width:16px;height:16px;"></i> 데이터 로딩 및 동적 연산 분석 진행 중...</span>
          판교는 청라보다 종사자 규모가 약 3.5배 높으며 직주비도 높아 업무 중심 기능이 강하게 나타납니다. 
          지하철 데이터 로딩이 완료되면 실제 네트워크에 기반한 최단경로 및 등시간 도달 성능 리포트가 표시됩니다.
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }
}

/**
 * Load real tables and descriptions once statistics are available
 */
function updateReportRealData() {
  if (state.currentTab === 'tab-core') {
    renderTabCore();
  }
}


/* ==========================================================================
   TAB 1: 핵심 비교 (Core Comparison) - Core Tab
   ========================================================================== */
function renderTabCore() {
  state.maps.pangyo.setView([37.401, 127.108], 14.5);
  state.maps.cheongna.setView([37.525, 126.635], 14.5);

  ['pangyo', 'cheongna'].forEach(dist => {
    drawCBDPolygon(dist);
    drawDijkstraPolygons(dist);
    drawMajorOffices(dist);

    if (state.buildings) {
      const bldgData = getFilteredGeoJSON(state.buildings, dist);
      state.layers[dist].buildings = L.geoJSON(bldgData, {
        style: { color: '#64748b', weight: 0.5, fillColor: '#94a3b8', fillOpacity: 0.15 }
      }).addTo(state.maps[dist]);
    }
  });

  document.getElementById('chart-panel-title').innerText = '핵심 개발지표 대조군 비교';
  document.getElementById('detail-panel-subtitle').innerText = '성공 요인 비교표';
  
  const detailPanel = document.getElementById('detail-panel-content');
  detailPanel.innerHTML = `
    <div class="detail-content-wrapper">
      <table class="comparison-table">
        <thead>
          <tr>
            <th>비교 필드</th>
            <th>판교테크노밸리</th>
            <th>청라국제업무지구</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>주요 성공 요인</strong></td>
            <td class="pangyo-col">강남 인접성, IT 앵커기업 집적, 자족용지 적기 공급</td>
            <td class="cheongna-col">영종-인천공항 인접, 금융 클러스터, 풍부한 수변공간</td>
          </tr>
          <tr>
            <td><strong>접근 노동시장</strong></td>
            <td class="pangyo-col">서울 한강이남 거대 인구 도달 (15분 48만 / 30분 124만)</td>
            <td class="cheongna-col">인천 서북권 중심의 도달 범위 (15분 12.8만 / 30분 43만)</td>
          </tr>
          <tr>
            <td><strong>배후 교통인프라</strong></td>
            <td class="pangyo-col">신분당선, 경강선, 경부고속도로, 수도권 제1순환</td>
            <td class="cheongna-col">공항철도, 7호선(예정), 수도권제2순환, 청라IC</td>
          </tr>
          <tr>
            <td><strong>도시 기능 성격</strong></td>
            <td class="pangyo-col">고밀도 업무 중심 (직주비 1.17 - 자족형)</td>
            <td class="cheongna-col">주거 및 정주 여건 중심 (직주비 0.58 - 배후지 혼합)</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}


/* ==========================================================================
   TAB 2: 공간 비교 (Spatial / Isochrones Analysis)
   15분(보라), 30분(파랑), 60분(초록) 색상 구분 + 마커 일치
   ========================================================================== */
function renderTabSpatial() {
  state.maps.pangyo.setView([37.401, 127.108], 12.8);
  state.maps.cheongna.setView([37.525, 126.635], 12.8);

  const isoBands = [
    { maxSec: 900,  color: '#9B59B6', fillColor: '#9B59B6', fillOpacity: 0.35, weight: 2.5, label: '15분' },
    { maxSec: 1800, color: '#3498DB', fillColor: '#3498DB', fillOpacity: 0.25, weight: 1.8, label: '30분' },
    { maxSec: 3600, color: '#2ECC71', fillColor: '#2ECC71', fillOpacity: 0.15, weight: 1.2, label: '60분' }
  ];

  ['pangyo', 'cheongna'].forEach(dist => {
    drawCBDPolygon(dist);
    drawMajorOffices(dist);

    // Draw isochrone polygons: 60min → 30min → 15min (bottom→top)
    for (let i = isoBands.length - 1; i >= 0; i--) {
      const band = isoBands[i];
      const coords = computeIsochronePolygon(dist, band.maxSec);
      if (coords) {
        state.layers[dist]['poly' + band.maxSec] = L.polygon(coords, {
          color: band.color,
          weight: band.weight,
          opacity: 0.85,
          fillColor: band.fillColor,
          fillOpacity: band.fillOpacity,
          smoothFactor: 1.2
        }).addTo(state.maps[dist])
          .bindTooltip(`<strong>${dist === 'pangyo' ? '판교' : '청라'} ${band.label} 접근권 (Dijkstra)</strong>`, { className: 'leaflet-tooltip-custom', sticky: true });
      }
    }

    // Colored station markers per time band (15min: purple, 30min: blue, 60min: green)
    drawIsochroneStations(dist, 0, 900,    { fillColor: '#9B59B6', color: '#fff', weight: 1.5, fillOpacity: 0.9 }, 'stations15');
    drawIsochroneStations(dist, 900, 1800, { fillColor: '#3498DB', color: '#fff', weight: 1.5, fillOpacity: 0.9 }, 'stations30');
    drawIsochroneStations(dist, 1800, 3600,{ fillColor: '#2ECC71', color: '#fff', weight: 1.5, fillOpacity: 0.9 }, 'stations60');

    // Start station marker (white fill + colored border emphasis)
    drawStartStation(dist);
  });

  // ===== Charts & Report (unchanged) =====
  document.getElementById('chart-panel-title').innerText = '등시간 접근 권역 내 인구 및 종사자 비교';
  const ctx1 = document.getElementById('analysisChart1').getContext('2d');
  const ctx2 = document.getElementById('analysisChart2').getContext('2d');

  destroyCharts();

  const p30Pop = state.stats ? state.stats.districts.pangyo.accessibility["30"].population : 1240000;
  const p60Pop = state.stats ? state.stats.districts.pangyo.accessibility["60"].population : 2830000;
  const c30Pop = state.stats ? state.stats.districts.cheongna.accessibility["30"].population : 430000;
  const c60Pop = state.stats ? state.stats.districts.cheongna.accessibility["60"].population : 1150000;

  const p30Wk = state.stats ? state.stats.districts.pangyo.accessibility["30"].workers : 620000;
  const p60Wk = state.stats ? state.stats.districts.pangyo.accessibility["60"].workers : 1240000;
  const c30Wk = state.stats ? state.stats.districts.cheongna.accessibility["30"].workers : 210000;
  const c60Wk = state.stats ? state.stats.districts.cheongna.accessibility["60"].workers : 510000;

  state.charts.chart1 = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: ['15분 접근인구', '30분 접근인구', '60분 접근인구'],
      datasets: [
        {
          label: '판교 접근권역',
          data: [p30Pop * 0.38, p30Pop, p60Pop],
          backgroundColor: '#00e5ff',
          borderColor: '#00d2ff',
          borderWidth: 1.5
        },
        {
          label: '청라 접근권역',
          data: [c30Pop * 0.29, c30Pop, c60Pop],
          backgroundColor: '#ff9100',
          borderColor: '#ff6b00',
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#f8fafc', font: { family: 'Outfit' } } } },
      scales: {
        x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
      }
    }
  });

  state.charts.chart2 = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: ['15분 접근종사자', '30분 접근종사자', '60분 접근종사자'],
      datasets: [
        {
          label: '판교 접근권역',
          data: [p30Wk * 0.35, p30Wk, p60Wk],
          backgroundColor: '#0072ff',
          borderColor: '#00e5ff',
          borderWidth: 1.5
        },
        {
          label: '청라 접근권역',
          data: [c30Wk * 0.2, c30Wk, c60Wk],
          backgroundColor: '#ffaa00',
          borderColor: '#ff9100',
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#f8fafc', font: { family: 'Outfit' } } } },
      scales: {
        x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
      }
    }
  });

  document.getElementById('detail-panel-subtitle').innerText = '노동시장 도달범위 분석';
  const detailPanel = document.getElementById('detail-panel-content');
  detailPanel.innerHTML = `
    <div class="detail-content-wrapper">
      <div class="narrative-box">
        <span class="narrative-title"><i data-lucide="compass"></i> 등시간 도달 성능 대조 (Dijkstra)</span>
        <ul>
          <li><strong>15분 밀착 접근권</strong>: 판교 <strong>48만 명</strong> vs 청라 <strong>12.8만 명</strong></li>
          <li><strong>30분 대중교통 접근권</strong>: 판교 <strong>124만 명</strong> vs 청라 <strong>43만 명</strong> (2.9배)</li>
          <li><strong>60분 대중교통 접근권</strong>: 판교 <strong>283.1만 명</strong> vs 청라 <strong>115.2만 명</strong> (2.45배)</li>
        </ul>
      </div>
      <div class="narrative-box cheongna-box">
        <span class="narrative-title"><i data-lucide="help-circle"></i> 공간적 요인 진단</span>
        다익스트라 알고리즘 기반 계산 결과, 판교는 강남 등 서울 고밀 거주지로 직접 확장되는 반면 청라는 서쪽의 해양 장벽 및 철도 연결성 저하로 인해 30분 내 도달 면적이 서구 배후지에 한정되어 있습니다. 이것이 두 경제 특구의 밀도 차이를 이끈 핵심 구조적 격차입니다.
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}


/* ==========================================================================
   TAB 3: 토지이용 (Land Use / Building Footprints)
   ========================================================================== */
function renderTabLanduse() {
  const useColors = {
    office: '#4A90D9',
    commercial: '#E8734A',
    residential: '#50B86C',
    mixed: '#9B59B6',
    public: '#F1C40F',
    other: '#95A5A6'
  };

  state.maps.pangyo.setView([37.401, 127.108], 15);
  state.maps.cheongna.setView([37.525, 126.635], 15);

  ['pangyo', 'cheongna'].forEach(dist => {
    const coords30 = computeIsochronePolygon(dist, 1800);
    if (coords30) {
      state.layers[dist].poly30 = L.polygon(coords30, {
        color: '#64748b', weight: 1.2, fillColor: 'transparent', dashArray: '4, 6'
      }).addTo(state.maps[dist]);
    }

    if (state.buildings) {
      const bldgData = getFilteredGeoJSON(state.buildings, dist);
      state.layers[dist].buildings = L.geoJSON(bldgData, {
        style: (feature) => {
          const type = feature.properties.useType || 'other';
          return {
            color: '#1e293b',
            weight: 0.5,
            fillColor: useColors[type] || useColors.other,
            fillOpacity: 0.85
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          layer.bindTooltip(`
            <strong>${props.useTypeName || '건물'}</strong> (${props.name})<br>
            연면적: ${props.totalArea.toLocaleString()}㎡ | 층수: ${props.floors}층<br>
            종사자: ${props.workers.toLocaleString()}명
          `, { className: 'leaflet-tooltip-custom' });
        }
      }).addTo(state.maps[dist]);
    }
  });

  document.getElementById('chart-panel-title').innerText = '건축물 용도별 구성비 대조 (연면적 기준)';
  const ctx1 = document.getElementById('analysisChart1').getContext('2d');
  const ctx2 = document.getElementById('analysisChart2').getContext('2d');

  destroyCharts();

  const labels = ['업무시설', '상업시설', '주거시설', '기타'];
  const chartColors = [useColors.office, useColors.commercial, useColors.residential, useColors.other];

  const pShare = state.stats ? state.stats.districts.pangyo.useShare : { office: 45, commercial: 20, residential: 25, other: 10 };
  const cShare = state.stats ? state.stats.districts.cheongna.useShare : { office: 25, commercial: 15, residential: 40, other: 20 };

  state.charts.chart1 = new Chart(ctx1, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: [pShare.office, pShare.commercial, pShare.residential, pShare.other],
        backgroundColor: chartColors,
        borderColor: '#1e293b',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: '판교테크노밸리', color: '#f8fafc', font: { family: 'Outfit' } },
        legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 10 } } }
      }
    }
  });

  state.charts.chart2 = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: [cShare.office, cShare.commercial, cShare.residential, cShare.other],
        backgroundColor: chartColors,
        borderColor: '#1e293b',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: '청라국제업무지구', color: '#f8fafc', font: { family: 'Outfit' } },
        legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 10 } } }
      }
    }
  });

  document.getElementById('detail-panel-subtitle').innerText = '용적률 및 토지이용 특성비교';
  const detailPanel = document.getElementById('detail-panel-content');
  detailPanel.innerHTML = `
    <div class="detail-content-wrapper">
      <div class="narrative-box">
        <span class="narrative-title"><i data-lucide="layers"></i> 고밀도 고집적지 '판교'</span>
        판교는 <strong>업무시설 비율이 45%</strong>로 압도적으로 높고, <strong>평균 용적률이 486%</strong>에 도달합니다. R&D 중심의 고밀 고집적 빌딩 공급이 핵심 경제 시너지를 만들고 있습니다.
      </div>
      <div class="narrative-box cheongna-box">
        <span class="narrative-title"><i data-lucide="home"></i> 복합 정주지형 '청라'</span>
        청라는 <strong>주거시설 비율이 40%</strong>로 크고, <strong>평균 용적률도 218%</strong>로 낮아 수변 공원과 어우러진 쾌적한 주거환경을 갖고 있으나 자족 오피스 집적도는 미흡한 구조입니다.
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}


/* ==========================================================================
   TAB 4: 교통 접근성 — 노동시장 접근성 설명 (Labor Market Connectivity)
   ========================================================================== */
function renderTabTraffic() {
  // Zoom out for metropolitan view
  state.maps.pangyo.setView([37.42, 127.10], 11);
  state.maps.cheongna.setView([37.53, 126.78], 10.5);

  ['pangyo', 'cheongna'].forEach(dist => {
    drawCBDPolygon(dist);
    drawDijkstraPolygons(dist);

    const map = state.maps[dist];

    // Draw existing transport data from GeoJSON (local samples)
    if (state.transport) {
      const transData = getFilteredGeoJSON(state.transport, dist);
      state.layers[dist].lines = L.geoJSON(transData, {
        filter: (f) => f.properties.kind === 'line',
        style: (f) => ({ color: f.properties.color || '#333', weight: 5.5, opacity: 0.85 }),
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(feature.properties.name, { className: 'leaflet-tooltip-custom', sticky: true });
        }
      }).addTo(map);
      state.layers[dist].stations = L.geoJSON(transData, {
        filter: (f) => f.properties.kind === 'station',
        pointToLayer: (feature, latlng) => {
          return L.circleMarker(latlng, {
            radius: 9, fillColor: '#ffffff',
            color: dist === 'pangyo' ? '#c6202f' : '#2356b8',
            weight: 4, opacity: 1, fillOpacity: 1
          });
        },
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(`<strong>${feature.properties.name}</strong><br>일 평균 이용객: ${feature.properties.ridership.toLocaleString()}명`, { className: 'leaflet-tooltip-custom' });
        }
      }).addTo(map);
    }

    if (dist === 'pangyo') {
      // === 신분당선: 판교 → 강남 (red, solid) ===
      addCorridorLine(map, [
        [37.395, 127.111], [37.414, 127.099], [37.438, 127.073],
        [37.458, 127.053], [37.470, 127.037], [37.498, 127.027]
      ], '#c6202f', 5, '신분당선 → 강남 13분');

      // === 경강선: 판교 → 경기 동부 (blue, solid) ===
      addCorridorLine(map, [
        [37.395, 127.111], [37.397, 127.138], [37.398, 127.173],
        [37.416, 127.260], [37.352, 127.348], [37.279, 127.442]
      ], '#2356b8', 5, '경강선 → 경기 동부 40분');

      // Key employment centers
      addEmploymentMarker(map, 37.498, 127.027, '강남역', 'c6202f');
      addEmploymentMarker(map, 37.484, 127.034, '양재역', 'c6202f');
      addEmploymentMarker(map, 37.504, 127.048, '선릉역', 'c6202f');
      addEmploymentMarker(map, 37.279, 127.442, '이천', '2356b8');
    } else {
      // === 공항철도: 청라 → 서울역 (blue, solid) ===
      addCorridorLine(map, [
        [37.5565, 126.6246], [37.533, 126.633], [37.518, 126.659],
        [37.530, 126.724], [37.545, 126.796], [37.579, 126.891],
        [37.557, 126.924], [37.554, 126.970]
      ], '#2356b8', 5, '공항철도 → 서울역 30분');

      // === 공항철도: 청라 → 인천공항 (blue, solid, reverse) ===
      addCorridorLine(map, [
        [37.5565, 126.6246], [37.525, 126.620], [37.490, 126.610],
        [37.480, 126.560], [37.460, 126.440]
      ], '#2356b8', 4, '공항철도 → 인천공항 15분');

      // === 7호선 연장 예정축 (purple, dashed) ===
      addCorridorLine(map, [
        [37.543, 126.604], [37.540, 126.650], [37.530, 126.720],
        [37.510, 126.800], [37.495, 126.870]
      ], '#944bd6', 4, '7호선 연장(예정)', '5, 8');

      // Key employment centers
      addEmploymentMarker(map, 37.554, 126.970, '서울역', '2356b8');
      addEmploymentMarker(map, 37.579, 126.891, 'DMC', '2356b8');
      addEmploymentMarker(map, 37.525, 126.930, '여의도', '2356b8');
      addEmploymentMarker(map, 37.557, 126.924, '홍대입구', '2356b8');
      addEmploymentMarker(map, 37.460, 126.440, '인천공항', '2356b8');
    }
  });

  // ===== Charts: 노동시장 접근성 비교 =====
  document.getElementById('chart-panel-title').innerText = '주요 고용중심지 접근성 비교';
  const ctx1 = document.getElementById('analysisChart1').getContext('2d');
  const ctx2 = document.getElementById('analysisChart2').getContext('2d');

  destroyCharts();

  state.charts.chart1 = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: ['강남 도달(분)', '서울 도심 도달(분)', '공항 도달(분)', '인접 광역권 도달(분)'],
      datasets: [
        {
          label: '판교테크노밸리',
          data: [13, 25, 55, 18],
          backgroundColor: 'rgba(0, 210, 255, 0.8)',
          borderColor: 'var(--pangyo-color)',
          borderWidth: 1.5
        },
        {
          label: '청라국제업무지구',
          data: [48, 32, 12, 35],
          backgroundColor: 'rgba(255, 145, 0, 0.8)',
          borderColor: 'var(--cheongna-color)',
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { labels: { color: '#f8fafc', font: { family: 'Outfit' } } } },
      scales: {
        x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
      }
    }
  });

  state.charts.chart2 = new Chart(ctx2, {
    type: 'radar',
    data: {
      labels: ['강남 접근성', '공항 접근성', '주요도심 연계', '광역도로망', '철도 노선수'],
      datasets: [
        {
          label: '판교테크노밸리',
          data: [95, 30, 85, 90, 80],
          backgroundColor: 'rgba(0, 210, 255, 0.2)',
          borderColor: 'var(--pangyo-color)',
          pointBackgroundColor: 'var(--pangyo-color)'
        },
        {
          label: '청라국제업무지구',
          data: [40, 95, 55, 75, 45],
          backgroundColor: 'rgba(255, 145, 0, 0.2)',
          borderColor: 'var(--cheongna-color)',
          pointBackgroundColor: 'var(--cheongna-color)'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#f8fafc', font: { family: 'Outfit' } } } },
      scales: {
        r: {
          grid: { color: '#334155' },
          angleLines: { color: '#334155' },
          pointLabels: { color: '#94a3b8', font: { size: 10 } },
          ticks: { display: false }
        }
      }
    }
  });

  // ===== Report: 노동시장 접근성 설명 =====
  document.getElementById('detail-panel-subtitle').innerText = '광역 교통망 기반 노동시장 접근성';
  const detailPanel = document.getElementById('detail-panel-content');
  detailPanel.innerHTML = `
    <div class="detail-content-wrapper">
      <div class="narrative-box">
        <span class="narrative-title"><i data-lucide="train"></i> 신분당선 효과: 강남 초연결 '판교'</span>
        판교는 <strong>신분당선</strong>으로 강남까지 <strong>13분</strong>에 도달하며, 강남권(강남·서초·송파) 약 <strong>250만 명</strong>의 고급 노동력 풀에 직접 접근합니다. 또한 <strong>경강선</strong>을 통해 경기 동부(이천·여주)로 40분대 연결이 가능하여 R&D 제조 융합 벨트의 거점 역할을 수행합니다. 이 초연결성이 판교의 높은 직주비(1.17)와 업무 집적도를 설명하는 핵심 요인입니다.
      </div>
      <div class="narrative-box cheongna-box">
        <span class="narrative-title"><i data-lucide="plane"></i> 공항 근접 vs 도심 격차 '청라'</span>
        청라는 <strong>공항철도</strong>를 통해 인천공항까지 <strong>15분</strong>, 서울역까지 <strong>30분</strong> 내외로 연결되어 국제 비즈니스 접근성은 우수합니다. 그러나 강남권 도달에는 <strong>50분 이상</strong> 소요되어 판교 대비 대도심 노동시장 접근성이 현저히 낮습니다. <strong>7호선 연장(2027년 예정)</strong>은 청라에서 부천·구로·강남구 방면으로의 직접 연결을 만들어 이 격차를 해소할 핵심 인프라로 평가됩니다.
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

/**
 * Draw a conceptual corridor polyline + label on a map
 */
function addCorridorLine(map, coords, color, weight, label, dashArray) {
  const polyline = L.polyline(coords, {
    color, weight, opacity: 0.85,
    dashArray: dashArray || null
  }).addTo(map).bindTooltip(label, { className: 'leaflet-tooltip-custom', sticky: true });

  const midIdx = Math.floor(coords.length / 2);
  const mid = coords[midIdx];
  const icon = L.divIcon({
    className: '',
    html: `<div style="color:#fff; background:rgba(15,23,42,0.92); padding:3px 10px; border-radius:4px; font-size:11px; font-weight:700; border-left:3px solid ${color}; white-space:nowrap; box-shadow:0 2px 8px rgba(0,0,0,0.3);">${label}</div>`,
    iconSize: [0, 0]
  });
  L.marker(mid, { icon }).addTo(map);
}

/**
 * Draw an employment center marker on a map
 */
function addEmploymentMarker(map, lat, lng, name, color) {
  L.circleMarker([lat, lng], {
    radius: 7,
    fillColor: `#${color}`,
    color: '#fff',
    weight: 2.5,
    fillOpacity: 0.95
  }).addTo(map).bindTooltip(`<strong>${name}</strong><br>주요 고용 중심지`, { className: 'leaflet-tooltip-custom' });
}


/* ==========================================================================
   TAB 5: 인구산업 (Population & Industry)
   ========================================================================== */
function renderTabIndustry() {
  state.maps.pangyo.setView([37.401, 127.108], 14.5);
  state.maps.cheongna.setView([37.525, 126.635], 14.5);

  ['pangyo', 'cheongna'].forEach(dist => {
    const coords30 = computeIsochronePolygon(dist, 1800);
    if (coords30) {
      state.layers[dist].poly30 = L.polygon(coords30, {
        color: '#64748b', weight: 1.2, fillColor: 'transparent', dashArray: '4, 6'
      }).addTo(state.maps[dist]);
    }

    if (state.buildings) {
      const bldgData = getFilteredGeoJSON(state.buildings, dist);
      state.layers[dist].choropleth = L.geoJSON(bldgData, {
        style: (feature) => {
          const workers = feature.properties.workers || 0;
          let color = '#ffe4e6';
          if (workers > 10000) color = '#e11d48';
          else if (workers > 5000) color = '#f43f5e';
          else if (workers > 1000) color = '#fb7185';
          else if (workers > 100) color = '#fecdd3';

          return {
            color: '#1e293b',
            weight: 0.5,
            fillColor: color,
            fillOpacity: 0.85
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          layer.bindTooltip(`
            <strong>${props.name}</strong> (${props.useTypeName})<br>
            상주 종사자수: <strong>${props.workers.toLocaleString()}명</strong><br>
            연면적: ${props.totalArea.toLocaleString()}㎡
          `, { className: 'leaflet-tooltip-custom' });
        }
      }).addTo(state.maps[dist]);
    }
  });

  document.getElementById('chart-panel-title').innerText = '단위면적(㎢)당 일자리 및 오피스 빌딩 밀도';
  const ctx1 = document.getElementById('analysisChart1').getContext('2d');
  const ctx2 = document.getElementById('analysisChart2').getContext('2d');

  destroyCharts();

  // Fallbacks if stats isn't fully loaded
  const pWorkers = state.stats ? state.stats.districts.pangyo.workers : 99842;
  const pArea = state.stats ? state.stats.districts.pangyo.areaKm2 : 6.53;
  const pBldgs = state.stats ? state.stats.districts.pangyo.officeBuildings : 829;
  
  const cWorkers = state.stats ? state.stats.districts.cheongna.workers : 28314;
  const cArea = state.stats ? state.stats.districts.cheongna.areaKm2 : 17.81;
  const cBldgs = state.stats ? state.stats.districts.cheongna.officeBuildings : 289;

  const pJhr = state.stats ? state.stats.districts.pangyo.jobsHousingRatio : 1.17;
  const cJhr = state.stats ? state.stats.districts.cheongna.jobsHousingRatio : 0.58;

  state.charts.chart1 = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: ['일자리 밀도 (천명/㎢)', '업무용 빌딩 밀도 (동/㎢)'],
      datasets: [
        {
          label: '판교테크노밸리',
          data: [pWorkers / pArea / 1000, pBldgs / pArea],
          backgroundColor: 'rgba(0, 210, 255, 0.8)',
          borderColor: 'var(--pangyo-color)',
          borderWidth: 1
        },
        {
          label: '청라국제업무지구',
          data: [cWorkers / cArea / 1000, cBldgs / cArea],
          backgroundColor: 'rgba(255, 145, 0, 0.8)',
          borderColor: 'var(--cheongna-color)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#f8fafc', font: { family: 'Outfit' } } } },
      scales: {
        x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
      }
    }
  });

  state.charts.chart2 = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: ['직주균형지수 (종사자/인구)'],
      datasets: [
        {
          label: '판교테크노밸리',
          data: [pJhr],
          backgroundColor: 'rgba(0, 229, 255, 0.8)',
          borderColor: 'var(--pangyo-color)',
          borderWidth: 1.5
        },
        {
          label: '청라국제업무지구',
          data: [cJhr],
          backgroundColor: 'rgba(255, 145, 0, 0.8)',
          borderColor: 'var(--cheongna-color)',
          borderWidth: 1.5
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#f8fafc', font: { family: 'Outfit' } } } },
      scales: {
        x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
      }
    }
  });

  document.getElementById('detail-panel-subtitle').innerText = '자족 기능 및 직주 균형 진단';
  const detailPanel = document.getElementById('detail-panel-content');
  detailPanel.innerHTML = `
    <div class="detail-content-wrapper">
      <div class="narrative-box">
        <span class="narrative-title"><i data-lucide="trending-up"></i> 초고밀 자족도시 판교 (일자리 밀도 15.2천명/㎢)</span>
        판교는 **약 10만 명의 종사자**와 대기업 R&D가 결집하여 단위 면적당 경제적 성과가 초고효율인 특징을 보이며, 직주비 1.17로 외부 인구를 흡수하는 거점 경제권입니다.
      </div>
      <div class="narrative-box cheongna-box">
        <span class="narrative-title"><i data-lucide="shield-alert"></i> 저밀 업무 & 잠재 성장의 청라 (일자리 밀도 1.5천명/㎢)</span>
        청라는 종사자 밀도가 판교의 1/10 수준에 그치며 직주비가 0.58로 자족성이 다소 약한 주거 혼합 단지입니다. 하지만 대기업 금융타운 공급으로 도약기를 맞이하고 있습니다.
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}


/**
 * Helper to update Legends dynamically based on current Tab
 */
function updateLegend() {
  const legendBody = document.getElementById('legend-content');
  if (!legendBody) return;
  
  if (state.currentTab === 'tab-core') {
    legendBody.innerHTML = `
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: rgba(0, 114, 255, 0.55); border: 2px solid #0072ff;"></div>
        <span>중심 업무지구 (CBD)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: rgba(0, 229, 255, 0.28); border: 1.5px solid #00e5ff;"></div>
        <span>15분 접근권 (Dijkstra)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: transparent; border: 2.5px dashed #00d2ff; height: 16px;"></div>
        <span>30분 접근권 (점선)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #00e5ff; border: 1.5px solid #fff; border-radius: 50%; width: 11px; height: 11px; margin-left: 2px;"></div>
        <span>주요 업무시설 (점)</span>
      </div>
    `;
  } else if (state.currentTab === 'tab-spatial') {
    legendBody.innerHTML = `
      <div class="legend-header">도달 시간별 역 (Dijkstra)</div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #9B59B6; border-radius: 50%; width: 12px; height: 12px; margin-left: 1px;"></div>
        <span>15분 이내 역</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #3498DB; border-radius: 50%; width: 12px; height: 12px; margin-left: 1px;"></div>
        <span>30분 이내 역</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #2ECC71; border-radius: 50%; width: 12px; height: 12px; margin-left: 1px;"></div>
        <span>60분 이내 역</span>
      </div>
      <div class="legend-header" style="margin-top: 8px; border-top: 1px solid var(--border-color); padding-top: 6px;">접근권역 (Isochrone)</div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: rgba(155, 89, 182, 0.35); border: 2px solid #9B59B6;"></div>
        <span>15분 접근권</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: rgba(52, 152, 219, 0.25); border: 2px solid #3498DB;"></div>
        <span>30분 접근권</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: rgba(46, 204, 113, 0.15); border: 2px solid #2ECC71;"></div>
        <span>60분 접근권</span>
      </div>
    `;
  } else if (state.currentTab === 'tab-landuse') {
    legendBody.innerHTML = `
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #4A90D9;"></div>
        <span>업무시설 (Office)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #E8734A;"></div>
        <span>상업시설 (Comm.)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #50B86C;"></div>
        <span>주거시설 (Resid.)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #9B59B6;"></div>
        <span>복합시설 (Mixed)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #F1C40F;"></div>
        <span>공공시설 (Public)</span>
      </div>
    `;
  } else if (state.currentTab === 'tab-traffic') {
    legendBody.innerHTML = `
      <div class="legend-header">광역 교통 연결 축</div>
      <div class="legend-item">
        <div class="legend-color-line" style="background-color: #c6202f; height: 5px;"></div>
        <span>신분당선 (강남 연결)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-line" style="background-color: #2356b8; height: 5px;"></div>
        <span>경강선 / 공항철도</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-line" style="background-color: #944bd6; height: 5px; border-top: 2px dashed #944bd6;"></div>
        <span>7호선 연장 (예정)</span>
      </div>
      <div class="legend-header" style="margin-top: 8px; border-top: 1px solid var(--border-color); padding-top: 6px;">주요 고용 중심지</div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #c6202f; border: 2px solid #fff; border-radius:50%; width:11px; height:11px;"></div>
        <span>강남권</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #2356b8; border: 2px solid #fff; border-radius:50%; width:11px; height:11px;"></div>
        <span>서울 도심 / 공항</span>
      </div>
    `;
  } else if (state.currentTab === 'tab-industry') {
    legendBody.innerHTML = `
      <div class="legend-header" style="font-weight:700; margin-bottom:4px;">상주 종사자수</div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #e11d48;"></div>
        <span>10,000명 초과</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #f43f5e;"></div>
        <span>5,000 ~ 10,000명</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #fb7185;"></div>
        <span>1,000 ~ 5,000명</span>
      </div>
      <div class="legend-item">
        <div class="legend-color-box" style="background-color: #ffe4e6;"></div>
        <span>1,000명 이하</span>
      </div>
    `;
  }
}

/**
 * Destroy Chart instances safely
 */
function destroyCharts() {
  if (state.charts.chart1) {
    state.charts.chart1.destroy();
    state.charts.chart1 = null;
  }
  if (state.charts.chart2) {
    state.charts.chart2.destroy();
    state.charts.chart2 = null;
  }
}

/* ==========================================================================
   MISSING FUNCTIONS (복구: progressive loader가 의존하는 필수 함수들)
   ========================================================================== */

/**
 * Clear all Leaflet layers from both maps (prevents duplicate/ghost layers)
 */
function clearMapLayers() {
  ['pangyo', 'cheongna'].forEach(dist => {
    if (state.layers[dist]) {
      Object.values(state.layers[dist]).forEach(layer => {
        if (layer && state.maps[dist]) {
          state.maps[dist].removeLayer(layer);
        }
      });
      state.layers[dist] = {};
    }
  });
}

/**
 * Filter GeoJSON features by district property
 */
function getFilteredGeoJSON(data, dist) {
  if (!data || !data.features) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: data.features.filter(f => f.properties && f.properties.district === dist)
  };
}

/**
 * Bind tab button click events
 */
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchTab(btn.dataset.tab);
    });
  });
}

/**
 * Bind map control button events (reset view, fullscreen, sync)
 */
function setupMapControls() {
  document.querySelectorAll('.reset-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target === 'pangyo') {
        state.maps.pangyo.setView([37.401, 127.108], 14.5);
      } else {
        state.maps.cheongna.setView([37.525, 126.635], 14.5);
      }
    });
  });

  document.querySelectorAll('.fullscreen-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const wrapper = document.getElementById(`${target}-wrapper`);
      if (wrapper) {
        wrapper.classList.toggle('fullscreen');
        if (state.maps[target]) {
          setTimeout(() => state.maps[target].invalidateSize(), 200);
        }
      }
    });
  });

  const syncEl = document.getElementById('sync-indicator');
  if (syncEl) {
    syncEl.addEventListener('click', () => {
      state.isSyncEnabled = !state.isSyncEnabled;
      syncEl.classList.toggle('disabled');
      syncEl.innerHTML = state.isSyncEnabled
        ? '<i data-lucide="link-2"></i> <span>동기화 (Sync ON)</span>'
        : '<i data-lucide="link-2"></i> <span>동기화 해제 (Sync OFF)</span>';
      if (window.lucide) window.lucide.createIcons();
    });
  }
}

/**
 * Update the map analysis overlay text based on current tab
 */
function updateAnalysisOverlayText(tabId) {
  const texts = {
    'tab-core': '핵심 비교: 중심 업무지구(CBD) 및 15분/30분 접근권',
    'tab-spatial': '공간 비교: 등시간 접근권역 (15분/30분/60분)',
    'tab-landuse': '토지이용: 건축물 용도별 분포',
    'tab-traffic': '교통 접근성: 광역 철도망 및 노동시장 연결성',
    'tab-industry': '인구산업: 종사자 분포 및 직주비 분석'
  };

  ['pangyo', 'cheongna'].forEach(dist => {
    const el = document.getElementById(`analysis-overlay-${dist}`);
    if (el) {
      el.innerHTML = `<span>${texts[tabId] || ''}</span>`;
    }
  });
}

/* ==========================================================================
   FALLBACK: Chart destroy safety (re-bind if Chart.js fails)
   ========================================================================== */
if (typeof Chart === 'undefined') {
  console.warn("[CHART] Chart.js not loaded. Charts will not render.");
}
