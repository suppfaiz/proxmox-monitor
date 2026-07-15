<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ProxmoxController;
use App\Http\Controllers\MikrotikController;
use App\Http\Controllers\SwitchController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\AuditLogController;
use Illuminate\Support\Facades\Route;

// Public login route (corresponds to /api/login)
Route::post('/login', [AuthController::class, 'login']);
Route::get('/diagnose', 'App\Http\Controllers\ProxmoxController@diagnose');

// Authenticated SPA routes
Route::middleware('auth.session')->group(function () {
    // Proxmox Monitoring Proxies
    Route::get('/status', [ProxmoxController::class, 'getStatus']);
    Route::get('/resources', [ProxmoxController::class, 'getResources']);
    Route::get('/nodes-list', [ProxmoxController::class, 'getNodesList']);
    Route::get('/node-status', [ProxmoxController::class, 'getActiveNodeStatus']);
    Route::get('/storage', [ProxmoxController::class, 'getActiveNodeStorage']);
    Route::get('/tasks', [ProxmoxController::class, 'getActiveNodeTasks']);
    Route::get('/node/{node}/status', [ProxmoxController::class, 'getNodeStatus']);
    Route::get('/node/{node}/storage', [ProxmoxController::class, 'getNodeStorage']);
    Route::get('/node/{node}/tasks', [ProxmoxController::class, 'getNodeTasks']);

    // Connection settings
    Route::get('/settings', [ProxmoxController::class, 'getSettings']);
    Route::post('/settings', [ProxmoxController::class, 'saveSettings'])->middleware('require.admin');

    // VM and Host controls (Admin only)
    Route::post('/vm/{node}/{vmid}/status/{action}', [ProxmoxController::class, 'controlVm'])->middleware('require.admin');
    Route::post('/node/{node}/status/{action}', [ProxmoxController::class, 'controlNode'])->middleware('require.admin');

    // MikroTik Router stats
    Route::get('/mikrotik/stats', [MikrotikController::class, 'getStats']);

    // Switches monitoring and SLA
    Route::get('/switches', [SwitchController::class, 'index']);
    Route::post('/switches', [SwitchController::class, 'store'])->middleware('require.admin');
    Route::delete('/switches/{id}', [SwitchController::class, 'destroy'])->middleware('require.admin');
    Route::get('/switches/sla', [SwitchController::class, 'slaIndex']);
    Route::post('/switches/sla/clear', [SwitchController::class, 'slaClear'])->middleware('require.admin');

    // User account management (Admin only)
    Route::get('/users', [UserController::class, 'index'])->middleware('require.admin');
    Route::post('/users', [UserController::class, 'store'])->middleware('require.admin');
    Route::delete('/users/{id}', [UserController::class, 'destroy'])->middleware('require.admin');

    // Compliance Audit log views (Admin only)
    Route::get('/audit-logs', [AuditLogController::class, 'index'])->middleware('require.admin');
    Route::post('/audit-logs/clear', [AuditLogController::class, 'clear'])->middleware('require.admin');
});
