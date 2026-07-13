<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\NetworkSla;
use App\Models\SwitchModel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class SwitchController extends Controller
{
    public function index()
    {
        return response()->json(SwitchModel::all());
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string',
            'ip' => 'required|string|ip',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 400);
        }

        $name = $request->input('name');
        $ip = $request->input('ip');
        $id = 'sw-' . Str::random(7);

        $newSwitch = SwitchModel::create([
            'id' => $id,
            'name' => $name,
            'ip' => $ip,
            'status' => 'online',
            'latency' => 1,
        ]);

        $currentUser = $request->input('user');
        AuditLog::log($currentUser->username, 'add_switch', $name, 'success', "Added switch {$name} ({$ip})");

        return response()->json($newSwitch);
    }

    public function destroy(Request $request, $id)
    {
        $device = SwitchModel::find($id);
        if (!$device) {
            return response()->json(['error' => 'Device not found'], 404);
        }

        $device->delete();
        $currentUser = $request->input('user');
        AuditLog::log($currentUser->username, 'delete_switch', $device->name, 'success', "Deleted switch {$device->name}");

        return response()->json(['success' => true, 'message' => 'Device deleted successfully']);
    }

    public function slaIndex()
    {
        $logs = NetworkSla::orderBy('timestamp', 'desc')->limit(100)->get();
        return response()->json($logs);
    }

    public function slaClear(Request $request)
    {
        NetworkSla::truncate();
        $currentUser = $request->input('user');
        AuditLog::log($currentUser->username, 'clear_sla_logs', 'switches', 'success', 'Cleared switch SLA event logs');
        return response()->json(['success' => true]);
    }
}
