<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\File;

class ProxmoxController extends Controller
{
    private function getConfig()
    {
        return [
            'demoMode' => env('DEMO_MODE', 'true') !== 'false',
            'apiUrl' => env('PROXMOX_API_URL', 'https://YOUR_PROXMOX_IP:8006/api2/json'),
            'tokenId' => env('PROXMOX_TOKEN_ID', 'root@pam!dashboard'),
            'tokenSecret' => env('PROXMOX_TOKEN_SECRET', ''),
            'mikrotikIp' => env('MIKROTIK_IP', '192.168.88.1'),
            'mikrotikCommunity' => env('MIKROTIK_SNMP_COMMUNITY', 'public'),
            'mikrotikPort' => (int)env('MIKROTIK_SNMP_PORT', 161),
        ];
    }

    private function proxmoxRequest($method, $path, $data = null)
    {
        $config = $this->getConfig();
        $url = rtrim($config['apiUrl'], '/') . '/' . ltrim($path, '/');
        
        $headers = [
            'Authorization' => "PVEAPIToken={$config['tokenId']}={$config['tokenSecret']}",
            'Accept' => 'application/json',
        ];

        $client = Http::withoutVerifying()->withHeaders($headers);

        $response = match (strtoupper($method)) {
            'GET' => $client->get($url),
            'POST' => $client->post($url, $data ?? []),
            default => throw new \Exception("Unsupported method: {$method}"),
        };

        if ($response->failed()) {
            throw new \Exception($response->body());
        }

        return $response->json();
    }

    public function getStatus()
    {
        $config = $this->getConfig();
        $isOnline = false;

        if ($config['demoMode']) {
            $isOnline = true;
        } else {
            try {
                $this->proxmoxRequest('GET', 'version');
                $isOnline = true;
            } catch (\Exception $e) {
                $isOnline = false;
            }
        }

        // Get Mikrotik connection state (simulated or fetched from cached stats in switches ping)
        $mikrotikOnline = \Illuminate\Support\Facades\Cache::get('mikrotik_online', false);

        return response()->json([
            'online' => $isOnline,
            'mode' => $config['demoMode'] ? 'demo' : 'production',
            'message' => $config['demoMode'] ? 'Backend running in Demo (Simulation) Mode' : 'Backend connected to Proxmox VE API',
            'proxmoxWebUrl' => str_replace('/api2/json', '', $config['apiUrl']),
            'mikrotikOnline' => $mikrotikOnline,
        ]);
    }

    public function getResources()
    {
        $config = $this->getConfig();

        if ($config['demoMode']) {
            return response()->json($this->getDemoResources());
        }

        try {
            $res = $this->proxmoxRequest('GET', 'cluster/resources');
            return response()->json($res['data'] ?? []);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to fetch Proxmox resources', 'details' => $e->getMessage()], 500);
        }
    }

    public function getNodesList()
    {
        $config = $this->getConfig();

        if ($config['demoMode']) {
            return response()->json([
                ['node' => 'jnoc-node-01', 'status' => 'online', 'cpu' => 0.34, 'mem' => 56.2 * 1024 * 1024 * 1024, 'maxmem' => 80 * 1024 * 1024 * 1024, 'uptime' => 1857600, 'level' => 'master'],
                ['node' => 'jnoc-node-02', 'status' => 'offline', 'cpu' => 0, 'mem' => 0, 'maxmem' => 64 * 1024 * 1024 * 1024, 'uptime' => 0, 'level' => 'backup']
            ]);
        }

        try {
            $res = $this->proxmoxRequest('GET', 'nodes');
            return response()->json($res['data'] ?? []);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to fetch nodes list', 'details' => $e->getMessage()], 500);
        }
    }

    public function getNodeStatus($node)
    {
        $config = $this->getConfig();

        if ($config['demoMode']) {
            return response()->json([
                'cpu' => 0.25,
                'memory' => [
                    'used' => 8 * 1024 * 1024 * 1024,
                    'total' => 32 * 1024 * 1024 * 1024
                ],
                'uptime' => 123456
            ]);
        }

        try {
            $res = $this->proxmoxRequest('GET', "nodes/{$node}/status");
            return response()->json($res['data'] ?? []);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to fetch node status', 'details' => $e->getMessage()], 500);
        }
    }

    public function getNodeStorage($node)
    {
        $config = $this->getConfig();

        if ($config['demoMode']) {
            return response()->json([
                [
                    'storage' => 'local',
                    'type' => 'dir',
                    'content' => 'backup,vztmpl,iso',
                    'used' => 50 * 1024 * 1024 * 1024,
                    'total' => 100 * 1024 * 1024 * 1024,
                ],
                [
                    'storage' => 'local-lvm',
                    'type' => 'lvmthin',
                    'content' => 'rootdir,images',
                    'used' => 200 * 1024 * 1024 * 1024,
                    'total' => 400 * 1024 * 1024 * 1024,
                ]
            ]);
        }

        try {
            $res = $this->proxmoxRequest('GET', "nodes/{$node}/storage");
            return response()->json($res['data'] ?? []);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to fetch node storage', 'details' => $e->getMessage()], 500);
        }
    }

    public function getNodeTasks($node)
    {
        $config = $this->getConfig();

        if ($config['demoMode']) {
            return response()->json($this->getDemoTasks());
        }

        try {
            $res = $this->proxmoxRequest('GET', "nodes/{$node}/tasks?limit=15");
            return response()->json($res['data'] ?? []);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to fetch Proxmox tasks log', 'details' => $e->getMessage()], 500);
        }
    }

    public function controlVm(Request $request, $node, $vmid, $action)
    {
        $user = (object)$request->input('user');
        $config = $this->getConfig();
        $validActions = ['start', 'stop', 'shutdown', 'reboot'];

        if (!in_array($action, $validActions)) {
            AuditLog::log($user->username, "vm_{$action}", "{$node}/{$vmid}", 'failure', "Invalid VM action: {$action}");
            return response()->json(['error' => 'Invalid action. Must be start, stop, shutdown, or reboot'], 400);
        }

        if ($config['demoMode']) {
            // Simulated VM control state adjustments in Cache
            $vms = $this->getDemoResources();
            foreach ($vms as &$vm) {
                if ($vm['vmid'] == $vmid) {
                    if ($action === 'start') {
                        $vm['status'] = 'running';
                        $vm['uptime'] = 10;
                    } elseif ($action === 'stop' || $action === 'shutdown') {
                        $vm['status'] = 'stopped';
                        $vm['uptime'] = 0;
                        $vm['cpu'] = 0;
                        $vm['mem'] = 0;
                    } elseif ($action === 'reboot') {
                        $vm['status'] = 'running';
                        $vm['uptime'] = 5;
                    }
                }
            }
            \Illuminate\Support\Facades\Cache::put('demo_vms', $vms, 600);
            AuditLog::log($user->username, "vm_{$action}", "{$node}/{$vmid}", 'success', "[DEMO] Triggered VM action successfully");
            return response()->json(['success' => true, 'message' => "[DEMO] VM {$vmid} action '{$action}' triggered successfully."]);
        }

        try {
            $resources = $this->proxmoxRequest('GET', 'cluster/resources');
            $targetResource = null;
            foreach ($resources['data'] as $r) {
                if (($r['type'] === 'qemu' || $r['type'] === 'lxc') && $r['vmid'] == $vmid) {
                    $targetResource = $r;
                    break;
                }
            }

            if (!$targetResource) {
                AuditLog::log($user->username, "vm_{$action}", "{$node}/{$vmid}", 'failure', 'VM not found');
                return response()->json(['error' => "VM/CT with ID {$vmid} not found on node {$node}"], 404);
            }

            $type = $targetResource['type'];
            $path = "nodes/{$node}/{$type}/{$vmid}/status/{$action}";
            $result = $this->proxmoxRequest('POST', $path);

            AuditLog::log($user->username, "vm_{$action}", "{$node}/{$vmid}", 'success', "Triggered VM action {$action}");
            return response()->json(['success' => true, 'details' => $result['data'] ?? $result]);
        } catch (\Exception $e) {
            AuditLog::log($user->username, "vm_{$action}", "{$node}/{$vmid}", 'failure', "Failed: " . $e->getMessage());
            return response()->json(['error' => "Failed to trigger action '{$action}' on VM {$vmid}", 'details' => $e->getMessage()], 500);
        }
    }

    public function controlNode(Request $request, $node, $action)
    {
        $user = (object)$request->input('user');
        $config = $this->getConfig();
        $validActions = ['reboot', 'shutdown'];

        if (!in_array($action, $validActions)) {
            AuditLog::log($user->username, "node_{$action}", $node, 'failure', "Invalid action: {$action}");
            return response()->json(['error' => 'Invalid action. Must be reboot or shutdown'], 400);
        }

        if ($config['demoMode']) {
            AuditLog::log($user->username, "node_{$action}", $node, 'success', "[DEMO] Triggered host {$action} (Simulated)");
            return response()->json(['success' => true, 'message' => "Node {$node} is performing {$action} (Simulated)"]);
        }

        try {
            $result = $this->proxmoxRequest('POST', "nodes/{$node}/status", ['command' => $action]);
            AuditLog::log($user->username, "node_{$action}", $node, 'success', "Sent host {$action} command");
            return response()->json(['success' => true, 'message' => "Node {$node} {$action} command sent successfully.", 'details' => $result]);
        } catch (\Exception $e) {
            AuditLog::log($user->username, "node_{$action}", $node, 'failure', "Failed: " . $e->getMessage());
            return response()->json(['error' => "Failed to execute node command {$action}", 'details' => $e->getMessage()], 500);
        }
    }

    public function getSettings()
    {
        return response()->json($this->getConfig());
    }

    public function saveSettings(Request $request)
    {
        $request->validate([
            'demoMode' => 'required|boolean',
            'apiUrl' => 'required|string',
            'tokenId' => 'required|string',
            'tokenSecret' => 'nullable|string',
            'mikrotikIp' => 'required|string',
            'mikrotikCommunity' => 'required|string',
            'mikrotikPort' => 'required|integer',
        ]);

        $demoMode = $request->input('demoMode') ? 'true' : 'false';
        $apiUrl = $request->input('apiUrl');
        $tokenId = $request->input('tokenId');
        $tokenSecret = $request->input('tokenSecret') ?? '';
        $mikrotikIp = $request->input('mikrotikIp');
        $mikrotikCommunity = $request->input('mikrotikCommunity');
        $mikrotikPort = $request->input('mikrotikPort');

        try {
            $envPath = base_path('.env');
            if (File::exists($envPath)) {
                $envContent = File::get($envPath);
                
                $replacements = [
                    'DEMO_MODE' => $demoMode,
                    'PROXMOX_API_URL' => $apiUrl,
                    'PROXMOX_TOKEN_ID' => $tokenId,
                    'PROXMOX_TOKEN_SECRET' => $tokenSecret,
                    'MIKROTIK_IP' => $mikrotikIp,
                    'MIKROTIK_SNMP_COMMUNITY' => $mikrotikCommunity,
                    'MIKROTIK_SNMP_PORT' => $mikrotikPort,
                ];

                foreach ($replacements as $key => $value) {
                    // Check if key exists
                    if (preg_match("/^{$key}=/m", $envContent)) {
                        $envContent = preg_replace("/^{$key}=.*/m", "{$key}=\"{$value}\"", $envContent);
                    } else {
                        $envContent .= "\n{$key}=\"{$value}\"";
                    }
                }

                File::put($envPath, $envContent);
            }

            $currentUser = (object)$request->input('user');
            AuditLog::log($currentUser->username, 'edit_settings', 'system', 'success', 'Updated settings and wrote configurations to .env');

            return response()->json(['success' => true, 'message' => 'Settings saved successfully']);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to save settings', 'details' => $e->getMessage()], 500);
        }
    }

    public function getActiveNodeStatus()
    {
        $config = $this->getConfig();

        if ($config['demoMode']) {
            return response()->json([
                'node' => 'jnoc-node-01',
                'status' => 'online',
                'cpu' => 0.2 + (rand(0, 100) / 200),
                'memory' => [
                    'used' => 52.4 * 1024 * 1024 * 1024,
                    'total' => 80 * 1024 * 1024 * 1024
                ],
                'pveVersion' => 'Proxmox VE 8.1.4',
                'kversion' => 'Linux 6.5.11-7-pve',
                'cpuinfo' => [
                    'model' => 'AMD Ryzen 9 5900X',
                    'cpus' => 24
                ],
                'loadavg' => [
                    (string)(0.3 + rand(0, 50)/100),
                    (string)(0.2 + rand(0, 40)/100),
                    (string)(0.2 + rand(0, 30)/100)
                ],
                'wait' => 0.01
            ]);
        }

        try {
            $nodesRes = $this->proxmoxRequest('GET', 'nodes');
            $nodes = $nodesRes['data'] ?? [];
            if (empty($nodes)) {
                return response()->json(['error' => 'No Proxmox nodes found'], 404);
            }
            $targetNode = $nodes[0]['node'];
            
            $statusRes = $this->proxmoxRequest('GET', "nodes/{$targetNode}/status");
            $status = $statusRes['data'] ?? [];
            
            $versionRes = $this->proxmoxRequest('GET', 'version');
            $version = $versionRes['data']['version'] ?? '8.x';

            return response()->json([
                'node' => $targetNode,
                'status' => 'online',
                'cpu' => $status['cpu'] ?? 0,
                'memory' => [
                    'used' => $status['memory']['used'] ?? 0,
                    'total' => $status['memory']['total'] ?? 0
                ],
                'pveVersion' => "Proxmox VE {$version}",
                'kversion' => $status['kversion'] ?? 'Linux Kernel',
                'cpuinfo' => [
                    'model' => $status['cpuinfo']['model'] ?? 'Unknown CPU',
                    'cpus' => $status['cpuinfo']['cpus'] ?? 1
                ],
                'loadavg' => $status['loadavg'] ?? [0, 0, 0],
                'wait' => $status['wait'] ?? 0
            ]);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to fetch Proxmox Node Status', 'details' => $e->getMessage()], 500);
        }
    }

    public function getActiveNodeStorage()
    {
        $config = $this->getConfig();

        if ($config['demoMode']) {
            return response()->json([
                [ 'storage' => 'local', 'type' => 'dir', 'content' => 'iso,vztmpl,backup', 'size' => 100 * 1024 * 1024 * 1024, 'used' => 42 * 1024 * 1024 * 1024, 'active' => 1, 'shared' => 0 ],
                [ 'storage' => 'local-lvm', 'type' => 'lvmthin', 'content' => 'images,rootdir', 'size' => 800 * 1024 * 1024 * 1024, 'used' => 512 * 1024 * 1024 * 1024, 'active' => 1, 'shared' => 0 ],
                [ 'storage' => 'backup-nas', 'type' => 'nfs', 'content' => 'backup', 'size' => 2048 * 1024 * 1024 * 1024, 'used' => 1120 * 1024 * 1024 * 1024, 'active' => 1, 'shared' => 1 ]
            ]);
        }

        try {
            $res = $this->proxmoxRequest('GET', 'cluster/resources?type=storage');
            $storages = $res['data'] ?? [];
            
            $formatted = array_map(function ($st) {
                return [
                    'storage' => $st['storage'] ?? $st['id'] ?? 'unknown',
                    'type' => $st['plugintype'] ?? 'unknown',
                    'content' => $st['content'] ?? '',
                    'size' => $st['maxdisk'] ?? 0,
                    'used' => $st['disk'] ?? 0,
                    'active' => $st['active'] ?? 1,
                    'shared' => $st['shared'] ?? 0,
                ];
            }, $storages);
            
            return response()->json($formatted);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to fetch Proxmox storage pools', 'details' => $e->getMessage()], 500);
        }
    }

    public function getActiveNodeTasks()
    {
        $config = $this->getConfig();

        if ($config['demoMode']) {
            return response()->json([
                [ 'upid' => 'UPID:node-01:001:002:start:qemu/100', 'node' => 'jnoc-node-01', 'user' => 'root@pam', 'type' => 'qemustart', 'status' => 'OK', 'starttime' => time() - 3600, 'endtime' => time() - 3590 ],
                [ 'upid' => 'UPID:node-01:003:004:stop:qemu/101', 'node' => 'jnoc-node-01', 'user' => 'root@pam', 'type' => 'qemustop', 'status' => 'OK', 'starttime' => time() - 7200, 'endtime' => time() - 7150 ],
                [ 'upid' => 'UPID:node-02:005:006:start:lxc/200', 'node' => 'jnoc-node-02', 'user' => 'root@pam', 'type' => 'lxcstart', 'status' => 'OK', 'starttime' => time() - 10000, 'endtime' => time() - 9980 ]
            ]);
        }

        try {
            $nodesRes = $this->proxmoxRequest('GET', 'nodes');
            $nodes = $nodesRes['data'] ?? [];
            if (empty($nodes)) {
                return response()->json([]);
            }
            $targetNode = $nodes[0]['node'];
            
            $tasksRes = $this->proxmoxRequest('GET', "nodes/{$targetNode}/tasks?limit=15");
            return response()->json($tasksRes['data'] ?? []);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to fetch Proxmox tasks log', 'details' => $e->getMessage()], 500);
        }
    }

    private function getDemoResources()
    {
        if (\Illuminate\Support\Facades\Cache::has('demo_vms')) {
            return \Illuminate\Support\Facades\Cache::get('demo_vms');
        }

        $vms = [
            [
                'vmid' => 100,
                'name' => 'jnoc-firewall',
                'type' => 'qemu',
                'status' => 'running',
                'cpu' => 0.05,
                'maxcpu' => 2,
                'mem' => 512 * 1024 * 1024,
                'maxmem' => 2048 * 1024 * 1024,
                'netin' => 450 * 1024,
                'netout' => 120 * 1024,
                'uptime' => 789200,
                'node' => 'jnoc-node-01'
            ],
            [
                'vmid' => 101,
                'name' => 'jnoc-auth-db',
                'type' => 'qemu',
                'status' => 'running',
                'cpu' => 0.12,
                'maxcpu' => 4,
                'mem' => 3072 * 1024 * 1024,
                'maxmem' => 8192 * 1024 * 1024,
                'netin' => 1200 * 1024,
                'netout' => 4500 * 1024,
                'uptime' => 456700,
                'node' => 'jnoc-node-01'
            ],
            [
                'vmid' => 200,
                'name' => 'cacti-nms',
                'type' => 'lxc',
                'status' => 'running',
                'cpu' => 0.08,
                'maxcpu' => 2,
                'mem' => 1024 * 1024 * 1024,
                'maxmem' => 4096 * 1024 * 1024,
                'netin' => 80 * 1024,
                'netout' => 500 * 1024,
                'uptime' => 1234500,
                'node' => 'jnoc-node-02'
            ],
            [
                'vmid' => 201,
                'name' => 'ad-dns-server',
                'type' => 'qemu',
                'status' => 'running',
                'cpu' => 0.02,
                'maxcpu' => 2,
                'mem' => 2048 * 1024 * 1024,
                'maxmem' => 4096 * 1024 * 1024,
                'netin' => 500 * 1024,
                'netout' => 120 * 1024,
                'uptime' => 2345600,
                'node' => 'jnoc-node-02'
            ],
            [
                'vmid' => 202,
                'name' => 'dev-testing-env',
                'type' => 'qemu',
                'status' => 'stopped',
                'cpu' => 0,
                'maxcpu' => 2,
                'mem' => 0,
                'maxmem' => 2048 * 1024 * 1024,
                'netin' => 0,
                'netout' => 0,
                'uptime' => 0,
                'node' => 'jnoc-node-02'
            ]
        ];

        \Illuminate\Support\Facades\Cache::put('demo_vms', $vms, 600);
        return $vms;
    }

    private function getDemoTasks()
    {
        return [
            ['upid' => 'UPID:node-01:001:002:start:qemu/100', 'node' => 'jnoc-node-01', 'user' => 'root@pam', 'starttime' => time() - 3600, 'endtime' => time() - 3590, 'status' => 'OK', 'type' => 'qemustart'],
            ['upid' => 'UPID:node-01:003:004:stop:qemu/101', 'node' => 'jnoc-node-01', 'user' => 'root@pam', 'starttime' => time() - 7200, 'endtime' => time() - 7150, 'status' => 'OK', 'type' => 'qemustop'],
            ['upid' => 'UPID:node-02:005:006:start:lxc/200', 'node' => 'jnoc-node-02', 'user' => 'root@pam', 'starttime' => time() - 10000, 'endtime' => time() - 9980, 'status' => 'OK', 'type' => 'lxcstart']
        ];
    }
}
