<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * Server templates are admin-defined blueprints that new servers can be created from.
     * They are distinct from eggs: an egg describes software, a template combines an egg with
     * resources, placement rules, variables, files and lifecycle settings.
     */
    public function up(): void
    {
        Schema::create('server_templates', function (Blueprint $table) {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->string('name', 80);
            $table->string('slug', 80)->unique();
            $table->string('description', 500)->nullable();
            $table->boolean('enabled')->default(true);
            $table->unsignedInteger('revision')->default(1);

            // Software
            $table->unsignedInteger('nest_id');
            $table->unsignedInteger('egg_id');
            $table->string('docker_image', 191);
            $table->text('startup')->nullable();

            // Resources
            $table->unsignedInteger('memory');
            $table->unsignedInteger('swap')->default(0);
            $table->unsignedInteger('disk');
            $table->unsignedInteger('cpu')->default(0);
            $table->unsignedSmallInteger('io')->default(500);
            $table->boolean('oom_disabled')->default(true);
            $table->unsignedInteger('database_limit')->nullable();
            $table->unsignedInteger('allocation_limit')->nullable();
            $table->unsignedInteger('backup_limit')->nullable();

            // Placement
            $table->string('placement_mode', 16)->default('any'); // fixed_node | allowed_nodes | any
            $table->unsignedInteger('node_id')->nullable();
            $table->unsignedInteger('location_id')->nullable();
            $table->unsignedSmallInteger('additional_allocations')->default(0);
            $table->string('preferred_ports', 191)->nullable();
            $table->unsignedInteger('max_instances')->nullable();

            // Lifecycle
            $table->boolean('start_automatically')->default(true);
            $table->boolean('temporary')->default(false);
            $table->unsignedInteger('ttl_minutes')->nullable();
            $table->boolean('allow_instance_delete')->default(true);

            $table->timestamps();

            $table->foreign('nest_id')->references('id')->on('nests')->restrictOnDelete();
            $table->foreign('egg_id')->references('id')->on('eggs')->restrictOnDelete();
            $table->foreign('node_id')->references('id')->on('nodes')->nullOnDelete();
            $table->foreign('location_id')->references('id')->on('locations')->nullOnDelete();
        });

        Schema::create('server_template_nodes', function (Blueprint $table) {
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('node_id');

            $table->primary(['template_id', 'node_id']);
            $table->foreign('template_id')->references('id')->on('server_templates')->cascadeOnDelete();
            $table->foreign('node_id')->references('id')->on('nodes')->cascadeOnDelete();
        });

        Schema::create('server_template_variables', function (Blueprint $table) {
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('egg_variable_id');
            $table->text('value')->nullable();
            // Whether an instance request may override the value. Everything else is fixed by the template.
            $table->boolean('overridable')->default(false);

            $table->primary(['template_id', 'egg_variable_id']);
            $table->foreign('template_id')->references('id')->on('server_templates')->cascadeOnDelete();
            $table->foreign('egg_variable_id')->references('id')->on('egg_variables')->cascadeOnDelete();
        });

        // Metadata for files deployed into new instances. The content lives in private storage,
        // addressed by checksum, so a revision's files never change after they are written.
        Schema::create('server_template_files', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('template_id');
            $table->string('path', 255);
            $table->unsignedInteger('size');
            $table->char('sha256', 64);
            $table->timestamps();

            $table->unique(['template_id', 'path']);
            $table->foreign('template_id')->references('id')->on('server_templates')->cascadeOnDelete();
        });

        // Immutable snapshots. A server remembers which revision created it; editing a template
        // only affects instances created afterwards.
        Schema::create('server_template_revisions', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('revision');
            $table->longText('snapshot');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['template_id', 'revision']);
            $table->foreign('template_id')->references('id')->on('server_templates')->cascadeOnDelete();
        });

        Schema::create('server_template_instances', function (Blueprint $table) {
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
            $table->timestamps();

            $table->unique(['template_id', 'idempotency_key']);
            $table->index('state');
            $table->foreign('template_id')->references('id')->on('server_templates')->restrictOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->nullOnDelete();
            $table->foreign('owner_id')->references('id')->on('users')->cascadeOnDelete();
        });

        Schema::table('servers', function (Blueprint $table) {
            $table->unsignedInteger('template_id')->nullable()->after('egg_id');
            $table->unsignedInteger('template_revision')->nullable()->after('template_id');

            $table->foreign('template_id')->references('id')->on('server_templates')->nullOnDelete();
        });

        Schema::table('api_keys', function (Blueprint $table) {
            $table->unsignedTinyInteger('r_templates')->default(0);
            $table->unsignedTinyInteger('r_template_instance_create')->default(0);
            $table->unsignedTinyInteger('r_template_instance_delete')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('api_keys', function (Blueprint $table) {
            $table->dropColumn(['r_templates', 'r_template_instance_create', 'r_template_instance_delete']);
        });

        Schema::table('servers', function (Blueprint $table) {
            $table->dropForeign(['template_id']);
            $table->dropColumn(['template_id', 'template_revision']);
        });

        Schema::dropIfExists('server_template_instances');
        Schema::dropIfExists('server_template_revisions');
        Schema::dropIfExists('server_template_files');
        Schema::dropIfExists('server_template_variables');
        Schema::dropIfExists('server_template_nodes');
        Schema::dropIfExists('server_templates');
    }
};
