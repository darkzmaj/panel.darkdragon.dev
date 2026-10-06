<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('gobia_server_templates', function (Blueprint $table) {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->string('name', 80);
            $table->string('slug', 80)->unique();
            $table->string('description', 500)->nullable();
            $table->boolean('enabled')->default(true);
            // Application API (automation) may only use templates an administrator explicitly opened to it.
            $table->boolean('api_enabled')->default(false);
            $table->unsignedInteger('revision')->default(1);

            $table->unsignedInteger('egg_id');
            $table->string('docker_image', 191);
            $table->text('startup')->nullable();

            $table->unsignedInteger('memory');
            $table->integer('swap')->default(0);
            $table->unsignedInteger('disk');
            $table->unsignedInteger('cpu')->default(0);
            $table->unsignedSmallInteger('io')->default(500);
            $table->boolean('oom_disabled')->default(true);
            $table->unsignedInteger('database_limit')->nullable();
            $table->unsignedInteger('allocation_limit')->nullable();
            $table->unsignedInteger('backup_limit')->nullable();

            $table->string('placement_mode', 16)->default('any');
            $table->unsignedInteger('node_id')->nullable();
            $table->unsignedInteger('location_id')->nullable();
            $table->unsignedSmallInteger('additional_allocations')->default(0);
            $table->string('preferred_ports', 191)->nullable();
            $table->unsignedInteger('max_instances')->nullable();

            $table->boolean('start_automatically')->default(true);
            $table->boolean('temporary')->default(false);
            $table->unsignedInteger('ttl_minutes')->nullable();
            $table->boolean('allow_instance_delete')->default(true);

            $table->timestamp('published_at')->nullable();
            $table->timestamp('working_changed_at')->nullable();
            $table->timestamps();

            $table->foreign('egg_id')->references('id')->on('eggs')->restrictOnDelete();
            $table->foreign('node_id')->references('id')->on('nodes')->nullOnDelete();
            $table->foreign('location_id')->references('id')->on('locations')->nullOnDelete();
        });

        Schema::create('gobia_template_nodes', function (Blueprint $table) {
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('node_id');

            $table->primary(['template_id', 'node_id']);
            $table->foreign('template_id')->references('id')->on('gobia_server_templates')->cascadeOnDelete();
            $table->foreign('node_id')->references('id')->on('nodes')->cascadeOnDelete();
        });

        Schema::create('gobia_template_variables', function (Blueprint $table) {
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('egg_variable_id');
            $table->text('value')->nullable();
            // Whether an instance request may override the value. Everything else is fixed by the template.
            $table->boolean('overridable')->default(false);

            $table->primary(['template_id', 'egg_variable_id']);
            $table->foreign('template_id')->references('id')->on('gobia_server_templates')->cascadeOnDelete();
            $table->foreign('egg_variable_id')->references('id')->on('egg_variables')->cascadeOnDelete();
        });

        // Metadata for published files. Content lives in private storage addressed by checksum, so published files never change.
        Schema::create('gobia_template_files', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('template_id');
            $table->string('path', 255);
            $table->unsignedBigInteger('size');
            $table->char('sha256', 64);
            $table->timestamps();

            $table->unique(['template_id', 'path']);
            $table->foreign('template_id')->references('id')->on('gobia_server_templates')->cascadeOnDelete();
        });

        // Immutable snapshots: editing a template only affects instances created afterwards.
        Schema::create('gobia_template_revisions', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('revision');
            $table->longText('snapshot');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['template_id', 'revision']);
            $table->foreign('template_id')->references('id')->on('gobia_server_templates')->cascadeOnDelete();
        });

        Schema::create('gobia_template_instances', function (Blueprint $table) {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('template_revision');
            $table->unsignedInteger('server_id')->nullable();
            $table->unsignedInteger('owner_id');
            $table->unsignedInteger('api_key_id')->nullable();
            $table->string('name', 191);
            $table->string('state', 24)->default('queued');
            $table->string('failed_stage', 24)->nullable();
            $table->string('error', 500)->nullable();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->unsignedInteger('node_id')->nullable();
            $table->text('overrides')->nullable();
            $table->string('idempotency_key', 80)->nullable();
            $table->char('request_hash', 64)->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('state_changed_at')->nullable();
            $table->json('stage_ms')->nullable();
            $table->timestamps();

            $table->unique(['template_id', 'idempotency_key']);
            $table->index('state');
            $table->index('server_id');
            $table->foreign('template_id')->references('id')->on('gobia_server_templates')->restrictOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->nullOnDelete();
            $table->foreign('owner_id')->references('id')->on('users')->cascadeOnDelete();
        });

        Schema::create('gobia_template_sftp_credentials', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('created_by')->nullable();
            $table->string('label', 80)->nullable();
            $table->string('username', 32)->unique();
            $table->string('password_hash');
            $table->string('permission', 4)->default('rw');
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->string('last_used_ip', 45)->nullable();
            $table->timestamps();

            $table->foreign('template_id')->references('id')->on('gobia_server_templates')->cascadeOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('gobia_template_sftp_events', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('credential_id')->nullable();
            $table->unsignedInteger('template_id')->nullable();
            $table->string('username', 64)->nullable();
            $table->string('event', 24);
            $table->string('ip', 45)->nullable();
            $table->text('detail')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['credential_id', 'created_at']);
            $table->index(['ip', 'event', 'created_at']);
            $table->foreign('credential_id')->references('id')->on('gobia_template_sftp_credentials')->nullOnDelete();
            $table->foreign('template_id')->references('id')->on('gobia_server_templates')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('gobia_template_sftp_events');
        Schema::dropIfExists('gobia_template_sftp_credentials');
        Schema::dropIfExists('gobia_template_instances');
        Schema::dropIfExists('gobia_template_revisions');
        Schema::dropIfExists('gobia_template_files');
        Schema::dropIfExists('gobia_template_variables');
        Schema::dropIfExists('gobia_template_nodes');
        Schema::dropIfExists('gobia_server_templates');
    }
};
