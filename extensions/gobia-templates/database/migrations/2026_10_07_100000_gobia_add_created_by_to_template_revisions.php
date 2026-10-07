<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('gobia_template_revisions', function (Blueprint $table): void {
            // Who published the revision; null for revisions imported from 1.x or created by the system.
            $table->unsignedInteger('created_by')->nullable()->after('snapshot');
        });
    }

    public function down(): void
    {
        Schema::table('gobia_template_revisions', function (Blueprint $table): void {
            $table->dropColumn('created_by');
        });
    }
};
