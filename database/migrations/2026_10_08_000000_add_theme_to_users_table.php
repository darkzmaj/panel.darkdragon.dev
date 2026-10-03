<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * The interface theme a user picked (system, dark or light). Stored on the account so it follows the user between devices.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('theme', 8)->default('system')->after('language');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('theme');
        });
    }
};
