<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        $username = $request->input('username');
        $password = $request->input('password');

        $user = User::where('username', $username)->first();

        if (!$user) {
            AuditLog::log($username, 'login', 'portal', 'failure', 'User not found');
            return response()->json(['error' => 'Username atau password salah!'], 401);
        }

        if (!Hash::check($password, $user->password)) {
            AuditLog::log($username, 'login', 'portal', 'failure', 'Invalid password');
            return response()->json(['error' => 'Username atau password salah!'], 401);
        }

        $token = Str::random(64);
        Cache::put("session:{$token}", [
            'username' => $user->username,
            'role' => $user->role
        ], now()->addHours(12));

        AuditLog::log($user->username, 'login', 'portal', 'success', 'User logged in successfully');

        return response()->json([
            'success' => true,
            'token' => $token,
            'role' => $user->role,
            'username' => $user->username,
            'message' => 'Login sukses! Membuka dashboard...'
        ]);
    }
}
