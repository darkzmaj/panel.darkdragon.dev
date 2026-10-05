<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * Milliseconds spent in each provisioning stage, e.g. {"queued": 40, "allocating": 120, ...}, so slow stages can be found.
     */
    public function up(): void
    {
        Schema::table('server_template_instances', function (Blueprint $table) {
            $table->json('stage_ms')->nullable()->after('state_changed_at');
        });
    }

    public function down(): void
    {
        Schema::table('server_template_instances', function (Blueprint $table) {
            $table->dropColumn('stage_ms');
        });
    }
};
