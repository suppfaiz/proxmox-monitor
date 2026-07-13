<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // 1. Switches Table
        Schema::create('switches', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('ip');
            $table->string('status')->default('online');
            $table->integer('latency')->default(0);
            $table->string('lastDown')->nullable();
            $table->string('lastUp')->nullable();
            $table->timestamps();
        });

        // 2. Network SLA Alerts Table
        Schema::create('network_sla', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('type');
            $table->string('deviceName');
            $table->string('deviceIp');
            $table->string('timestamp');
            $table->string('formattedTime');
            $table->string('lastDown')->nullable();
            $table->string('duration')->nullable();
            $table->text('message');
            $table->timestamps();
        });

        // 3. Operations Audit Logs Table
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->string('timestamp');
            $table->string('username');
            $table->string('ip_address')->nullable();
            $table->string('action');
            $table->string('target')->nullable();
            $table->string('status');
            $table->text('message')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('switches');
        Schema::dropIfExists('network_sla');
        Schema::dropIfExists('audit_logs');
    }
};
