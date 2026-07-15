<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use Illuminate\Http\Request;

class AuditLogController extends Controller
{
    public function index()
    {
        $logs = AuditLog::orderBy('id', 'desc')->limit(200)->get();
        return response()->json($logs);
    }

    public function clear(Request $request)
    {
        AuditLog::truncate();
        $currentUser = (object)$request->input('user');
        AuditLog::log($currentUser->username, 'clear_audit_logs', 'all', 'success', 'Cleared audit logs database');
        return response()->json(['success' => true]);
    }
}
