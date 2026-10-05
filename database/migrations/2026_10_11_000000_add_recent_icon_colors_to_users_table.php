<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * The five colours a user applied to server icons most recently, newest first, as a JSON list of #rrggbb values.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->json('recent_icon_colors')->nullable()->after('theme');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('recent_icon_colors');
        });
    }
};
