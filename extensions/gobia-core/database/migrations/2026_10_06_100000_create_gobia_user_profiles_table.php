<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('gobia_user_profiles', function (Blueprint $table) {
            $table->unsignedInteger('user_id')->primary();
            $table->string('avatar_file', 64)->nullable();
            $table->string('theme', 8)->default('system');
            $table->json('recent_icon_colors')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('gobia_user_profiles');
    }
};
