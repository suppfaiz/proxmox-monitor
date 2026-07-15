<?php

namespace App\Console\Commands;

use App\Models\NetworkSla;
use App\Models\SwitchModel;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class PingSwitches extends Command
{
    protected $signature = 'switches:ping';
    protected $description = 'Poll registered switches every 1 second to monitor SLA connectivity status';

    public function handle()
    {
        $this->info("JNOC Switch SLA Monitor Daemon started. Polling every 1s...");

        while (true) {
            $startTime = microtime(true);

            try {
                $this->pollSwitches();
            } catch (\Exception $e) {
                $this->error("Error polling switches: " . $e->getMessage());
            }

            // Calculate loop execution duration to maintain precise 1-second ticks
            $elapsed = microtime(true) - $startTime;
            $sleepTime = 1.0 - $elapsed;
            if ($sleepTime > 0) {
                usleep((int)($sleepTime * 1000000));
            }
        }
    }

    private function pollSwitches()
    {
        $demoMode = filter_var(env('DEMO_MODE', true), FILTER_VALIDATE_BOOLEAN);
        $switches = SwitchModel::all();

        foreach ($switches as $sw) {
            $latency = 0;
            $status = 'offline';

            if ($demoMode) {
                $isDemoDown = Cache::get("demo_down_until_{$sw->id}", 0);
                
                if ($isDemoDown > 0) {
                    if (time() >= $isDemoDown) {
                        // Demo downtime ended, restore to online
                        Cache::forget("demo_down_until_{$sw->id}");
                        $status = 'online';
                        $latency = rand(1, 4);
                    } else {
                        // Still in demo downtime
                        $status = 'offline';
                        $latency = 0;
                    }
                } else {
                    // 1% probability to trigger random downtime (5-15s) for SLA demo alert validation
                    if (rand(1, 100) === 42) {
                        $downtimeDuration = rand(5, 15);
                        Cache::put("demo_down_until_{$sw->id}", time() + $downtimeDuration, 60);
                        $status = 'offline';
                        $latency = 0;
                        $this->warn("Simulating random downtime for: {$sw->name} for {$downtimeDuration}s");
                    } else {
                        $status = 'online';
                        $latency = rand(1, 5);
                    }
                }
            } else {
                // Production: execute system ping command
                $ipEscaped = escapeshellarg($sw->ip);
                $output = [];
                $result = 0;
                
                exec("ping -c 1 -W 1 {$ipEscaped} 2>/dev/null", $output, $result);
                
                if ($result === 0) {
                    $status = 'online';
                    foreach ($output as $line) {
                        if (preg_match('/time=([0-9\.]+)\s*ms/', $line, $matches)) {
                            $latency = (int)round((float)$matches[1]);
                            break;
                        }
                    }
                }
            }

            // Check for state transitions
            $oldStatus = $sw->status;
            
            if ($oldStatus === 'online' && $status === 'offline') {
                // Went offline: Log down alarm event
                $nowStr = now()->toISOString();
                $formattedTime = now()->format('Y-m-d H:i:s');
                $message = "Switch {$sw->name} ({$sw->ip}) DOWN at {$formattedTime}";

                $sw->update([
                    'status' => 'offline',
                    'latency' => 0,
                    'lastDown' => $nowStr
                ]);

                NetworkSla::create([
                    'id' => 'sla-' . Str::random(10),
                    'type' => 'down',
                    'deviceName' => $sw->name,
                    'deviceIp' => $sw->ip,
                    'timestamp' => $nowStr,
                    'formattedTime' => $formattedTime,
                    'lastDown' => $nowStr,
                    'duration' => null,
                    'message' => $message
                ]);

                $this->error($message);
            } elseif ($oldStatus === 'offline' && $status === 'online') {
                // Recovered: Log up alarm event
                $nowStr = now()->toISOString();
                $formattedTime = now()->format('Y-m-d H:i:s');
                
                $durationStr = 'unknown';
                if ($sw->lastDown) {
                    $downTime = \Carbon\Carbon::parse($sw->lastDown);
                    $diffSec = now()->diffInSeconds($downTime);
                    $durationStr = "{$diffSec}s";
                }

                $message = "Switch {$sw->name} ({$sw->ip}) UP at {$formattedTime}. Downtime duration: {$durationStr}";

                $sw->update([
                    'status' => 'online',
                    'latency' => $latency,
                    'lastUp' => $nowStr
                ]);

                NetworkSla::create([
                    'id' => 'sla-' . Str::random(10),
                    'type' => 'up',
                    'deviceName' => $sw->name,
                    'deviceIp' => $sw->ip,
                    'timestamp' => $nowStr,
                    'formattedTime' => $formattedTime,
                    'lastDown' => $sw->lastDown,
                    'duration' => $durationStr,
                    'message' => $message
                ]);

                $this->info($message);
            } else {
                // No transition, just update current metrics
                $sw->update([
                    'status' => $status,
                    'latency' => $status === 'online' ? $latency : 0
                ]);
            }
        }
    }
}
