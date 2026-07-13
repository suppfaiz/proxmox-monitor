<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // 1. Seed Users
        DB::table('users')->insert([
            [
                'username' => 'admin',
                'password' => Hash::make('admin123'),
                'role' => 'admin',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'username' => 'staff',
                'password' => Hash::make('staff123'),
                'role' => 'staff',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        // 2. Seed Switches
        DB::table('switches')->insert([
            [
                'id' => 'sw-1',
                'name' => 'Core Switch 01',
                'ip' => '192.168.200.2',
                'status' => 'online',
                'latency' => 1,
                'lastDown' => null,
                'lastUp' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => 'sw-2',
                'name' => 'Access Switch 01',
                'ip' => '192.168.200.3',
                'status' => 'online',
                'latency' => 2,
                'lastDown' => null,
                'lastUp' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
    }
}
