<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SwitchModel extends Model
{
    protected $table = 'switches';
    protected $keyType = 'string';
    public $incrementing = false;
    protected $guarded = [];
}
