<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Request;

class AuditLog extends Model
{
    protected $table = 'audit_logs';
    protected $guarded = [];

    public static function log($username, $action, $target, $status, $message = null)
    {
        self::create([
            'timestamp' => now()->toISOString(),
            'username' => $username,
            'ip_address' => Request::ip(),
            'action' => $action,
            'target' => $target,
            'status' => $status,
            'message' => $message,
        ]);
    }
}
