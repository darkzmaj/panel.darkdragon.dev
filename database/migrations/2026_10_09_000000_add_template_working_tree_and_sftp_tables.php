<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        // Templates now have a working tree (edited in the browser or over SFTP) separate from the published,
        // immutable revisions. These record when files were last published and last changed in the working tree.
        Schema::table('server_templates', function (Blueprint $table) {
            $table->timestamp('published_at')->nullable()->after('allow_instance_delete');
            $table->timestamp('working_changed_at')->nullable()->after('published_at');
        });

        // Credentials for the template SFTP service. The secret is only ever stored as a hash.
        Schema::create('template_sftp_credentials', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('created_by')->nullable();
            $table->string('label', 80)->nullable();
            $table->string('username', 32)->unique();
            $table->string('password_hash');
            $table->string('permission', 4)->default('rw'); // rw | ro
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->string('last_used_ip', 45)->nullable();
            $table->timestamps();

            $table->foreign('template_id')->references('id')->on('server_templates')->cascadeOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('template_sftp_events', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('credential_id')->nullable();
            $table->unsignedInteger('template_id')->nullable();
            $table->string('username', 64)->nullable();
            $table->string('event', 24); // login, login_failed, rate_limited, session_end
            $table->string('ip', 45)->nullable();
            $table->text('detail')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['credential_id', 'created_at']);
            $table->index(['ip', 'event', 'created_at']);
            $table->foreign('credential_id')->references('id')->on('template_sftp_credentials')->nullOnDelete();
            $table->foreign('template_id')->references('id')->on('server_templates')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('template_sftp_events');
        Schema::dropIfExists('template_sftp_credentials');
        Schema::table('server_templates', function (Blueprint $table) {
            $table->dropColumn(['published_at', 'working_changed_at']);
        });
    }
};
