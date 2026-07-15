<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class MikrotikController extends Controller
{
    private function getConfig()
    {
        return [
            'demoMode' => filter_var(env('DEMO_MODE', true), FILTER_VALIDATE_BOOLEAN),
            'mikrotikIp' => env('MIKROTIK_IP', '192.168.88.1'),
            'mikrotikCommunity' => env('MIKROTIK_SNMP_COMMUNITY', 'public'),
            'mikrotikPort' => (int)env('MIKROTIK_SNMP_PORT', 161),
        ];
    }

    public function getStats()
    {
        $config = $this->getConfig();

        if ($config['demoMode']) {
            $stats = $this->getDemoStats();
            // Store online state in cache for Proxmox status check
            Cache::put('mikrotik_online', true, 60);
            return response()->json($stats);
        }

        try {
            $stats = $this->pollRealMikrotikSNMP($config);
            Cache::put('mikrotik_online', $stats['online'], 60);
            return response()->json($stats);
        } catch (\Exception $e) {
            Cache::put('mikrotik_online', false, 60);
            return response()->json([
                'online' => false,
                'error' => 'Failed to query MikroTik SNMP',
                'details' => $e->getMessage()
            ], 500);
        }
    }

    private function runSnmpGet($config, $oid)
    {
        $ip = escapeshellarg($config['mikrotikIp']);
        $community = escapeshellarg($config['mikrotikCommunity']);
        $port = (int)$config['mikrotikPort'];
        
        $output = [];
        $returnVal = 0;
        
        // Execute snmpget command (IPv4 only)
        exec("snmpget -v 2c -c {$community} {$ip}:{$port} {$oid} 2>/dev/null", $output, $returnVal);
        
        if ($returnVal !== 0 || empty($output)) {
            return null;
        }

        return $this->parseSnmpValue($output[0]);
    }

    private function runSnmpWalk($config, $oid)
    {
        $ip = escapeshellarg($config['mikrotikIp']);
        $community = escapeshellarg($config['mikrotikCommunity']);
        $port = (int)$config['mikrotikPort'];
        
        $output = [];
        $returnVal = 0;
        
        exec("snmpwalk -v 2c -c {$community} {$ip}:{$port} {$oid} 2>/dev/null", $output, $returnVal);
        
        if ($returnVal !== 0) {
            return [];
        }

        $results = [];
        foreach ($output as $line) {
            if (preg_match('/' . preg_quote($oid, '/') . '\.(\d+) = (.*)/', $line, $matches)) {
                $index = $matches[1];
                $results[$index] = $this->parseSnmpValue($matches[2]);
            }
        }

        return $results;
    }

    private function parseSnmpValue($line)
    {
        // Parses values like INTEGER: 12, STRING: "RB5009", Counter32: 38283
        if (preg_match('/STRING: "(.*)"/', $line, $matches)) {
            return $matches[1];
        }
        if (preg_match('/STRING: (.*)/', $line, $matches)) {
            return trim($matches[1], '"');
        }
        if (preg_match('/INTEGER: (.*)/', $line, $matches)) {
            return (int)trim($matches[1]);
        }
        if (preg_match('/Counter32: (.*)/', $line, $matches)) {
            return (float)trim($matches[1]);
        }
        if (preg_match('/Counter64: (.*)/', $line, $matches)) {
            return (float)trim($matches[1]);
        }
        
        $parts = explode(' = ', $line);
        if (count($parts) > 1) {
            $valPart = explode(': ', $parts[1]);
            return count($valPart) > 1 ? trim($valPart[1], '" ') : trim($parts[1], '" ');
        }
        
        return trim($line);
    }

    private function pollRealMikrotikSNMP($config)
    {
        // 1. Check if snmpget command is available
        $check = null;
        exec("which snmpget", $check);
        if (empty($check)) {
            throw new \Exception("snmpget is not installed in the container.");
        }

        // Query Host Identity & Uptime
        $sysName = $this->runSnmpGet($config, '1.3.6.1.2.1.1.5.0');
        if ($sysName === null) {
            return ['online' => false];
        }

        $sysUptime = $this->runSnmpGet($config, '1.3.6.1.2.1.1.3.0') ?? 0;
        $model = $this->runSnmpGet($config, '1.3.6.1.4.1.14988.1.1.12.1.1.1.0') ?? 'MikroTik Router';
        $version = $this->runSnmpGet($config, '1.3.6.1.4.1.14988.1.1.12.1.1.1.2') ?? 'RouterOS';

        // Query Resources (CPU, Memory, Disk)
        $cpu = $this->runSnmpGet($config, '1.3.6.1.4.1.14988.1.1.3.14.0') ?? 0;
        $ramTotal = $this->runSnmpGet($config, '1.3.6.1.2.1.25.2.3.1.5.65536') ?? 0;
        $ramUsed = $this->runSnmpGet($config, '1.3.6.1.2.1.25.2.3.1.6.65536') ?? 0;

        // Walk Interfaces
        $ifNames = $this->runSnmpWalk($config, '1.3.6.1.2.1.2.2.1.2');
        $ifStatus = $this->runSnmpWalk($config, '1.3.6.1.2.1.2.2.1.8');
        $ifInBytes = $this->runSnmpWalk($config, '1.3.6.1.2.1.2.2.1.10');
        $ifOutBytes = $this->runSnmpWalk($config, '1.3.6.1.2.1.2.2.1.16');

        $interfaces = [];
        $totalRxSpeed = 0;
        $totalTxSpeed = 0;

        $currentTime = microtime(true);
        $lastPollTime = Cache::get('mikrotik_last_poll_time', $currentTime);
        $timeDelta = $currentTime - $lastPollTime;
        if ($timeDelta <= 0) $timeDelta = 2; // Prevent divide by zero

        $lastBytes = Cache::get('mikrotik_last_bytes', []);
        $newLastBytes = [];

        foreach ($ifNames as $index => $name) {
            $status = ($ifStatus[$index] ?? 1) == 1 ? 'up' : 'down';
            $rxBytes = $ifInBytes[$index] ?? 0;
            $txBytes = $ifOutBytes[$index] ?? 0;

            // Calculate speeds based on byte difference
            $rxSpeed = 0;
            $txSpeed = 0;

            if (isset($lastBytes[$index])) {
                $prevRx = $lastBytes[$index]['rx'];
                $prevTx = $lastBytes[$index]['tx'];
                
                if ($rxBytes >= $prevRx) {
                    $rxSpeed = (($rxBytes - $prevRx) * 8) / $timeDelta; // bps
                }
                if ($txBytes >= $prevTx) {
                    $txSpeed = (($txBytes - $prevTx) * 8) / $timeDelta; // bps
                }
            }

            $newLastBytes[$index] = ['rx' => $rxBytes, 'tx' => $txBytes];

            $totalRxSpeed += $rxSpeed;
            $totalTxSpeed += $txSpeed;

            $interfaces[] = [
                'id' => (string)$index,
                'name' => $name,
                'status' => $status,
                'rx' => round($rxBytes),
                'tx' => round($txBytes),
                'rxSpeed' => round($rxSpeed),
                'txSpeed' => round($txSpeed),
            ];
        }

        Cache::put('mikrotik_last_bytes', $newLastBytes, 60);
        Cache::put('mikrotik_last_poll_time', $currentTime, 60);

        // Manage traffic graph history (Mbps values)
        $rxMbps = round($totalRxSpeed / (1024 * 1024), 2);
        $txMbps = round($totalTxSpeed / (1024 * 1024), 2);

        $rxHistory = Cache::get('mikrotik_rx_history', array_fill(0, 20, 0));
        $txHistory = Cache::get('mikrotik_tx_history', array_fill(0, 20, 0));

        $rxHistory[] = $rxMbps;
        $txHistory[] = $txMbps;

        if (count($rxHistory) > 20) {
            array_shift($rxHistory);
            array_shift($txHistory);
        }

        Cache::put('mikrotik_rx_history', $rxHistory, 300);
        Cache::put('mikrotik_tx_history', $txHistory, 300);

        return [
            'online' => true,
            'identity' => [
                'name' => $sysName,
                'uptime' => (int)($sysUptime / 100), // convert centiseconds to seconds
                'model' => $model,
                'version' => $version
            ],
            'resources' => [
                'cpu' => $cpu,
                'ramUsed' => $ramUsed * 1024 * 1024, // Estimate Ram values if SNMP ticks are basic
                'ramTotal' => $ramTotal * 1024 * 1024,
                'diskUsed' => 15 * 1024 * 1024,
                'diskTotal' => 64 * 1024 * 1024,
            ],
            'interfaces' => $interfaces,
            'network' => [
                'rx' => $rxMbps,
                'tx' => $txMbps,
                'rxHistory' => $rxHistory,
                'txHistory' => $txHistory
            ]
        ];
    }

    private function getDemoStats()
    {
        $uptime = Cache::get('demo_mikrotik_uptime', 45000);
        $uptime += 2;
        Cache::put('demo_mikrotik_uptime', $uptime, 300);

        $cpu = rand(4, 12);
        $rx = rand(15, 65); // Mbps
        $tx = rand(5, 30); // Mbps

        $rxHistory = Cache::get('demo_mikrotik_rx_history', array_fill(0, 20, 30));
        $txHistory = Cache::get('demo_mikrotik_tx_history', array_fill(0, 20, 15));

        $rxHistory[] = $rx;
        $txHistory[] = $tx;

        if (count($rxHistory) > 20) {
            array_shift($rxHistory);
            array_shift($txHistory);
        }

        Cache::put('demo_mikrotik_rx_history', $rxHistory, 300);
        Cache::put('demo_mikrotik_tx_history', $txHistory, 300);

        return [
            'online' => true,
            'identity' => [
                'name' => 'JNOC-RouterOS-Gateway',
                'uptime' => $uptime,
                'model' => 'CCR2004-16G-2S+',
                'version' => 'RouterOS v7.14 (stable)'
            ],
            'resources' => [
                'cpu' => $cpu,
                'ramUsed' => 1200 * 1024 * 1024,
                'ramTotal' => 4096 * 1024 * 1024,
                'diskUsed' => 32 * 1024 * 1024,
                'diskTotal' => 128 * 1024 * 1024,
            ],
            'interfaces' => [
                ['id' => '1', 'name' => 'ether1-wan', 'status' => 'up', 'rxSpeed' => $rx * 1000 * 1000, 'txSpeed' => $tx * 1000 * 1000],
                ['id' => '2', 'name' => 'ether2-lan-core', 'status' => 'up', 'rxSpeed' => $tx * 1000 * 1000, 'txSpeed' => $rx * 1000 * 1000],
                ['id' => '3', 'name' => 'ether3-unused', 'status' => 'down', 'rxSpeed' => 0, 'txSpeed' => 0]
            ],
            'network' => [
                'rx' => $rx,
                'tx' => $tx,
                'rxHistory' => $rxHistory,
                'txHistory' => $txHistory
            ]
        ];
    }
}
