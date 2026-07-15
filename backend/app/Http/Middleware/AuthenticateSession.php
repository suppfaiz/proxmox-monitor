<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateSession
{
    public function handle(Request $request, Closure $next): Response
    {
        $authHeader = $request->header('Authorization');
        if (!$authHeader || !str_starts_with($authHeader, 'Bearer ')) {
            return response()->json(['error' => 'Unauthorized: Harap login terlebih dahulu.'], 401);
        }

        $token = substr($authHeader, 7);
        $session = Cache::get("session:{$token}");

        if (!$session) {
            return response()->json(['error' => 'Unauthorized: Sesi tidak valid atau telah kedaluwarsa.'], 401);
        }

        // Attach user info to request
        $request->merge([
            'user' => (array)$session
        ]);

        return $next($request);
    }
}
