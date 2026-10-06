<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Per user, per server: position in the instance list and the chosen icon colour.
        Schema::create('gobia_server_preferences', function (Blueprint $table) {
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('position')->nullable();
            $table->char('icon_color', 7)->nullable();

            $table->primary(['user_id', 'server_id']);
            $table->index(['user_id', 'position']);
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
        });

        Schema::create('gobia_server_categories', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->string('name', 32);
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'name']);
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });

        Schema::create('gobia_server_category_members', function (Blueprint $table) {
            $table->unsignedInteger('category_id');
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('position')->default(0);

            $table->primary(['category_id', 'server_id']);
            $table->index('server_id');
            $table->foreign('category_id')->references('id')->on('gobia_server_categories')->cascadeOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('gobia_server_category_members');
        Schema::dropIfExists('gobia_server_categories');
        Schema::dropIfExists('gobia_server_preferences');
    }
};
