<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class UserController extends Controller
{
    public function index(Request $request)
    {
        $users = User::select('id', 'username', 'role')->get();
        return response()->json($users);
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string|regex:/^[a-zA-Z0-9_]{3,30}$/',
            'password' => 'required|string|min:6',
            'role' => 'required|string|in:admin,staff',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 400);
        }

        $username = $request->input('username');
        $role = $request->input('role');

        $exists = User::where('username', $username)->exists();
        if ($exists) {
            return response()->json(['error' => 'Username already exists'], 400);
        }

        User::create([
            'username' => $username,
            'password' => Hash::make($request->input('password')),
            'role' => $role,
        ]);

        $currentUser = $request->input('user');
        AuditLog::log($currentUser->username, 'create_user', $username, 'success', "Created user {$username} with role {$role}");

        return response()->json(['success' => true]);
    }

    public function destroy(Request $request, $id)
    {
        $user = User::find($id);
        if (!$user) {
            return response()->json(['error' => 'User not found'], 404);
        }

        if ($user->username === 'admin') {
            return response()->json(['error' => 'Cannot delete default admin user'], 400);
        }

        $currentUser = $request->input('user');
        if ($user->username === $currentUser->username) {
            return response()->json(['error' => 'Cannot delete self'], 400);
        }

        $user->delete();
        AuditLog::log($currentUser->username, 'delete_user', $user->username, 'success', "Deleted user {$user->username}");

        return response()->json(['success' => true]);
    }
}
