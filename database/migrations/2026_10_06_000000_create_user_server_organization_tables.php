<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * Per user ordering and categories for the server list. Rows only ever describe how one user
     * arranges servers; access is still decided by ownership and subusers, never by these tables.
     */
    public function up(): void
    {
        Schema::create('user_server_preferences', function (Blueprint $table) {
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('position');

            $table->primary(['user_id', 'server_id']);
            $table->index(['user_id', 'position']);
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
        });

        Schema::create('user_server_categories', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->string('name', 32);
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'name']);
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });

        Schema::create('user_server_category_members', function (Blueprint $table) {
            $table->unsignedInteger('category_id');
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('position');

            $table->primary(['category_id', 'server_id']);
            $table->index('server_id');
            $table->foreign('category_id')->references('id')->on('user_server_categories')->cascadeOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_server_category_members');
        Schema::dropIfExists('user_server_categories');
        Schema::dropIfExists('user_server_preferences');
    }
};
