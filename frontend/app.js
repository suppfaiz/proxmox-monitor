// --- Configuration & Constants ---
const BACKEND_URL = window.location.origin.includes('localhost:8080') || window.location.origin.includes('127.0.0.1:8080') 
    ? 'http://localhost:5005' 
    : window.location.origin;
const POLL_INTERVAL = 2000; // 2 seconds
const MAX_LOGS = 30;
const GAUGE_CIRCUMFERENCE = 314.16;

// --- Global App State ---
let networkChart = null;
let largeNetworkChart = null;
let mikrotikChart = null;
let mikrotikDetailChart = null;
let currentVms = [];
let pendingAction = null;
let currentActiveRoute = 'dashboard';
let pollerId = null;
let switchesPollerId = null;
let proxmoxWebUrl = '';
let demoModeActive = true;
let vncIntervalId = null;

// SLA Alerts Tracking States
let previousVmStatuses = {};
let slaAlerts = [
    { timestamp: new Date(Date.now() - 3600 * 1000 * 2).toLocaleTimeString(), vmid: 103, name: 'mail-mx-01', type: 'stopped', message: 'SLA BREACH: VM mail-mx-01 (103) is Offline!' },
    { timestamp: new Date(Date.now() - 3600 * 1000).toLocaleTimeString(), vmid: 201, name: 'app-engine-03', type: 'running', message: 'SLA RESTORED: LXC app-engine-03 (201) is Online!' }
];

// Active Proxmox Host stats
let currentNodeName = 'pve';
let currentNodeUptime = 0;
let currentNodeCpuModel = '';
let currentNodeCpus = 0;
let currentNodeMemUsed = 0;
let currentNodeMemTotal = 0;
let currentNodeKversion = '';

// Auth credentials token
let authToken = localStorage.getItem('pve_dashboard_token') || '';

// --- UI Elements ---
const elCpuRing = document.getElementById('cpu-ring');
const elCpuValue = document.getElementById('cpu-value');
const elCpuNodeName = document.getElementById('cpu-node-name');
const elCpuHostModel = document.getElementById('cpu-host-model');

const elRamRing = document.getElementById('ram-ring');
const elRamValue = document.getElementById('ram-value');
const elRamUsageText = document.getElementById('ram-usage-text');

const elStorageRing = document.getElementById('storage-ring');
const elStorageValue = document.getElementById('storage-value');
const elStorageUsageText = document.getElementById('storage-usage-text');

const elNodeDisplay = document.getElementById('pve-node-display');
const elPveVersion = document.getElementById('pve-version-tag');
const elBackendStatus = document.getElementById('backend-status-text');
const elBackendMode = document.getElementById('backend-mode-badge');
const elPulseDot = document.getElementById('backend-status-dot');
const elMikrotikStatusDot = document.getElementById('mikrotik-status-dot');
const elMikrotikStatusSidebarText = document.getElementById('mikrotik-status-sidebar-text');
const elMikrotikModeBadge = document.getElementById('mikrotik-mode-badge');

const elVmTableBody = document.getElementById('vm-table-body');
const elDashboardVmBody = document.getElementById('dashboard-vm-body');
const elVmSearch = document.getElementById('vm-search');
const elVmStatusFilter = document.getElementById('vm-status-filter');
const elVmCounter = document.getElementById('vm-counter');

const elConsoleLogs = document.getElementById('console-logs');
const elBtnClearLogs = document.getElementById('btn-clear-logs');
const elBtnManualRefresh = document.getElementById('btn-manual-refresh');
const elAlertBanner = document.getElementById('alert-banner');
const elAlertMessage = document.getElementById('alert-message');

// Top Mini stats elements
const elMiniClusterStatus = document.getElementById('mini-cluster-status');
const elMiniLoadAverage = document.getElementById('mini-load-average');
const elMiniIoWait = document.getElementById('mini-io-wait');
const elMiniVmsCount = document.getElementById('mini-vms-count');

// Modal Elements
const elConfirmModal = document.getElementById('confirm-modal');
const elConfirmModalText = document.getElementById('confirm-modal-text');
const elBtnConfirmExecute = document.getElementById('confirm-execute');
const elBtnConfirmCancel = document.getElementById('confirm-cancel');
const elBtnCloseModal = document.getElementById('close-modal');

// Terminal Modal (Demo Console)
const elTerminalModal = document.getElementById('terminal-modal');
const elTerminalTitle = document.getElementById('terminal-title');
const elTerminalBody = document.getElementById('terminal-body');
const elTerminalPrompt = document.getElementById('terminal-prompt');
const elTerminalInput = document.getElementById('terminal-input');
const elBtnCloseTerminalModal = document.getElementById('close-terminal-modal');

// Login Elements
const elLoginOverlay = document.getElementById('login-overlay');
const elLoginForm = document.getElementById('login-form');
const elLoginErrorMsg = document.getElementById('login-error-msg');

// Settings Form
const elSettingsForm = document.getElementById('settings-form');
const elSettingsDemoMode = document.getElementById('settings-demo-mode');
const elSettingsApiUrl = document.getElementById('settings-api-url');
const elSettingsTokenId = document.getElementById('settings-token-id');
const elSettingsTokenSecret = document.getElementById('settings-token-secret');
const elSettingsCredentials = document.getElementById('settings-credentials');

// Toast Element
const elToast = document.getElementById('toast-notification');

// --- Helper Functions & Authenticated API Fetch wrapper ---

async function authenticatedFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (authToken) {
        options.headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    if (options.method && options.method.toUpperCase() === 'POST' && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
    }

    try {
        const response = await fetch(url, options);
        
        // Auto-logout on 401 Unauthorized (unless it's the login route itself)
        if (response.status === 401 && !url.includes('/api/login')) {
            authToken = '';
            localStorage.removeItem('pve_dashboard_token');
            elLoginOverlay.style.display = 'flex';
            showToast('Your session has expired. Please log in again.');
            if (pollerId) clearInterval(pollerId);
            throw new Error('Unauthorized session.');
        }
        
        return response;
    } catch (e) {
        console.error('Fetch operation encountered an error:', e);
        throw e;
    }
}

function setGaugePercent(ringElement, valueElement, percent) {
    const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
    const offset = GAUGE_CIRCUMFERENCE - (safePercent / 100) * GAUGE_CIRCUMFERENCE;
    ringElement.style.strokeDashoffset = offset;
    valueElement.textContent = `${safePercent}%`;
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
    if (!seconds || seconds <= 0) return '-';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    
    let parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    
    return parts.length > 0 ? parts.join(' ') : '< 1m';
}

function addConsoleLog(message, type = 'info') {
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    
    const logItem = document.createElement('div');
    logItem.className = `log-item ${type}`;
    logItem.innerHTML = `<span class="log-time">[${timeStr}]</span> ${message}`;
    
    if (elConsoleLogs) {
        elConsoleLogs.appendChild(logItem);
        elConsoleLogs.scrollTop = elConsoleLogs.scrollHeight;
        
        while (elConsoleLogs.childNodes.length > MAX_LOGS) {
            elConsoleLogs.removeChild(elConsoleLogs.firstChild);
        }
    }
}

function showToast(message) {
    elToast.textContent = message;
    elToast.classList.add('active');
    setTimeout(() => {
        elToast.classList.remove('active');
    }, 3000);
}

function showAlert(message) {
    elAlertMessage.textContent = message;
    elAlertBanner.style.display = 'flex';
}

// --- Dynamic SPA Routing ---

function handleRoute() {
    const hash = window.location.hash || '#dashboard';
    const target = hash.replace('#', '');
    currentActiveRoute = target;
    
    // 1. Sidebar items highlight
    const menuItems = document.querySelectorAll('#sidebar-menu li');
    menuItems.forEach(item => {
        if (item.getAttribute('data-target') === target) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    // 2. Toggle active views
    const sections = document.querySelectorAll('.view-section');
    sections.forEach(sec => {
        if (sec.getAttribute('id') === `view-${target}`) {
            sec.classList.add('active');
        } else {
            sec.classList.remove('active');
        }
    });
    
    // 3. Update Title text
    const titles = {
        dashboard: 'Server Monitoring',
        nodes: 'Cluster Nodes',
        vms: 'VMs &amp; Containers',
        storage: 'Storage Pools',
        backups: 'Backup Schedule &amp; History',
        network: 'Bandwidth &amp; Interfaces',
        switches: 'Network Switches Connection',
        mikrotik: 'MikroTik Router Monitoring',
        settings: 'Proxmox Connection Settings'
    };
    document.getElementById('page-title').textContent = titles[target] || 'Server Monitoring';
    
    // 4. Immediate update on page load
    triggerRouteUpdate(target);
}

function triggerRouteUpdate(target) {
    if (!authToken) return; // Block calling API if not signed in yet
    
    checkBackendStatus().then(online => {
        if (!online) return;
        
        fetchNodeStatus();
        fetchResources();
        
        switch (target) {
            case 'dashboard':
                fetchTasksHistory();
                break;
            case 'nodes':
                fetchNodesList();
                break;
            case 'vms':
                break;
            case 'storage':
                fetchStorageStatus();
                break;
            case 'backups':
                fetchBackupsData();
                break;
            case 'network':
                fetchNetworkInterfaces();
                break;
            case 'switches':
                fetchSwitchesData();
                fetchSwitchesSla();
                break;
            case 'mikrotik':
                fetchMikrotikStats();
                break;
            case 'settings':
                fetchSettings();
                break;
        }
    });
}

// --- Charts Setup ---

function initCharts() {
    const ctx = document.getElementById('networkChart').getContext('2d');
    
    const rxGradient = ctx.createLinearGradient(0, 0, 0, 180);
    rxGradient.addColorStop(0, 'rgba(0, 0, 0, 0.05)');
    rxGradient.addColorStop(1, 'rgba(0, 0, 0, 0.0)');

    const txGradient = ctx.createLinearGradient(0, 0, 0, 180);
    txGradient.addColorStop(0, 'rgba(102, 102, 102, 0.02)');
    txGradient.addColorStop(1, 'rgba(102, 102, 102, 0.0)');

    const mRxGradient = ctx.createLinearGradient(0, 0, 0, 180);
    mRxGradient.addColorStop(0, 'rgba(0, 0, 0, 0.05)');
    mRxGradient.addColorStop(1, 'rgba(0, 0, 0, 0.0)');

    const mTxGradient = ctx.createLinearGradient(0, 0, 0, 180);
    mTxGradient.addColorStop(0, 'rgba(102, 102, 102, 0.02)');
    mTxGradient.addColorStop(1, 'rgba(102, 102, 102, 0.0)');

    // 1. Proxmox VE main chart
    networkChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({ length: 20 }, () => ''),
            datasets: [
                {
                    label: 'PVE RX',
                    data: Array(20).fill(0),
                    borderColor: '#000000',
                    borderWidth: 2,
                    backgroundColor: rxGradient,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0
                },
                {
                    label: 'PVE TX',
                    data: Array(20).fill(0),
                    borderColor: '#666666',
                    borderWidth: 2,
                    borderDash: [4, 4],
                    backgroundColor: txGradient,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { display: false } },
                y: {
                    grid: { color: '#e5e7eb' },
                    ticks: {
                        color: '#4b5563',
                        font: { family: 'Outfit', size: 9 },
                        callback: function(value) { return value + ' Mb/s'; }
                    }
                }
            }
        }
    });

    // 2. MikroTik Router main chart
    const ctxMikrotik = document.getElementById('mikrotikChart').getContext('2d');
    mikrotikChart = new Chart(ctxMikrotik, {
        type: 'line',
        data: {
            labels: Array.from({ length: 20 }, () => ''),
            datasets: [
                {
                    label: 'Router RX',
                    data: Array(20).fill(0),
                    borderColor: '#000000',
                    borderWidth: 2,
                    backgroundColor: mRxGradient,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0
                },
                {
                    label: 'Router TX',
                    data: Array(20).fill(0),
                    borderColor: '#666666',
                    borderWidth: 2,
                    borderDash: [4, 4],
                    backgroundColor: mTxGradient,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { display: false } },
                y: {
                    grid: { color: '#e5e7eb' },
                    ticks: {
                        color: '#4b5563',
                        font: { family: 'Outfit', size: 9 },
                        callback: function(value) { return value + ' Mb/s'; }
                    }
                }
            }
        }
    });

    // 3. Proxmox VE large chart (Network tab)
    const ctxLarge = document.getElementById('largeNetworkChart').getContext('2d');
    largeNetworkChart = new Chart(ctxLarge, {
        type: 'line',
        data: {
            labels: Array.from({ length: 20 }, () => ''),
            datasets: [
                {
                    label: 'PVE RX',
                    data: Array(20).fill(0),
                    borderColor: '#000000',
                    borderWidth: 2.5,
                    backgroundColor: rxGradient,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 2,
                    pointHoverRadius: 5
                },
                {
                    label: 'PVE TX',
                    data: Array(20).fill(0),
                    borderColor: '#666666',
                    borderWidth: 2.5,
                    borderDash: [4, 4],
                    backgroundColor: txGradient,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 2,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { display: false } },
                y: {
                    grid: { color: '#e5e7eb' },
                    ticks: {
                        color: '#4b5563',
                        font: { family: 'Outfit', size: 10 },
                        callback: function(value) { return value + ' Mb/s'; }
                    }
                }
            }
        }
    });

    // 4. MikroTik Router large chart (MikroTik tab)
    const ctxMikrotikDetail = document.getElementById('mikrotikDetailChart').getContext('2d');
    mikrotikDetailChart = new Chart(ctxMikrotikDetail, {
        type: 'line',
        data: {
            labels: Array.from({ length: 20 }, () => ''),
            datasets: [
                {
                    label: 'WAN RX',
                    data: Array(20).fill(0),
                    borderColor: '#000000',
                    borderWidth: 2.5,
                    backgroundColor: mRxGradient,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 2,
                    pointHoverRadius: 5
                },
                {
                    label: 'WAN TX',
                    data: Array(20).fill(0),
                    borderColor: '#666666',
                    borderWidth: 2.5,
                    borderDash: [4, 4],
                    backgroundColor: mTxGradient,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 2,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { display: false } },
                y: {
                    grid: { color: '#e5e7eb' },
                    ticks: {
                        color: '#4b5563',
                        font: { family: 'Outfit', size: 10 },
                        callback: function(value) { return value + ' Mb/s'; }
                    }
                }
            }
        }
    });
}

function updateCharts(rxHistory, txHistory, mRxHistory, mTxHistory) {
    if (rxHistory && txHistory) {
        if (networkChart) {
            networkChart.data.datasets[0].data = rxHistory;
            networkChart.data.datasets[1].data = txHistory;
            networkChart.update('none');
        }
        if (largeNetworkChart) {
            largeNetworkChart.data.datasets[0].data = rxHistory;
            largeNetworkChart.data.datasets[1].data = txHistory;
            largeNetworkChart.update('none');
        }
    }
    if (mRxHistory && mTxHistory) {
        if (mikrotikChart) {
            mikrotikChart.data.datasets[0].data = mRxHistory;
            mikrotikChart.data.datasets[1].data = mTxHistory;
            mikrotikChart.update('none');
        }
        if (mikrotikDetailChart) {
            mikrotikDetailChart.data.datasets[0].data = mRxHistory;
            mikrotikDetailChart.data.datasets[1].data = mTxHistory;
            mikrotikDetailChart.update('none');
        }
    }
    if (!rxHistory && !txHistory && !mRxHistory && !mTxHistory) {
        const dummyRx = Math.floor(10 + Math.random() * 20);
        const dummyTx = Math.floor(5 + Math.random() * 10);
        [networkChart, largeNetworkChart, mikrotikChart, mikrotikDetailChart].forEach(chart => {
            if (!chart) return;
            chart.data.datasets[0].data.push(dummyRx);
            chart.data.datasets[1].data.push(dummyTx);
            chart.data.datasets[0].data.shift();
            chart.data.datasets[1].data.shift();
            chart.update('none');
        });
    }
}

function initLogTabs() {
    const tabs = document.querySelectorAll('.log-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active');
                t.style.color = 'var(--text-secondary)';
                t.style.fontWeight = '500';
            });
            tab.classList.add('active');
            tab.style.color = 'var(--text-primary)';
            tab.style.fontWeight = '700';
            
            const target = tab.getAttribute('data-tab');
            const contents = document.querySelectorAll('.events-log-card .tab-content');
            contents.forEach(content => {
                let show = false;
                if (target === 'tasks' && content.getAttribute('id') === 'proxmox-tasks-logs') show = true;
                else if (target === 'system' && content.getAttribute('id') === 'console-logs') show = true;
                else if (target === 'sla' && content.getAttribute('id') === 'sla-logs') show = true;
                
                if (show) {
                    content.style.display = 'flex';
                } else {
                    content.style.display = 'none';
                }
            });
        });
    });
}

function initConsoleTabs() {
    const tabs = document.querySelectorAll('.console-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active');
                t.style.background = 'transparent';
                t.style.color = 'var(--text-secondary)';
            });
            tab.classList.add('active');
            tab.style.background = 'rgba(0,242,254,0.1)';
            tab.style.color = 'var(--color-teal)';
            
            const target = tab.getAttribute('data-tab');
            if (target === 'cli') {
                document.getElementById('terminal-view-cli').style.display = 'flex';
                document.getElementById('terminal-view-vnc').style.display = 'none';
            } else {
                document.getElementById('terminal-view-cli').style.display = 'none';
                document.getElementById('terminal-view-vnc').style.display = 'block';
            }
        });
    });
}

// --- Fetch Data Functions ---

async function checkBackendStatus() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/status`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        
        elPulseDot.className = 'pulse-dot';
        elPulseDot.style.backgroundColor = '#111827';
        elBackendStatus.textContent = 'Connected Backend';
        
        demoModeActive = data.mode === 'demo';
        proxmoxWebUrl = data.proxmoxWebUrl || '';
        
        if (demoModeActive) {
            elBackendMode.textContent = 'DEMO SIMULATION';
            elBackendMode.className = 'badge-demo';
            elBackendMode.style.background = '#ffffff';
            elBackendMode.style.color = '#9ca3af';
            elBackendMode.style.borderColor = '#e5e7eb';
        } else {
            elBackendMode.textContent = 'PROXMOX ACTIVE';
            elBackendMode.className = 'badge-demo';
            elBackendMode.style.background = '#111827';
            elBackendMode.style.color = '#ffffff';
            elBackendMode.style.borderColor = '#111827';
        }

        // Update MikroTik status in sidebar footer
        const isMikrotikOnline = data.mikrotikOnline;
        if (isMikrotikOnline) {
            elMikrotikStatusDot.className = 'pulse-dot';
            elMikrotikStatusDot.style.backgroundColor = '#111827';
            elMikrotikStatusSidebarText.textContent = 'MikroTik: Connected';
            
            elMikrotikModeBadge.textContent = 'MIKROTIK ACTIVE';
            elMikrotikModeBadge.style.background = '#111827';
            elMikrotikModeBadge.style.color = '#ffffff';
            elMikrotikModeBadge.style.borderColor = '#111827';
        } else {
            elMikrotikStatusDot.className = 'pulse-dot';
            elMikrotikStatusDot.style.backgroundColor = '#9ca3af';
            elMikrotikStatusSidebarText.textContent = 'MikroTik: Offline';
            
            elMikrotikModeBadge.textContent = 'MIKROTIK OFFLINE';
            elMikrotikModeBadge.style.background = '#ffffff';
            elMikrotikModeBadge.style.color = '#9ca3af';
            elMikrotikModeBadge.style.borderColor = '#e5e7eb';
        }
        return true;
    } catch (e) {
        elPulseDot.className = 'pulse-dot';
        elPulseDot.style.backgroundColor = '#9ca3af';
        elBackendStatus.textContent = 'Backend Offline';
        
        elBackendMode.textContent = 'NO CONNECTION';
        elBackendMode.className = 'badge-demo';
        elBackendMode.style.background = '#ffffff';
        elBackendMode.style.color = '#9ca3af';
        elBackendMode.style.borderColor = '#e5e7eb';

        elMikrotikStatusDot.className = 'pulse-dot';
        elMikrotikStatusDot.style.backgroundColor = '#9ca3af';
        elMikrotikStatusSidebarText.textContent = 'MikroTik: Offline';

        elMikrotikModeBadge.textContent = 'MIKROTIK OFFLINE';
        elMikrotikModeBadge.style.background = '#ffffff';
        elMikrotikModeBadge.style.color = '#9ca3af';
        elMikrotikModeBadge.style.borderColor = '#e5e7eb';

        return false;
    }
}

async function fetchNodeStatus() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/node-status`);
        if (!response.ok) throw new Error();
        const node = await response.json();
        
        // Update host stats variables
        currentNodeName = node.node;
        currentNodeUptime = node.uptime || 0;
        currentNodeCpuModel = node.cpuinfo ? node.cpuinfo.model : 'Intel Xeon';
        currentNodeCpus = node.cpuinfo ? node.cpuinfo.cpus : 8;
        currentNodeMemUsed = node.memory ? node.memory.used : 0;
        currentNodeMemTotal = node.memory ? node.memory.total : 0;
        currentNodeKversion = node.kversion || 'Linux Kernel';
        
        elNodeDisplay.textContent = `Node: ${node.node} (${node.status === 'online' ? 'Online' : 'Offline'})`;
        elPveVersion.textContent = `${node.pveVersion} (${node.kversion || 'Linux Kernel'})`;
        elCpuNodeName.textContent = node.node;
        
        if (elCpuHostModel && node.cpuinfo) {
            elCpuHostModel.textContent = `${node.cpuinfo.model} (${node.cpuinfo.cpus} Cores)`;
            elCpuHostModel.title = node.cpuinfo.model;
        }
        
        setGaugePercent(elCpuRing, elCpuValue, node.cpu * 100);
        
        const ramPercent = (node.memory.used / node.memory.total) * 100;
        setGaugePercent(elRamRing, elRamValue, ramPercent);
        elRamUsageText.textContent = `${formatBytes(node.memory.used, 1)} / ${formatBytes(node.memory.total, 0)}`;
        
        const storagePercent = (node.disk.used / node.disk.total) * 100;
        setGaugePercent(elStorageRing, elStorageValue, storagePercent);
        elStorageUsageText.textContent = `${formatBytes(node.disk.used, 1)} / ${formatBytes(node.disk.total, 1)}`;
        
        elMiniLoadAverage.textContent = node.loadavg ? node.loadavg.join(', ') : '0.00, 0.00, 0.00';
        elMiniIoWait.textContent = `${node.iowait || '0.00'}%`;
        
        const elMiniMikrotikStatus = document.getElementById('mini-mikrotik-status');
        if (elMiniMikrotikStatus && node.mikrotikNetwork) {
            if (node.mikrotikNetwork.online) {
                elMiniMikrotikStatus.innerHTML = `<span style="color: #10b981; font-weight: 500;">Online (${node.mikrotikNetwork.cpu}%)</span>`;
            } else {
                elMiniMikrotikStatus.innerHTML = '<span style="color: #ef4444; font-weight: 500;">Offline</span>';
            }
        }
        
        if (node.cpu * 100 > 90 || ramPercent > 90) {
            showAlert(`WARNING: High server usage! CPU: ${Math.round(node.cpu * 100)}%, RAM: ${Math.round(ramPercent)}%`);
        }
        
        if (node.network && node.network.rxHistory) {
            if (node.mikrotikNetwork) {
                updateCharts(
                    node.network.rxHistory,
                    node.network.txHistory,
                    node.mikrotikNetwork.rxHistory,
                    node.mikrotikNetwork.txHistory
                );
            } else {
                updateCharts(node.network.rxHistory, node.network.txHistory);
            }
        } else {
            updateCharts(null, null);
        }
    } catch (error) {
        addConsoleLog(`Failed to fetch Node metrics: ${error.message}`, 'error');
    }
}

async function fetchNodesList() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/nodes-list`);
        if (!response.ok) throw new Error();
        const nodes = await response.json();
        
        elMiniClusterStatus.textContent = `${nodes.filter(n => n.status === 'online').length} / ${nodes.length} Online`;

        const tbody = document.getElementById('nodes-table-body');
        tbody.innerHTML = '';
        nodes.forEach(nd => {
            const isOnline = nd.status === 'online';
            tbody.innerHTML += `
                <tr>
                    <td><strong>${nd.node}</strong></td>
                    <td>
                        <span class="status-badge ${isOnline ? 'online' : 'offline'}">
                            <span class="dot"></span> ${nd.status.toUpperCase()}
                        </span>
                    </td>
                    <td>${isOnline ? Math.round(nd.cpu * 100) + '%' : '-'}</td>
                    <td>${isOnline ? formatBytes(nd.mem, 1) + ' / ' + formatBytes(nd.maxmem, 0) : '-'}</td>
                    <td>${isOnline ? formatUptime(nd.uptime) : '-'}</td>
                    <td><span class="badge-demo" style="background: #f3f4f6; color: #111827; border-color: #d1d5db; font-size: 9px;">${nd.level ? nd.level.toUpperCase() : 'MEMBER'}</span></td>
                </tr>
            `;
        });
    } catch (e) {
        addConsoleLog(`Failed to fetch node list: ${e.message}`, 'error');
    }
}

async function fetchResources() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/resources`);
        if (!response.ok) throw new Error();
        const vms = await response.json();
        currentVms = vms;
        
        const running = vms.filter(v => v.status === 'running').length;
        elMiniVmsCount.textContent = `${running} / ${vms.length} Active`;

        // Track VM/LXC offline/SLA events
        trackSlaStatus(vms);

        // 1. Render main VMs view table
        renderVmTable(vms);
        
        // 2. Render summary VMs table in Dashboard view (showing max 4 vms)
        renderDashboardVmTable(vms);

        // 3. Render Top Resource Consumers widget
        renderTopConsumers(vms);
    } catch (error) {
        addConsoleLog(`Failed to fetch VM/Containers: ${error.message}`, 'error');
    }
}

function trackSlaStatus(vms) {
    let changed = false;
    vms.forEach(vm => {
        const prevStatus = previousVmStatuses[vm.vmid];
        if (prevStatus && prevStatus !== vm.status) {
            let message = '';
            if (vm.status === 'stopped' && prevStatus === 'running') {
                message = `SLA BREACH: ${vm.type.toUpperCase()} ${vm.name} (${vm.vmid}) is Offline!`;
                slaAlerts.unshift({
                    timestamp: new Date().toLocaleTimeString(),
                    vmid: vm.vmid,
                    name: vm.name,
                    type: 'stopped',
                    message
                });
                changed = true;
            } else if (vm.status === 'running' && prevStatus === 'stopped') {
                message = `SLA RESTORED: ${vm.type.toUpperCase()} ${vm.name} (${vm.vmid}) is Online!`;
                slaAlerts.unshift({
                    timestamp: new Date().toLocaleTimeString(),
                    vmid: vm.vmid,
                    name: vm.name,
                    type: 'running',
                    message
                });
                changed = true;
            }
        }
        previousVmStatuses[vm.vmid] = vm.status;
    });

    const elSlaLogs = document.getElementById('sla-logs');
    if (changed || !elSlaLogs || elSlaLogs.children.length === 0) {
        if (slaAlerts.length > 50) slaAlerts.pop();
        renderSlaAlerts();
    }
}

function renderSlaAlerts() {
    const el = document.getElementById('sla-logs');
    if (!el) return;
    el.innerHTML = '';
    
    if (slaAlerts.length === 0) {
        el.innerHTML = `<div class="text-muted text-center" style="font-size: 11px; padding: 20px;">No SLA alarm history available.</div>`;
        return;
    }
    
    slaAlerts.forEach(alert => {
        const isBreach = alert.type === 'stopped';
        el.innerHTML += `
            <div class="log-item" style="border-left: 3px solid ${isBreach ? '#111827' : '#9ca3af'}; padding: 8px; margin-bottom: 6px; background: #fafafa; border: 1px solid #e5e7eb; border-left-width: 3px; border-radius: 4px; display: flex; gap: 8px; font-size: 11px;">
                <span class="log-time" style="color: var(--text-secondary); font-family: monospace;">[${alert.timestamp}]</span>
                <span class="log-message" style="color: #111827; font-weight: 500;">${alert.message}</span>
            </div>
        `;
    });
}

function renderVmTable(vms) {
    const searchFilter = elVmSearch.value.toLowerCase();
    const statusFilter = elVmStatusFilter.value;
    
    const filteredVms = vms.filter(vm => {
        const matchesSearch = vm.name.toLowerCase().includes(searchFilter) || vm.vmid.toString().includes(searchFilter);
        const matchesStatus = statusFilter === 'all' || vm.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    elVmCounter.textContent = `Total: ${filteredVms.length}`;
    
    if (filteredVms.length === 0) {
        elVmTableBody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No Virtual Machine or Container found.</td></tr>`;
        return;
    }

    elVmTableBody.innerHTML = '';
    filteredVms.forEach(vm => {
        let statusClass = 'offline';
        let statusText = 'Offline';
        if (vm.status === 'running') {
            statusClass = 'online';
            statusText = 'Online';
        } else if (vm.status === 'starting' || vm.status === 'stopping') {
            statusClass = 'starting';
            statusText = vm.status;
        }
        
        const cpuPercent = Math.round(vm.cpu * 100);
        let cpuBarClass = 'teal';
        if (cpuPercent > 80) cpuBarClass = 'coral';
        else if (cpuPercent > 50) cpuBarClass = 'purple';

        const ramPercent = vm.maxmem > 0 ? Math.round((vm.mem / vm.maxmem) * 100) : 0;
        let ramBarClass = 'teal';
        if (ramPercent > 80) ramBarClass = 'coral';
        else if (ramPercent > 50) ramBarClass = 'purple';

        const isRunning = vm.status === 'running';
        const isTransition = vm.status === 'starting' || vm.status === 'stopping';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${vm.vmid}</strong></td>
            <td>
                <i class="fa-solid ${vm.type === 'qemu' ? 'fa-computer vm-type-icon qemu' : 'fa-box vm-type-icon lxc'}" title="${vm.type === 'qemu' ? 'VM' : 'CT'}"></i>
                <span class="text-muted" style="font-size: 11px; margin-left: 4px;">${vm.type.toUpperCase()}</span>
            </td>
            <td>${vm.name}</td>
            <td><span class="status-badge ${statusClass}"><span class="dot"></span> ${statusText}</span></td>
            <td>
                ${isRunning ? `
                    <div class="table-progress-text">${cpuPercent}%</div>
                    <div class="progress-bar-container"><div class="progress-bar-fill ${cpuBarClass}" style="width: ${cpuPercent}%"></div></div>
                ` : '-'}
            </td>
            <td>
                ${isRunning && vm.maxmem > 0 ? `
                    <div class="table-progress-text">${ramPercent}% (${formatBytes(vm.mem, 1)})</div>
                    <div class="progress-bar-container"><div class="progress-bar-fill ${ramBarClass}" style="width: ${ramPercent}%"></div></div>
                ` : '-'}
            </td>
            <td>
                ${isRunning ? `
                    <div style="font-size: 11px; line-height: 1.4;">
                        <span style="color: var(--color-teal);"><i class="fa-solid fa-arrow-down" style="font-size: 9px;"></i> ${formatBytes(vm.netin || 0, 1)}</span><br>
                        <span style="color: var(--color-purple);"><i class="fa-solid fa-arrow-up" style="font-size: 9px;"></i> ${formatBytes(vm.netout || 0, 1)}</span>
                    </div>
                ` : '-'}
            </td>
            <td>${formatUptime(vm.uptime)}</td>
            <td class="text-right">
                <div class="actions-cell">
                    <button class="btn-action start" onclick="confirmAction('${vm.node}', ${vm.vmid}, 'start', '${vm.name}')" ${isRunning || isTransition ? 'disabled' : ''} title="Start VM"><i class="fa-solid fa-play"></i></button>
                    <button class="btn-action stop" onclick="confirmAction('${vm.node}', ${vm.vmid}, 'shutdown', '${vm.name}')" ${!isRunning || isTransition ? 'disabled' : ''} title="Shutdown VM"><i class="fa-solid fa-power-off"></i></button>
                    <button class="btn-action console" onclick="openConsole('${vm.node}', ${vm.vmid}, '${vm.name}', '${vm.type}')" ${!isRunning ? 'disabled' : ''} title="Buka Console"><i class="fa-solid fa-terminal"></i></button>
                    <button class="btn-action reboot" onclick="confirmAction('${vm.node}', ${vm.vmid}, 'reboot', '${vm.name}')" ${!isRunning || isTransition ? 'disabled' : ''} title="Reboot VM"><i class="fa-solid fa-arrows-rotate"></i></button>
                </div>
            </td>
        `;
        elVmTableBody.appendChild(row);
    });
}

function renderDashboardVmTable(vms) {
    const el = elDashboardVmBody;
    el.innerHTML = '';
    
    const summaryList = vms.slice(0, 4);
    
    if (summaryList.length === 0) {
        el.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Tidak ada Virtual Machine terdaftar.</td></tr>`;
        return;
    }

    summaryList.forEach(vm => {
        let statusClass = 'offline';
        let statusText = 'Offline';
        if (vm.status === 'running') {
            statusClass = 'online';
            statusText = 'Online';
        } else if (vm.status === 'starting' || vm.status === 'stopping') {
            statusClass = 'starting';
            statusText = vm.status;
        }
        
        const isTransition = vm.status === 'starting' || vm.status === 'stopping';
        const isRunning = vm.status === 'running';
        const cpuPercent = Math.round(vm.cpu * 100);
        let cpuBarClass = 'teal';
        if (cpuPercent > 80) cpuBarClass = 'coral';
        else if (cpuPercent > 50) cpuBarClass = 'purple';

        const ramPercent = vm.maxmem > 0 ? Math.round((vm.mem / vm.maxmem) * 100) : 0;
        let ramBarClass = 'teal';
        if (ramPercent > 80) ramBarClass = 'coral';
        else if (ramPercent > 50) ramBarClass = 'purple';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${vm.vmid}</strong></td>
            <td>
                <i class="fa-solid ${vm.type === 'qemu' ? 'fa-computer vm-type-icon qemu' : 'fa-box vm-type-icon lxc'}"></i>
                <span class="text-muted" style="font-size: 11px; margin-left: 4px;">${vm.type.toUpperCase()}</span>
            </td>
            <td>${vm.name}</td>
            <td><span class="status-badge ${statusClass}"><span class="dot"></span> ${statusText}</span></td>
            <td>
                ${isRunning ? `
                    <div class="table-progress-text">${cpuPercent}%</div>
                    <div class="progress-bar-container"><div class="progress-bar-fill ${cpuBarClass}" style="width: ${cpuPercent}%"></div></div>
                ` : '-'}
            </td>
            <td>
                ${isRunning && vm.maxmem > 0 ? `
                    <div class="table-progress-text">${ramPercent}% (${formatBytes(vm.mem, 1)})</div>
                    <div class="progress-bar-container"><div class="progress-bar-fill ${ramBarClass}" style="width: ${ramPercent}%"></div></div>
                ` : '-'}
            </td>
            <td>
                ${isRunning ? `
                    <div style="font-size: 11px; line-height: 1.4;">
                        <span style="color: var(--color-teal);"><i class="fa-solid fa-arrow-down" style="font-size: 9px;"></i> ${formatBytes(vm.netin || 0, 1)}</span><br>
                        <span style="color: var(--color-purple);"><i class="fa-solid fa-arrow-up" style="font-size: 9px;"></i> ${formatBytes(vm.netout || 0, 1)}</span>
                    </div>
                ` : '-'}
            </td>
            <td>${formatUptime(vm.uptime)}</td>
            <td class="text-right">
                <div class="actions-cell">
                    <button class="btn-action start" onclick="confirmAction('${vm.node}', ${vm.vmid}, 'start', '${vm.name}')" ${isRunning ? 'disabled' : ''} title="Start VM"><i class="fa-solid fa-play"></i></button>
                    <button class="btn-action stop" onclick="confirmAction('${vm.node}', ${vm.vmid}, 'shutdown', '${vm.name}')" ${!isRunning || isTransition ? 'disabled' : ''} title="Shutdown VM"><i class="fa-solid fa-power-off"></i></button>
                    <button class="btn-action console" onclick="openConsole('${vm.node}', ${vm.vmid}, '${vm.name}', '${vm.type}')" ${!isRunning ? 'disabled' : ''} title="Buka Console"><i class="fa-solid fa-terminal"></i></button>
                </div>
            </td>
        `;
        el.appendChild(row);
    });
}

function renderTopConsumers(vms) {
    const container = document.getElementById('top-consumers-container');
    container.innerHTML = '';
    
    const runningVms = vms.filter(v => v.status === 'running');
    
    if (runningVms.length === 0) {
        container.innerHTML = `<div class="text-muted text-center" style="font-size: 12px; padding-top: 30px;">Tidak ada VM berjalan aktif.</div>`;
        return;
    }
    
    const topCpu = [...runningVms].sort((a, b) => b.cpu - a.cpu).slice(0, 2);
    const topRam = [...runningVms].sort((a, b) => (b.mem / b.maxmem) - (a.mem / a.maxmem)).slice(0, 2);
    
    // Render CPU Consumers
    topCpu.forEach(vm => {
        const val = Math.round(vm.cpu * 100);
        container.innerHTML += `
            <div class="consumer-item">
                <div class="consumer-info">
                    <span class="consumer-name"><i class="fa-solid fa-microchip" style="color: var(--color-teal); margin-right: 6px;"></i>${vm.name}</span>
                    <span class="consumer-value cpu">${val}% CPU</span>
                </div>
                <div class="consumer-progress">
                    <div class="consumer-progress-fill cpu" style="width: ${val}%"></div>
                </div>
            </div>
        `;
    });
    
    // Render RAM Consumers
    topRam.forEach(vm => {
        const pct = vm.maxmem > 0 ? Math.round((vm.mem / vm.maxmem) * 100) : 0;
        container.innerHTML += `
            <div class="consumer-item">
                <div class="consumer-info">
                    <span class="consumer-name"><i class="fa-solid fa-memory" style="color: var(--color-purple); margin-right: 6px;"></i>${vm.name}</span>
                    <span class="consumer-value ram">${pct}% RAM</span>
                </div>
                <div class="consumer-progress">
                    <div class="consumer-progress-fill ram" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
    });
}

async function fetchStorageStatus() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/storage`);
        if (!response.ok) throw new Error();
        const storages = await response.json();
        
        const tbody = document.getElementById('storage-table-body');
        tbody.innerHTML = '';
        storages.forEach(st => {
            const usedPercent = st.size > 0 ? Math.round((st.used / st.size) * 100) : 0;
            let barClass = 'normal';
            if (usedPercent > 85) barClass = 'danger';
            else if (usedPercent > 70) barClass = 'warning';
            
            tbody.innerHTML += `
                <tr>
                    <td><strong>${st.storage}</strong></td>
                    <td><span class="text-muted" style="font-size: 11px;">${st.type.toUpperCase()}</span></td>
                    <td>${st.content}</td>
                    <td>${formatBytes(st.size, 0)}</td>
                    <td>${formatBytes(st.used, 1)}</td>
                    <td>
                        <div class="table-progress-text">${usedPercent}%</div>
                        <div class="storage-bar-container"><div class="storage-bar-fill ${barClass}" style="width: ${usedPercent}%"></div></div>
                    </td>
                    <td>
                        <span class="status-badge ${st.active === 1 ? 'online' : 'offline'}">
                            <span class="dot"></span> ${st.active === 1 ? 'ACTIVE' : 'OFFLINE'}
                        </span>
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        addConsoleLog(`Failed to fetch Storage data: ${e.message}`, 'error');
    }
}

async function fetchBackupsData() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/backups`);
        if (!response.ok) throw new Error();
        const backups = await response.json();
        
        const scheduleBody = document.getElementById('backup-schedule-body');
        scheduleBody.innerHTML = '';
        backups.schedules.forEach(sc => {
            scheduleBody.innerHTML += `
                <tr>
                    <td><strong>${sc.id || 'backup-vzdump'}</strong></td>
                    <td>${sc.schedule}</td>
                    <td>${sc.vms}</td>
                    <td>${sc.storage}</td>
                    <td><span class="status-badge ${sc.enabled === 1 ? 'online' : 'offline'}"><span class="dot"></span> ${sc.enabled === 1 ? 'ENABLED' : 'DISABLED'}</span></td>
                </tr>
            `;
        });

        const historyBody = document.getElementById('backup-history-body');
        historyBody.innerHTML = '';
        backups.history.forEach(hs => {
            historyBody.innerHTML += `
                <tr>
                    <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><strong>${hs.file}</strong></td>
                    <td>${hs.vmid}</td>
                    <td>${hs.date}</td>
                    <td>${hs.size > 0 ? formatBytes(hs.size, 1) : '-'}</td>
                    <td><span class="status-badge ${hs.status === 'OK' ? 'online' : 'offline'}"><span class="dot"></span> ${hs.status}</span></td>
                </tr>
            `;
        });
    } catch (e) {
        addConsoleLog(`Failed to fetch Backup data: ${e.message}`, 'error');
    }
}

async function fetchNetworkInterfaces() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/network-interfaces`);
        if (!response.ok) throw new Error();
        const interfaces = await response.json();
        
        const tbody = document.getElementById('network-table-body');
        tbody.innerHTML = '';
        interfaces.forEach(ifc => {
            tbody.innerHTML += `
                <tr>
                    <td><strong>${ifc.iface}</strong></td>
                    <td><span class="text-muted" style="font-size: 11px;">${ifc.type.toUpperCase()}</span></td>
                    <td>${ifc.address || '-'}</td>
                    <td><span class="status-badge ${ifc.active === 1 ? 'online' : 'offline'}"><span class="dot"></span> ${ifc.active === 1 ? 'UP' : 'DOWN'}</span></td>
                </tr>
            `;
        });
    } catch (e) {
        addConsoleLog(`Failed to fetch network interfaces data: ${e.message}`, 'error');
    }
}

async function fetchMikrotikStats() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/mikrotik/stats`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        
        const elStatusText = document.getElementById('mikrotik-status-text');
        const elUptimeText = document.getElementById('mikrotik-uptime-text');
        const elCpuText = document.getElementById('mikrotik-cpu-text');
        const elCpuBar = document.getElementById('mikrotik-cpu-bar');
        const elRamText = document.getElementById('mikrotik-ram-text');
        const elRamPct = document.getElementById('mikrotik-ram-pct');
        
        const elSpecName = document.getElementById('mikrotik-spec-name');
        const elSpecModel = document.getElementById('mikrotik-spec-model');
        const elSpecOs = document.getElementById('mikrotik-spec-os');
        const elSpecIp = document.getElementById('mikrotik-spec-ip');
        
        const elDiskText = document.getElementById('mikrotik-disk-text');
        const elDiskBar = document.getElementById('mikrotik-disk-bar');
        const elDiskPct = document.getElementById('mikrotik-disk-pct');
        
        const elInterfacesBody = document.getElementById('mikrotik-interfaces-body');

        if (!data.online) {
            elStatusText.innerHTML = '<span style="color: #6b7280;"><i class="fa-solid fa-circle-xmark"></i> Offline</span>';
            elUptimeText.textContent = 'Uptime: --';
            return;
        }

        // 1. Status & Uptime
        elStatusText.innerHTML = '<span style="color: #111827;"><i class="fa-solid fa-circle-check"></i> Online</span>';
        elUptimeText.textContent = `Uptime: ${formatUptime(data.identity.uptime)}`;

        // 2. CPU
        elCpuText.textContent = `${data.resources.cpu}%`;
        elCpuBar.style.width = `${data.resources.cpu}%`;

        // 3. RAM Memory
        const ramUsedStr = formatBytes(data.resources.ramUsed, 1);
        const ramTotalStr = formatBytes(data.resources.ramTotal, 1);
        elRamText.textContent = `${ramUsedStr} / ${ramTotalStr}`;
        const ramPctVal = data.resources.ramTotal > 0 ? Math.round((data.resources.ramUsed / data.resources.ramTotal) * 100) : 0;
        elRamPct.textContent = `${ramPctVal}% used`;

        // 4. Specs
        elSpecName.textContent = data.identity.name;
        elSpecModel.textContent = data.identity.model;
        elSpecOs.textContent = data.identity.version;
        elSpecIp.textContent = data.specIp || BACKEND_URL.replace(/:\d+/, '').replace('http://', '').replace('https://', '');

        // 5. Disk Storage
        const diskUsedStr = formatBytes(data.resources.diskUsed, 1);
        const diskTotalStr = formatBytes(data.resources.diskTotal, 1);
        elDiskText.textContent = `${diskUsedStr} / ${diskTotalStr}`;
        const diskPctVal = data.resources.diskTotal > 0 ? Math.round((data.resources.diskUsed / data.resources.diskTotal) * 100) : 0;
        elDiskBar.style.width = `${diskPctVal}%`;
        elDiskPct.textContent = `${diskPctVal}% used`;

        // 6. Interfaces table
        if (data.interfaces && data.interfaces.length > 0) {
            elInterfacesBody.innerHTML = '';
            data.interfaces.forEach(iface => {
                const tr = document.createElement('tr');
                
                const statusBadge = iface.status === 'up' 
                    ? '<span class="status-badge online"><span class="dot"></span> UP</span>' 
                    : '<span class="status-badge offline"><span class="dot"></span> DOWN</span>';

                // Display RX / TX rates nicely
                const rxRateFormatted = formatBandwidth(iface.rxRate);
                const txRateFormatted = formatBandwidth(iface.txRate);
                const rxTotalFormatted = formatBytes(iface.rxBytes, 2);
                const txTotalFormatted = formatBytes(iface.txBytes, 2);

                tr.innerHTML = `
                    <td><strong>${iface.name}</strong></td>
                    <td>${statusBadge}</td>
                    <td style="color: #111827;"><i class="fa-solid fa-arrow-down" style="font-size:10px; margin-right:4px;"></i> ${rxRateFormatted}</td>
                    <td style="color: #6b7280;"><i class="fa-solid fa-arrow-up" style="font-size:10px; margin-right:4px;"></i> ${txRateFormatted}</td>
                    <td style="font-size:11px; color:var(--text-secondary);">${rxTotalFormatted}</td>
                    <td style="font-size:11px; color:var(--text-secondary);">${txTotalFormatted}</td>
                `;
                elInterfacesBody.appendChild(tr);
            });
        } else {
            elInterfacesBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No interface data available.</td></tr>';
        }
    } catch (err) {
        addConsoleLog(`Failed to fetch MikroTik data: ${err.message}`, 'error');
    }
}

function formatBandwidth(bytesPerSec) {
    const bitsPerSec = bytesPerSec * 8;
    if (bitsPerSec >= 1000000) {
        return `${(bitsPerSec / 1000000).toFixed(2)} Mb/s`;
    }
    if (bitsPerSec >= 1000) {
        return `${(bitsPerSec / 1000).toFixed(1)} Kb/s`;
    }
    return `${bitsPerSec} b/s`;
}

async function fetchTasksHistory() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/tasks`);
        if (!response.ok) throw new Error();
        const tasks = await response.json();
        
        const el = document.getElementById('proxmox-tasks-logs');
        el.innerHTML = '';
        
        if (tasks.length === 0) {
            el.innerHTML = `<div class="text-muted text-center" style="font-size: 12px; padding-top: 20px;">No Proxmox task history found.</div>`;
            return;
        }
        
        tasks.forEach(tk => {
            let statusClass = tk.status === 'OK' ? 'success' : 'error';
            const date = new Date(tk.starttime * 1000).toLocaleTimeString();
            
            el.innerHTML += `
                <div class="log-item ${statusClass}">
                    <span class="log-time">[${date}]</span>
                    <strong>${tk.type.toUpperCase()}</strong> on Node <strong>${tk.node}</strong> &mdash; 
                    <span style="font-weight: 700; color: ${tk.status === 'OK' ? 'var(--color-green)' : 'var(--color-coral)'}">${tk.status}</span> 
                    <span class="text-muted" style="font-size: 9px; margin-left: 6px;">(${tk.user})</span>
                </div>
            `;
        });
    } catch (e) {
        console.error('Failed to fetch tasks history:', e);
    }
}

let previousSwitchStatuses = {};

async function fetchSwitchesData() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/switches`);
        if (!response.ok) throw new Error();
        const devices = await response.json();
        
        // 1. Alert toast notifications on status connection changes (realtime SLA down/up alerts)
        devices.forEach(sw => {
            const prevStatus = previousSwitchStatuses[sw.id];
            if (prevStatus && prevStatus !== sw.status) {
                if (sw.status === 'offline') {
                    showToast(`[SLA BREACH] Switch ${sw.name} went offline!`);
                } else if (sw.status === 'online') {
                    showToast(`[SLA RESTORED] Switch ${sw.name} is back online!`);
                }
            }
            previousSwitchStatuses[sw.id] = sw.status;
        });

        const tbody = document.getElementById('switches-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        if (devices.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No switches configured.</td></tr>`;
            return;
        }

        devices.forEach(dev => {
            const isOnline = dev.status === 'online';
            const statusClass = isOnline ? 'online' : 'offline';
            const statusLabel = isOnline ? 'ONLINE' : 'OFFLINE';
            const latencyStr = isOnline ? `${dev.latency} ms` : '-';
            
            const lastDownStr = dev.lastDown ? new Date(dev.lastDown).toLocaleTimeString() : '-';
            const lastUpStr = dev.lastUp ? new Date(dev.lastUp).toLocaleTimeString() : '-';

            tbody.innerHTML += `
                <tr>
                    <td><strong>${dev.name}</strong></td>
                    <td>${dev.ip}</td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            <span class="dot"></span> ${statusLabel}
                        </span>
                    </td>
                    <td>${latencyStr}</td>
                    <td style="font-size: 11px; color: var(--text-secondary);">${lastDownStr}</td>
                    <td style="font-size: 11px; color: var(--text-secondary);">${lastUpStr}</td>
                    <td class="text-right">
                        <button class="btn btn-secondary" onclick="deleteSwitch('${dev.id}')" style="padding: 4px 8px; font-size: 11px; border-color: #d1d5db;">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        console.error('Failed to fetch switches:', e);
    }
}

async function fetchSwitchesSla() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/switches/sla`);
        if (!response.ok) throw new Error();
        const logs = await response.json();
        
        const el = document.getElementById('switch-sla-logs');
        if (!el) return;
        el.innerHTML = '';
        
        if (logs.length === 0) {
            el.innerHTML = `<div class="text-muted text-center" style="font-size: 11px; padding: 20px;">No SLA events recorded.</div>`;
            return;
        }

        logs.forEach(log => {
            const isDown = log.type === 'down';
            const timeTag = log.formattedTime || new Date(log.timestamp).toLocaleTimeString();
            el.innerHTML += `
                <div class="log-item" style="border-left: 3px solid ${isDown ? '#111827' : '#9ca3af'}; padding: 8px; margin-bottom: 6px; background: #fafafa; border: 1px solid #e5e7eb; border-left-width: 3px; border-radius: 4px; display: flex; gap: 8px; font-size: 11px;">
                    <span class="log-time" style="color: var(--text-secondary); font-family: monospace;">[${timeTag}]</span>
                    <span class="log-message" style="color: #111827; font-weight: 500;">${log.message}</span>
                </div>
            `;
        });
    } catch (e) {
        console.error('Failed to fetch switch SLA logs:', e);
    }
}

async function addSwitch(name, ip) {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/switches`, {
            method: 'POST',
            body: JSON.stringify({ name, ip })
        });
        if (!response.ok) throw new Error();
        showToast('Switch connection added.');
        fetchSwitchesData();
    } catch (e) {
        showToast('Failed to add switch.');
    }
}

window.deleteSwitch = async function(id) {
    if (!confirm('Are you sure you want to remove this device?')) return;
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/switches/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error();
        showToast('Switch connection deleted.');
        fetchSwitchesData();
    } catch (e) {
        showToast('Failed to delete switch.');
    }
}

async function clearSwitchesSla() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/switches/sla/clear`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error();
        showToast('Switch SLA event logs cleared.');
        fetchSwitchesSla();
    } catch (e) {
        showToast('Failed to clear SLA logs.');
    }
}

async function fetchSettings() {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/settings`);
        if (!response.ok) throw new Error();
        const settings = await response.json();
        
        elSettingsDemoMode.checked = settings.demoMode;
        elSettingsApiUrl.value = settings.apiUrl;
        elSettingsTokenId.value = settings.tokenId;
        elSettingsTokenSecret.value = settings.tokenSecret;
        
        // Populate MikroTik configuration
        document.getElementById('settings-mikrotik-ip').value = settings.mikrotikIp || '';
        document.getElementById('settings-mikrotik-community').value = settings.mikrotikCommunity || '';
        document.getElementById('settings-mikrotik-port').value = settings.mikrotikPort || 161;
        
        toggleCredentialsFields(settings.demoMode);
    } catch (e) {
        addConsoleLog(`Failed to load settings: ${e.message}`, 'error');
    }
}

function toggleCredentialsFields(isDemo) {
    if (isDemo) {
        elSettingsCredentials.style.opacity = '0.4';
        elSettingsCredentials.style.pointerEvents = 'none';
        elSettingsApiUrl.required = false;
        elSettingsTokenId.required = false;
    } else {
        elSettingsCredentials.style.opacity = '1';
        elSettingsCredentials.style.pointerEvents = 'auto';
        elSettingsApiUrl.required = true;
        elSettingsTokenId.required = true;
    }
}

// --- Console Connection (VNC) Implementation ---

let terminalInputHandler = null;

window.openConsole = function(node, vmid, vmName, type) {
    addConsoleLog(`Opening console for ${vmName} (ID: ${vmid})...`, 'info');
    
    if (!demoModeActive) {
        // Production Mode: Open direct Proxmox VE Integrated noVNC Console or Host Shell
        if (!proxmoxWebUrl) {
            showToast('Proxmox IP address is empty or not set.');
            return;
        }
        
        let consoleUrl = '';
        if (vmid === 'node') {
            consoleUrl = `${proxmoxWebUrl}/?console=shell&novnc=1&node=${node}`;
            addConsoleLog(`Opening host node shell terminal for ${node} in a new tab.`, 'success');
        } else {
            const consoleType = type === 'qemu' ? 'kvm' : 'lxc';
            consoleUrl = `${proxmoxWebUrl}/?console=${consoleType}&novnc=1&vmid=${vmid}&node=${node}`;
            addConsoleLog(`Opening VNC console for ${vmName} (ID: ${vmid}) in a new tab.`, 'success');
        }
        
        window.open(consoleUrl, '_blank');
        return;
    }

    if (demoModeActive) {
        // Reset tabs to CLI first
        const tabs = document.querySelectorAll('.console-tab');
        tabs.forEach(t => {
            t.classList.remove('active');
            t.style.background = 'transparent';
            t.style.color = 'var(--text-secondary)';
        });
        const firstTab = document.querySelector('.console-tab[data-tab="cli"]');
        if (firstTab) {
            firstTab.classList.add('active');
            firstTab.style.background = '#111827';
            firstTab.style.color = '#ffffff';
        }
        document.getElementById('terminal-view-cli').style.display = 'flex';
        document.getElementById('terminal-view-vnc').style.display = 'none';

        // Setup desktop OS background based on VM name
        const vncBg = document.getElementById('vnc-desktop-bg');
        const vncTitle = document.getElementById('vnc-window-title');
        
        if (vmid === 'node') {
            vncBg.className = 'vnc-desktop-wrapper';
            vncBg.style.background = 'linear-gradient(135deg, #100b19 0%, #1a1525 100%)';
            vncTitle.innerHTML = `<i class="fa-solid fa-server"></i> Node Dashboard (${node})`;
        } else if (vmName.toLowerCase().includes('win')) {
            vncBg.className = 'vnc-desktop-wrapper win11';
            vncBg.style.background = 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)';
            vncTitle.innerHTML = `<i class="fa-brands fa-windows" style="color: #0078d4;"></i> Task Manager (Windows Server)`;
        } else {
            vncBg.className = 'vnc-desktop-wrapper';
            vncBg.style.background = 'linear-gradient(135deg, #7b2cbf 0%, #3c096c 100%)';
            vncTitle.innerHTML = `<i class="fa-brands fa-ubuntu" style="color: #E95420;"></i> System Monitor (Debian GNOME)`;
        }

        // Show mock window
        document.getElementById('vnc-app-window').style.display = 'flex';

        // Update initial mock VNC RAM & CPU stats
        const vmMem = vmid === 'node' ? currentNodeMemUsed : vmsFindMem(vmid);
        const vmMaxMem = vmid === 'node' ? currentNodeMemTotal : vmsFindMaxMem(vmid);
        document.getElementById('vnc-monitor-ram').textContent = `${formatBytes(vmMem, 2)} / ${formatBytes(vmMaxMem, 0)}`;
        const ramPercent = vmMaxMem > 0 ? Math.round((vmMem / vmMaxMem) * 100) : 40;
        document.getElementById('vnc-monitor-rambar').style.width = `${ramPercent}%`;

        // Start VNC dynamic clock and metrics loop
        if (vncIntervalId) clearInterval(vncIntervalId);
        
        vncIntervalId = setInterval(() => {
            // Update clock
            const now = new Date();
            document.getElementById('vnc-clock').textContent = now.toLocaleString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
            
            // Fluctuate CPU cores
            const cpu1 = Math.floor(10 + Math.random() * 40);
            const cpu2 = Math.floor(15 + Math.random() * 55);
            const elCpu1 = document.getElementById('vnc-monitor-cpu1');
            const elCpu2 = document.getElementById('vnc-monitor-cpu2');
            if (elCpu1) elCpu1.textContent = `${cpu1}%`;
            if (elCpu2) elCpu2.textContent = `${cpu2}%`;
            
            // Fluctuate RAM slightly
            const flucMem = Math.max(vmMem * 0.9, Math.min(vmMaxMem * 0.95, vmMem + (Math.random() - 0.5) * 50 * 1024 * 1024));
            const elRam = document.getElementById('vnc-monitor-ram');
            const elRamBar = document.getElementById('vnc-monitor-rambar');
            if (elRam) elRam.textContent = `${formatBytes(flucMem, 2)} / ${formatBytes(vmMaxMem, 0)}`;
            if (elRamBar) {
                const flucPct = vmMaxMem > 0 ? Math.round((flucMem / vmMaxMem) * 100) : 45;
                elRamBar.style.width = `${flucPct}%`;
            }
        }, 2000);

        // Open simulated Web Terminal inside Dashboard
        elTerminalTitle.textContent = vmid === 'node' ? `[SHELL - NODE ${node}] Host Shell` : `[${type.toUpperCase()} - VM ${vmid}] ${vmName}`;
        elTerminalPrompt.textContent = vmid === 'node' ? `root@${node}:~# ` : `root@${vmName}:~# `;
        
        const logName = vmid === 'node' ? node : vmName;
        elTerminalBody.innerHTML = `
<span style="color: #00F2FE;">[INFO] Connecting to ${logName} console tty1 via simulated Proxmox VNC...</span>
<span style="color: #10b981;">[OK] WebSocket handshakes completed successfully.</span>
<span style="color: #f59e0b;">[WARN] System loading complete. Automatically logging in...</span>

Debian GNU/Linux 12 ${logName} tty1
${logName} login: root (automatic login)
Last login: ${new Date().toLocaleString()} on tty1

Welcome to Proxmox VE Web Console Terminal!
Running in simulation (demo) mode.

Ketik '<span style="color: #00F2FE;">help</span>' untuk daftar perintah, '<span style="color: #00F2FE;">neofetch</span>' untuk spek, atau '<span style="color: #FF5E62;">exit</span>' untuk menutup.
`;
        elTerminalModal.classList.add('active');
        elTerminalInput.value = '';
        elTerminalInput.focus();
        
        // Remove previous listeners if any
        if (terminalInputHandler) {
            elTerminalInput.removeEventListener('keydown', terminalInputHandler);
        }
        
        // Setup typing events inside terminal input
        terminalInputHandler = function(e) {
            if (e.key === 'Enter') {
                const cmd = elTerminalInput.value.trim().toLowerCase();
                elTerminalInput.value = '';
                
                if (cmd === '') return;
                
                // Print command
                const promptUser = vmid === 'node' ? `root@${node}:~# ` : `root@${vmName}:~# `;
                elTerminalBody.innerHTML += `\n${promptUser}${cmd}`;
                
                if (cmd === 'clear') {
                    elTerminalBody.innerHTML = 'Terminal cleared. Type help for list of commands.\n';
                } else if (cmd === 'exit' || cmd === 'logout') {
                    hideTerminalModal();
                } else if (cmd === 'help') {
                    elTerminalBody.innerHTML += `
Perintah tersedia:
  - <span style="color: #00F2FE;">help</span>      : Menampilkan menu bantuan ini
  - <span style="color: #00F2FE;">neofetch</span>  : Informasi spesifikasi sistem
  - <span style="color: #00F2FE;">ls</span>        : Menampilkan berkas direktori lokal
  - <span style="color: #00F2FE;">df -h</span>     : Informasi kapasitas penyimpanan disk
  - <span style="color: #00F2FE;">uptime</span>    : Menampilkan durasi hidup sistem
  - <span style="color: #00F2FE;">clear</span>     : Membersihkan layar terminal
  - <span style="color: #FF5E62;">exit</span>      : Keluar dari console`;
                } else if (cmd === 'neofetch') {
                    if (vmid === 'node') {
                        elTerminalBody.innerHTML += `
   <span style="color: #b15eff;">_,met$$$$$gg.</span>      <span style="color: var(--color-teal); font-weight: bold;">root@${node}</span>
  <span style="color: #b15eff;">,g$$$$$$$$$$$$$$$P.</span>    ------------------
 ,g$$P"     """Y$$.".    OS: Proxmox Virtual Environment (PVE)
 ,g$$P'          "$$$.     Kernel: ${currentNodeKversion}
'$$P            "$$$     Uptime: ${formatUptime(currentNodeUptime)}
 $$P             $$$     Shell: bash 5.2.15
 $$P             $$$     CPU: ${currentNodeCpuModel} (${currentNodeCpus} Cores)
 $$P             $$$     Memory: ${formatBytes(currentNodeMemUsed)} / ${formatBytes(currentNodeMemTotal)}
 Y$$$.           $$$     Host: Physical Hypervisor Node
  <span style="color: #b15eff;">Y$$$$$.       _.$$$</span>     Theme: Glassmorphism Dark Neon
   <span style="color: #b15eff;">'Y$$$$$$$$$$$$$$P'</span>
     <span style="color: #b15eff;">'"Y$$$$$$$$P"'</span>`;
                    } else {
                        elTerminalBody.innerHTML += `
   <span style="color: #b15eff;">_,met$$$$$gg.</span>      <span style="color: var(--color-teal); font-weight: bold;">root@${vmName}</span>
  <span style="color: #b15eff;">,g$$$$$$$$$$$$$$$P.</span>    ------------------
 ,g$$P"     """Y$$.".    OS: Debian GNU/Linux 12 (bookworm) x86_64
 ,g$$P'          "$$$.     Kernel: Linux 6.1.0-10-amd64
'$$P            "$$$     Uptime: ${formatUptime(vmsFindUptime(vmid))}
 $$P             $$$     Shell: bash 5.2.15
 $$P             $$$     CPU: QEMU Virtual CPU (2 Cores)
 $$P             $$$     Memory: ${formatBytes(vmsFindMem(vmid))} / ${formatBytes(vmsFindMaxMem(vmid))}
 Y$$$.           $$$     Host: Proxmox Virtualization Node
  <span style="color: #b15eff;">Y$$$$$.       _.$$$</span>     Theme: Glassmorphism Dark Neon
   <span style="color: #b15eff;">'Y$$$$$$$$$$$$$$P'</span>
     <span style="color: #b15eff;">'"Y$$$$$$$$P"'</span>`;
                    }
                } else if (cmd === 'ls') {
                    elTerminalBody.innerHTML += `\nbin/  boot/  dev/  etc/  home/  lib/  media/  mnt/  opt/  proc/  root/  run/  srv/  sys/  var/  www/`;
                } else if (cmd === 'df -h') {
                    elTerminalBody.innerHTML += `
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        40G  4.2G   34G  11% /
udev            2.0G     0  2.0G   0% /dev
tmpfs           396M  1.1M  395M   1% /run`;
                } else if (cmd === 'uptime') {
                    const uptimeVal = vmid === 'node' ? currentNodeUptime : vmsFindUptime(vmid);
                    elTerminalBody.innerHTML += `\n uptime: ${formatUptime(uptimeVal)} &mdash; Users logged: 1 &mdash; Load avg: 0.12, 0.08, 0.05`;
                } else {
                    elTerminalBody.innerHTML += `\nbash: command not found: ${cmd}`;
                }
                
                elTerminalBody.scrollTop = elTerminalBody.scrollHeight;
            }
        };
        elTerminalInput.addEventListener('keydown', terminalInputHandler);
    }
};

function hideTerminalModal() {
    elTerminalModal.classList.remove('active');
    if (terminalInputHandler) {
        elTerminalInput.removeEventListener('keydown', terminalInputHandler);
        terminalInputHandler = null;
    }
    if (vncIntervalId) {
        clearInterval(vncIntervalId);
        vncIntervalId = null;
    }
}

// VM properties lookups for neofetch mockup output
function vmsFindUptime(vmid) {
    const vm = currentVms.find(v => v.vmid === vmid);
    return vm ? vm.uptime : 0;
}
function vmsFindMem(vmid) {
    const vm = currentVms.find(v => v.vmid === vmid);
    return vm ? vm.mem : 2147483648;
}
function vmsFindMaxMem(vmid) {
    const vm = currentVms.find(v => v.vmid === vmid);
    return vm ? vm.maxmem : 4294967298;
}

// --- Event Handlers & Control Triggers ---

async function executeVmAction(node, vmid, action) {
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/vm/${node}/${vmid}/status/${action}`, {
            method: 'POST'
        });
        
        if (!response.ok) throw new Error();
        
        addConsoleLog(`Successfully sent command '${action.toUpperCase()}' for VM ${vmid}`, 'success');
        showToast(`Action '${action}' successfully sent for VM ${vmid}`);
        
        fetchResources();
        fetchTasksHistory();
    } catch (e) {
        addConsoleLog(`Failed to execute '${action}' for VM ${vmid}`, 'error');
        showToast(`Failed to execute action on VM ${vmid}`);
    }
}

window.confirmAction = function(node, vmid, action, vmName) {
    pendingAction = { node, vmid, action, vmName };
    let verb = 'start';
    if (action === 'shutdown') verb = 'shutdown (graceful)';
    if (action === 'stop') verb = 'stop (force stop)';
    if (action === 'reboot') verb = 'reboot';
    
    elConfirmModalText.innerHTML = `Are you sure you want to <strong>${verb}</strong> VM <strong>${vmName} (ID: ${vmid})</strong> on node <strong>${node}</strong>?`;
    elConfirmModal.classList.add('active');
};

function hideModal() {
    elConfirmModal.classList.remove('active');
    pendingAction = null;
}

// --- Action Listeners ---

elBtnConfirmExecute.addEventListener('click', () => {
    if (pendingAction) {
        const { node, vmid, action, type } = pendingAction;
        if (type === 'node') {
            executeNodeAction(node, action);
        } else {
            executeVmAction(node, vmid, action);
        }
        hideModal();
    }
});

elBtnConfirmCancel.addEventListener('click', hideModal);
elBtnCloseModal.addEventListener('click', hideModal);

elBtnCloseTerminalModal.addEventListener('click', hideTerminalModal);
window.addEventListener('click', (e) => {
    if (e.target === elTerminalModal) hideTerminalModal();
});

elVmSearch.addEventListener('input', () => renderVmTable(currentVms));
elVmStatusFilter.addEventListener('change', () => renderVmTable(currentVms));

elSettingsDemoMode.addEventListener('change', (e) => {
    toggleCredentialsFields(e.target.checked);
});

elSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const settings = {
        demoMode: elSettingsDemoMode.checked,
        apiUrl: elSettingsApiUrl.value,
        tokenId: elSettingsTokenId.value,
        tokenSecret: elSettingsTokenSecret.value,
        mikrotikIp: document.getElementById('settings-mikrotik-ip').value,
        mikrotikCommunity: document.getElementById('settings-mikrotik-community').value,
        mikrotikPort: parseInt(document.getElementById('settings-mikrotik-port').value) || 161
    };
    
    addConsoleLog('Saving new settings to backend...', 'info');
    
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/settings`, {
            method: 'POST',
            body: JSON.stringify(settings)
        });
        
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Server error');
        
        addConsoleLog('New configuration successfully saved!', 'success');
        showToast('Configuration successfully saved!');
        
        const online = await checkBackendStatus();
        if (online) {
            triggerRouteUpdate(currentActiveRoute);
        }
    } catch (err) {
        addConsoleLog(`Failed to save configuration: ${err.message}`, 'error');
        showAlert(`Failed to connect to Proxmox: ${err.message}`);
        showToast('Configuration save failed!');
    }
});

elBtnManualRefresh.addEventListener('click', async () => {
    elBtnManualRefresh.disabled = true;
    elBtnManualRefresh.querySelector('i').classList.add('fa-spin');
    
    addConsoleLog(`Refreshing page data for ${currentActiveRoute.toUpperCase()}...`, 'info');
    
    const online = await checkBackendStatus();
    if (online) {
        triggerRouteUpdate(currentActiveRoute);
    }
    
    setTimeout(() => {
        elBtnManualRefresh.disabled = false;
        elBtnManualRefresh.querySelector('i').classList.remove('fa-spin');
    }, 700);
});

elBtnClearLogs.addEventListener('click', () => {
    const activeTab = document.querySelector('.log-tab.active').getAttribute('data-tab');
    if (activeTab === 'system') {
        elConsoleLogs.innerHTML = '';
        addConsoleLog('System history logs cleared.', 'info');
    } else if (activeTab === 'sla') {
        slaAlerts = [];
        renderSlaAlerts();
        showToast('SLA alarm history cleared.');
    } else {
        showToast('Only System Logs and SLA Alerts can be cleared manually.');
    }
});

// --- Host Node Shell & Power Actions Binding ---
const elBtnNodeShell = document.getElementById('btn-node-shell');
const elBtnNodePower = document.getElementById('btn-node-power');
const elNodePowerDropdown = document.getElementById('node-power-dropdown');

if (elBtnNodeShell) {
    elBtnNodeShell.addEventListener('click', () => {
        openConsole(currentNodeName, 'node', 'Host Shell', 'shell');
    });
}

if (elBtnNodePower && elNodePowerDropdown) {
    elBtnNodePower.addEventListener('click', (e) => {
        e.stopPropagation();
        const show = elNodePowerDropdown.style.display === 'block';
        elNodePowerDropdown.style.display = show ? 'none' : 'block';
    });
    document.addEventListener('click', () => {
        elNodePowerDropdown.style.display = 'none';
    });
}

window.confirmNodeAction = function(action) {
    pendingAction = { node: currentNodeName, action, type: 'node' };
    let verb = 'reboot';
    if (action === 'shutdown') verb = 'shutdown';
    
    elConfirmModalText.innerHTML = `Are you sure you want to <strong>${verb}</strong> Proxmox Host <strong>${currentNodeName}</strong>?<br><br><span style="color: #111827; font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> WARNING: This action will power down all running virtual machines and containers!</span>`;
    elConfirmModal.classList.add('active');
};

async function executeNodeAction(node, action) {
    addConsoleLog(`Sending ${action.toUpperCase()} command to host node ${node}...`, 'info');
    try {
        const response = await authenticatedFetch(`${BACKEND_URL}/api/node/${node}/status/${action}`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error();
        const result = await response.json();
        showToast(`Host ${action} command successfully sent!`);
        addConsoleLog(`Host ${node} is performing ${action}...`, 'success');
    } catch (error) {
        showToast(`Failed to execute ${action} command on host.`);
        addConsoleLog(`Host ${action} command failed: ${error.message}`, 'error');
    }
}

// --- Main Event Loop ---

function setupPoller() {
    if (pollerId) clearInterval(pollerId);
    if (switchesPollerId) clearInterval(switchesPollerId);
    if (!authToken) return; // Stop polling if not logged in
    
    pollerId = setInterval(async () => {
        if (!authToken) return;
        const online = await checkBackendStatus();
        if (online) {
            fetchNodeStatus();
            fetchResources();
            
            if (currentActiveRoute === 'dashboard') {
                fetchTasksHistory();
            } else if (currentActiveRoute === 'nodes') {
                fetchNodesList();
            } else if (currentActiveRoute === 'storage') {
                fetchStorageStatus();
            } else if (currentActiveRoute === 'backups') {
                fetchBackupsData();
            } else if (currentActiveRoute === 'network') {
                fetchNetworkInterfaces();
            } else if (currentActiveRoute === 'mikrotik') {
                fetchMikrotikStats();
            }
        }
    }, POLL_INTERVAL);

    // Fast realtime switches poller (every 1 second)
    switchesPollerId = setInterval(async () => {
        if (!authToken) return;
        if (currentActiveRoute === 'switches') {
            const online = await checkBackendStatus();
            if (online) {
                fetchSwitchesData();
                fetchSwitchesSla();
            }
        }
    }, 1000);
}

// --- App Startup ---

async function startApp() {
    initCharts();
    initLogTabs();
    initConsoleTabs();
    
    // Login form submissions
    elLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = elLoginForm.querySelector('#login-username').value;
        const password = elLoginForm.querySelector('#login-password').value;
        elLoginErrorMsg.style.display = 'none';
        
        try {
            const response = await fetch(`${BACKEND_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Login failed.');
            
            authToken = data.token;
            localStorage.setItem('pve_dashboard_token', data.token);
            elLoginOverlay.style.display = 'none';
            showToast('Login successful! Welcome back.');
            
            triggerRouteUpdate(currentActiveRoute);
            setupPoller();
        } catch (err) {
            elLoginErrorMsg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${err.message || 'Invalid username or password!'}`;
            elLoginErrorMsg.style.display = 'block';
        }
    });

    // Logout trigger
    document.getElementById('btn-logout').addEventListener('click', () => {
        authToken = '';
        localStorage.removeItem('pve_dashboard_token');
        elLoginOverlay.style.display = 'flex';
        showToast('You have successfully logged out.');
        if (pollerId) clearInterval(pollerId);
        if (switchesPollerId) clearInterval(switchesPollerId);
    });

    // Add Switch Form submissions
    const addSwitchForm = document.getElementById('add-switch-form');
    if (addSwitchForm) {
        addSwitchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('switch-name').value;
            const ip = document.getElementById('switch-ip').value;
            addSwitch(name, ip);
            addSwitchForm.reset();
        });
    }

    // Clear Switch SLA Logs
    const btnClearSwitchLogs = document.getElementById('btn-clear-switch-logs');
    if (btnClearSwitchLogs) {
        btnClearSwitchLogs.addEventListener('click', () => {
            clearSwitchesSla();
        });
    }

    // Check if token exists
    if (!authToken) {
        elLoginOverlay.style.display = 'flex';
    } else {
        elLoginOverlay.style.display = 'none';
        triggerRouteUpdate(currentActiveRoute);
        setupPoller();
    }
    
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
}

document.addEventListener('DOMContentLoaded', startApp);
