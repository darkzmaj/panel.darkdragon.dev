<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * A user's own accent colour for the icon of a server. Purely cosmetic and per user: it never changes what anyone
     * else sees and is not consulted for access.
     */
    public function up(): void
    {
        Schema::create('user_server_icon_colors', function (Blueprint $table) {
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('server_id');
            $table->char('color', 7);

            $table->primary(['user_id', 'server_id']);
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_server_icon_colors');
    }
};
