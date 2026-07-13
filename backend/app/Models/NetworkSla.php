<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class NetworkSla extends Model
{
    protected $table = 'network_sla';
    protected $keyType = 'string';
    public $incrementing = false;
    protected $guarded = [];
}
