const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5005;

app.use(cors());
app.use(express.json());

// Set TLS rejection to 0 for self-signed certificates
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const https = require('https');
  axios.defaults.httpsAgent = new https.Agent({
    rejectUnauthorized: false
  });
}

// Generate random session token on server start
const crypto = require('crypto');
let sessionToken = crypto.randomBytes(32).toString('hex');

// Authentication Token Validator Middleware
const authenticateToken = (req, res, next) => {
  // Allow checking status and logging in without token
  if (req.path === '/api/status' || req.path === '/api/login') {
    return next();
  }
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Expecting format: Bearer <token>
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Harap login terlebih dahulu.' });
  }
  
  if (token !== sessionToken) {
    return res.status(401).json({ error: 'Unauthorized: Sesi tidak valid atau telah kedaluwarsa.' });
  }
  
  next();
};

app.use(authenticateToken);

// Global Config Object loaded from environment variables
let config = {
  demoMode: process.env.DEMO_MODE !== 'false',
  apiUrl: process.env.PROXMOX_API_URL || 'https://YOUR_PROXMOX_IP:8006/api2/json',
  tokenId: process.env.PROXMOX_TOKEN_ID || 'root@pam!dashboard',
  tokenSecret: process.env.PROXMOX_TOKEN_SECRET || '',
  dashboardUsername: process.env.DASHBOARD_USERNAME || 'admin',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin123'
};

// Helper for Proxmox API Requests using dynamic config values
const proxmoxRequest = async (method, apiPath, data = null) => {
  const url = `${config.apiUrl}${apiPath}`;
  const headers = {
    'Authorization': `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`
  };

  try {
    const response = await axios({
      method,
      url,
      headers,
      data
    });
    return response.data;
  } catch (error) {
    console.error(`Proxmox API Error (${method} ${apiPath}):`, error.response ? error.response.data : error.message);
    throw error;
  }
};

// Function to save configurations to .env file dynamically
const saveEnvConfig = (newConfig) => {
  const envPath = path.join(__dirname, '.env');
  const envContent = `# Server Port
PORT=${PORT}

# Proxmox VE Configuration
DEMO_MODE=${newConfig.demoMode}
PROXMOX_API_URL=${newConfig.apiUrl}
PROXMOX_TOKEN_ID=${newConfig.tokenId}
PROXMOX_TOKEN_SECRET=${newConfig.tokenSecret}

# Abaikan verifikasi SSL self-signed Proxmox (0 = abaikan, 1 = wajib valid)
NODE_TLS_REJECT_UNAUTHORIZED=0

# Kredensial Login Dashboard Website
DASHBOARD_USERNAME=${config.dashboardUsername}
DASHBOARD_PASSWORD=${config.dashboardPassword}
`;
  fs.writeFileSync(envPath, envContent, 'utf8');
};

// --- SIMULATED DATA GENERATOR (DEMO MODE) ---
let demoNetworkRxHistory = Array.from({ length: 20 }, () => Math.floor(50 + Math.random() * 50));
let demoNetworkTxHistory = Array.from({ length: 20 }, () => Math.floor(20 + Math.random() * 30));
let demoVms = [
  { vmid: 101, name: 'web-server-01', status: 'running', type: 'qemu', node: 'pve-node-01', cpu: 0.12, mem: 4294967296 * 0.45, maxmem: 4294967296, netin: 1542849021, netout: 954832049, uptime: 1065600 },
  { vmid: 102, name: 'db-master-02', status: 'running', type: 'qemu', node: 'pve-node-01', cpu: 0.35, mem: 17179869184 * 0.68, maxmem: 17179869184, netin: 8542981023, netout: 23149801200, uptime: 691200 },
  { vmid: 103, name: 'mail-mx-01', status: 'stopped', type: 'qemu', node: 'pve-node-01', cpu: 0, mem: 0, maxmem: 2147483648, netin: 0, netout: 0, uptime: 0 },
  { vmid: 201, name: 'app-engine-03', status: 'running', type: 'lxc', node: 'pve-node-01', cpu: 0.08, mem: 2147483648 * 0.32, maxmem: 2147483648, netin: 542019482, netout: 124802910, uptime: 86400 },
  { vmid: 301, name: 'plex-media', status: 'running', type: 'qemu', node: 'pve-node-01', cpu: 0.22, mem: 8589934592 * 0.74, maxmem: 8589934592, netin: 95840291000, netout: 3482019400, uptime: 1296000 }
];

const getMockNodeStatus = () => {
  const cpu = 0.2 + Math.random() * 0.5; // 20% to 70%
  const memUsed = 52.4 + Math.random() * 5.0; // 52.4GB to 57.4GB
  const maxMem = 80; // 80GB
  const diskUsed = 1.89; // 1.89TB
  const maxDisk = 3.0; // 3TB

  const rx = Math.floor(80 + Math.random() * 60);
  const tx = Math.floor(40 + Math.random() * 40);

  demoNetworkRxHistory.push(rx);
  demoNetworkTxHistory.push(tx);
  if (demoNetworkRxHistory.length > 20) {
    demoNetworkRxHistory.shift();
    demoNetworkTxHistory.shift();
  }

  // Fluctuate VM statistics
  demoVms = demoVms.map(vm => {
    if (vm.status === 'running') {
      const cpuChange = (Math.random() - 0.5) * 0.08;
      const memChange = (Math.random() - 0.5) * (vm.maxmem * 0.03);
      const netinChange = Math.floor(Math.random() * 2 * 1024 * 1024);
      const netoutChange = Math.floor(Math.random() * 1 * 1024 * 1024);
      return {
        ...vm,
        cpu: Math.max(0.01, Math.min(0.95, vm.cpu + cpuChange)),
        mem: Math.max(vm.maxmem * 0.1, Math.min(vm.maxmem * 0.9, vm.mem + memChange)),
        netin: vm.netin + netinChange,
        netout: vm.netout + netoutChange,
        uptime: vm.uptime + 5
      };
    }
    return vm;
  });

  return {
    node: 'pve-node-01',
    status: 'online',
    uptime: 1857600,
    cpu: cpu,
    memory: {
      used: memUsed * 1024 * 1024 * 1024,
      total: maxMem * 1024 * 1024 * 1024
    },
    disk: {
      used: diskUsed * 1024 * 1024 * 1024 * 1024,
      total: maxDisk * 1024 * 1024 * 1024 * 1024
    },
    network: {
      rx,
      tx,
      rxHistory: demoNetworkRxHistory,
      txHistory: demoNetworkTxHistory
    },
    pveVersion: 'Proxmox VE 8.1.4',
    kversion: 'Linux 6.5.11-7-pve #1 SMP PREEMPT_DYNAMIC PVE 6.5.11-7 (2023-12-05T13:30Z)',
    // Detailed stats for completeness
    cpuinfo: {
      model: 'AMD Ryzen 9 5900X (12-Core, 24-Threads)',
      cpus: 24
    },
    loadavg: [
      (0.3 + Math.random() * 0.5).toFixed(2),
      (0.2 + Math.random() * 0.4).toFixed(2),
      (0.2 + Math.random() * 0.3).toFixed(2)
    ],
    iowait: (0.2 + Math.random() * 2.0).toFixed(2)
  };
};

// --- API ENDPOINTS ---

// Check API Status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    mode: config.demoMode ? 'demo' : 'production',
    message: config.demoMode ? 'Backend running in Demo (Simulation) Mode' : 'Backend connected to Proxmox VE API',
    proxmoxWebUrl: config.apiUrl.replace('/api2/json', '')
  });
});

// Auth Login API
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === config.dashboardUsername && password === config.dashboardPassword) {
    return res.json({
      success: true,
      token: sessionToken,
      message: 'Login sukses! Membuka dashboard...'
    });
  }
  
  return res.status(401).json({
    success: false,
    error: 'Username atau password salah!'
  });
});

// Get Active Settings configuration
app.get('/api/settings', (req, res) => {
  res.json({
    demoMode: config.demoMode,
    apiUrl: config.apiUrl,
    tokenId: config.tokenId,
    tokenSecret: config.tokenSecret ? '••••••••••••••••' : ''
  });
});

// Update Settings dynamically from the frontend
app.post('/api/settings', async (req, res) => {
  const { demoMode, apiUrl, tokenId, tokenSecret } = req.body;
  const originalConfig = { ...config };

  config.demoMode = demoMode === true;
  if (apiUrl) config.apiUrl = apiUrl;
  if (tokenId) config.tokenId = tokenId;
  
  if (tokenSecret && tokenSecret !== '••••••••••••••••') {
    config.tokenSecret = tokenSecret;
  }

  if (!config.demoMode) {
    try {
      await proxmoxRequest('GET', '/version');
    } catch (e) {
      config = originalConfig;
      return res.status(400).json({ 
        success: false, 
        error: 'Koneksi ke Proxmox gagal! Harap periksa URL API dan Token Anda.', 
        details: e.message 
      });
    }
  }

  try {
    saveEnvConfig(config);
    res.json({ 
      success: true, 
      message: config.demoMode 
        ? 'Pengaturan disimpan. Server sekarang berada dalam DEMO MODE.' 
        : 'Pengaturan disimpan. Sukses terhubung ke server Proxmox VE!' 
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Gagal menulis file konfigurasi (.env)', details: e.message });
  }
});

// Get Node summary status
app.get('/api/node-status', async (req, res) => {
  if (config.demoMode) {
    return res.json(getMockNodeStatus());
  }

  try {
    const nodesResponse = await proxmoxRequest('GET', '/nodes');
    const nodes = nodesResponse.data;
    
    if (!nodes || nodes.length === 0) {
      return res.status(404).json({ error: 'No Proxmox nodes found' });
    }

    const targetNode = nodes[0].node;
    const statusResponse = await proxmoxRequest('GET', `/nodes/${targetNode}/status`);
    const status = statusResponse.data;
    const versionResponse = await proxmoxRequest('GET', '/version');
    const pveVersion = versionResponse.data.version || 'Proxmox VE';

    res.json({
      node: targetNode,
      status: nodes[0].status,
      uptime: status.uptime,
      cpu: status.cpu,
      memory: {
        used: status.memory.used,
        total: status.memory.total
      },
      disk: {
        used: status.rootfs.used,
        total: status.rootfs.total
      },
      network: {
        rx: Math.floor(Math.random() * 50 + 20),
        tx: Math.floor(Math.random() * 20 + 10)
      },
      pveVersion: `${pveVersion}`,
      kversion: status.kversion || 'Linux Kernel',
      cpuinfo: {
        model: status.cpuinfo.model || 'Unknown CPU',
        cpus: status.cpuinfo.cpus || 1
      },
      loadavg: status.loadavg || [0, 0, 0],
      iowait: (status.wait * 100).toFixed(2) || '0.00'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Proxmox Node Status', details: error.message });
  }
});

// Get detailed list of all nodes in cluster
app.get('/api/nodes-list', async (req, res) => {
  if (config.demoMode) {
    return res.json([
      { node: 'pve-node-01', status: 'online', cpu: 0.34, mem: 56.2 * 1024 * 1024 * 1024, maxmem: 80 * 1024 * 1024 * 1024, uptime: 1857600, level: 'master' },
      { node: 'pve-node-02', status: 'offline', cpu: 0, mem: 0, maxmem: 64 * 1024 * 1024 * 1024, uptime: 0, level: 'backup' }
    ]);
  }

  try {
    const nodesResponse = await proxmoxRequest('GET', '/nodes');
    res.json(nodesResponse.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Proxmox nodes list', details: error.message });
  }
});

// Get VMs and Container resources
app.get('/api/resources', async (req, res) => {
  if (config.demoMode) {
    return res.json(demoVms);
  }
  try {
    const resourcesResponse = await proxmoxRequest('GET', '/cluster/resources');
    const resources = resourcesResponse.data.filter(r => r.type === 'qemu' || r.type === 'lxc');

    const formattedResources = resources.map(res => ({
      vmid: res.vmid,
      name: res.name || `VM ${res.vmid}`,
      status: res.status || 'stopped',
      type: res.type === 'qemu' ? 'qemu' : 'lxc',
      node: res.node,
      cpu: res.cpu || 0,
      mem: res.mem || 0,
      maxmem: res.maxmem || 0,
      netin: res.netin || 0,
      netout: res.netout || 0,
      uptime: res.uptime || 0
    }));

    res.json(formattedResources);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Proxmox Resources', details: error.message });
  }
});

// Get Storage Pools status
app.get('/api/storage', async (req, res) => {
  if (config.demoMode) {
    return res.json([
      { storage: 'local', type: 'dir', content: 'iso,vztmpl,backup', size: 100 * 1024 * 1024 * 1024, used: 42 * 1024 * 1024 * 1024, active: 1, shared: 0 },
      { storage: 'local-lvm', type: 'lvmthin', content: 'images,rootdir', size: 800 * 1024 * 1024 * 1024, used: 512 * 1024 * 1024 * 1024, active: 1, shared: 0 },
      { storage: 'backup-nas', type: 'nfs', content: 'backup', size: 2048 * 1024 * 1024 * 1024, used: 1120 * 1024 * 1024 * 1024, active: 1, shared: 1 }
    ]);
  }

  try {
    const response = await proxmoxRequest('GET', '/cluster/resources?type=storage');
    const storages = response.data;
    
    const formattedStorages = storages.map(st => ({
      storage: st.storage,
      type: st.plugintype || 'unknown',
      content: st.content || '-',
      size: st.maxdisk || 0,
      used: st.disk || 0,
      active: st.active || 0,
      shared: st.shared || 0
    }));

    res.json(formattedStorages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Proxmox Storage status', details: error.message });
  }
});

// Get Backup configurations and events
app.get('/api/backups', async (req, res) => {
  if (config.demoMode) {
    return res.json({
      schedules: [
        { id: 'backup-weekly', schedule: 'Sun 02:00', vms: 'All', storage: 'backup-nas', enabled: 1 }
      ],
      history: [
        { file: 'vzdump-qemu-101-2026_07_12.vma.zst', vmid: 101, date: '2026-07-12 02:15:30', size: 4.2 * 1024 * 1024 * 1024, status: 'OK' },
        { file: 'vzdump-lxc-201-2026_07_12.tar.zst', vmid: 201, date: '2026-07-12 02:02:10', size: 850 * 1024 * 1024, status: 'OK' }
      ]
    });
  }

  try {
    const schedules = await proxmoxRequest('GET', '/cluster/backup');
    res.json({
      schedules: schedules.data,
      history: [
        { file: 'Laporan backup otomatis terintegrasi Proxmox', vmid: 'N/A', date: new Date().toLocaleDateString(), size: 0, status: 'OK' }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch backup configurations', details: error.message });
  }
});

// Get Network Interfaces info
app.get('/api/network-interfaces', async (req, res) => {
  if (config.demoMode) {
    return res.json([
      { iface: 'vmbr0', type: 'bridge', address: '192.168.1.100', netmask: '255.255.255.0', active: 1, comments: 'LAN Bridge Interface' },
      { iface: 'eno1', type: 'eth', address: '-', netmask: '-', active: 1, comments: 'Intel Physical NIC 1' },
      { iface: 'eno2', type: 'eth', address: '-', netmask: '-', active: 0, comments: 'Intel Physical NIC 2' }
    ]);
  }

  try {
    const nodesResponse = await proxmoxRequest('GET', '/nodes');
    const targetNode = nodesResponse.data[0].node;
    const response = await proxmoxRequest('GET', `/nodes/${targetNode}/network`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch network interfaces status', details: error.message });
  }
});

// Get Proxmox Cluster/Node Tasks History
app.get('/api/tasks', async (req, res) => {
  if (config.demoMode) {
    return res.json([
      { upid: 'UPID:pve-node-01:0001A8BE:004D2E5C:66F12C3A:vzdump:101:root@pam:', node: 'pve-node-01', user: 'root@pam', type: 'vzdump', status: 'OK', starttime: Math.floor(Date.now()/1000 - 3600), endtime: Math.floor(Date.now()/1000 - 3500) },
      { upid: 'UPID:pve-node-01:000187CD:004B2F5B:66F12C3A:qmstart:102:root@pam:', node: 'pve-node-01', user: 'root@pam', type: 'qmstart', status: 'OK', starttime: Math.floor(Date.now()/1000 - 7200), endtime: Math.floor(Date.now()/1000 - 7180) },
      { upid: 'UPID:pve-node-01:000175BD:00492E5B:66F12C3A:qmreboot:301:root@pam:', node: 'pve-node-01', user: 'root@pam', type: 'qmreboot', status: 'OK', starttime: Math.floor(Date.now()/1000 - 10800), endtime: Math.floor(Date.now()/1000 - 10750) },
      { upid: 'UPID:pve-node-01:000155AD:00452E5B:66F12C3A:aptget::root@pam:', node: 'pve-node-01', user: 'root@pam', type: 'aptupdate', status: 'OK', starttime: Math.floor(Date.now()/1000 - 86400), endtime: Math.floor(Date.now()/1000 - 86300) }
    ]);
  }

  try {
    const nodesResponse = await proxmoxRequest('GET', '/nodes');
    if (!nodesResponse.data || nodesResponse.data.length === 0) {
      return res.json([]);
    }
    const targetNode = nodesResponse.data[0].node;
    const response = await proxmoxRequest('GET', `/nodes/${targetNode}/tasks?limit=15`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Proxmox tasks log', details: error.message });
  }
});

// Control VM (Start/Stop/Reboot)
app.post('/api/vm/:node/:vmid/status/:action', async (req, res) => {
  const { node, vmid, action } = req.params;
  const validActions = ['start', 'stop', 'shutdown', 'reboot'];

  if (!validActions.includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be start, stop, shutdown, or reboot' });
  }

  if (config.demoMode) {
    const vmIndex = demoVms.findIndex(v => v.vmid === parseInt(vmid));
    if (vmIndex === -1) {
      return res.status(404).json({ error: 'VM not found' });
    }

    if (action === 'start') {
      demoVms[vmIndex].status = 'running';
      demoVms[vmIndex].uptime = 10;
    } else if (action === 'stop' || action === 'shutdown') {
      demoVms[vmIndex].status = 'stopped';
      demoVms[vmIndex].cpu = 0;
      demoVms[vmIndex].mem = 0;
      demoVms[vmIndex].uptime = 0;
    } else if (action === 'reboot') {
      demoVms[vmIndex].status = 'running';
      demoVms[vmIndex].uptime = 5;
    }

    return res.json({ success: true, message: `[DEMO] VM ${vmid} action '${action}' triggered successfully.` });
  }

  try {
    const resourcesResponse = await proxmoxRequest('GET', '/cluster/resources?type=vm');
    const targetResource = resourcesResponse.data.find(r => r.vmid === parseInt(vmid));

    if (!targetResource) {
      return res.status(404).json({ error: `VM/CT with ID ${vmid} not found on node ${node}` });
    }

    const type = targetResource.type;
    const path = `/nodes/${node}/${type}/${vmid}/status/${action}`;
    const result = await proxmoxRequest('POST', path);

    res.json({ success: true, details: result.data });
  } catch (error) {
    res.status(500).json({ error: `Failed to trigger action '${action}' on VM ${vmid}`, details: error.message });
  }
});

// Control Node (Reboot/Shutdown Host)
app.post('/api/node/:node/status/:action', async (req, res) => {
  const { node, action } = req.params;
  const validActions = ['reboot', 'shutdown'];

  if (!validActions.includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be reboot or shutdown' });
  }

  if (config.demoMode) {
    return res.json({ success: true, message: `Node ${node} is performing ${action} (Simulated)` });
  }

  try {
    const response = await proxmoxRequest('POST', `/nodes/${node}/status`, { command: action });
    res.json({ success: true, message: `Node ${node} ${action} command sent successfully.`, details: response.data });
  } catch (error) {
    res.status(500).json({ error: `Failed to execute node command ${action}`, details: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` Proxmox Dashboard Backend Server `);
  console.log(` Running on: http://localhost:${PORT} `);
  console.log(` Mode: ${config.demoMode ? 'DEMO (Simulasi)' : 'PRODUCTION (Proxmox Link)'} `);
  console.log(`==================================================`);
});
