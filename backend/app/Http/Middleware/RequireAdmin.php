<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->input('user');
        if (!$user || $user->role !== 'admin') {
            return response()->json(['error' => 'Forbidden: Hak akses administrator diperlukan.'], 403);
        }
        return $next($request);
    }
}
