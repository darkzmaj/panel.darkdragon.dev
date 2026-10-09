<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A Storage Box (or sub account) backups are written to. Secrets are stored encrypted with the Panel key.
        Schema::create('gobia_backup_destinations', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name', 80)->unique();
            $table->string('type', 16)->default('storagebox');
            $table->string('host', 191);
            $table->unsignedSmallInteger('port')->default(23);
            $table->string('username', 64);
            $table->text('private_key')->nullable();
            $table->text('password')->nullable();
            // SHA256:<base64> of the server's host key. A connection is refused when the key differs.
            $table->string('host_key_fingerprint', 80);
            $table->string('base_path', 191)->default('gobia-backups');
            $table->boolean('encrypt')->default(true);
            $table->text('encryption_key')->nullable();
            $table->boolean('enabled')->default(true);
            $table->timestamp('last_checked_at')->nullable();
            $table->string('last_error', 500)->nullable();
            $table->timestamps();
        });

        // What should be backed up, when and for how long. One row per scope; a server row overrides its node's row,
        // which overrides the global row, field by field (null means "inherit").
        Schema::create('gobia_backup_policies', function (Blueprint $table) {
            $table->increments('id');
            $table->string('scope', 8);
            $table->unsignedInteger('node_id')->nullable();
            $table->unsignedInteger('server_id')->nullable();
            $table->unsignedInteger('destination_id')->nullable();
            $table->boolean('enabled')->nullable();
            $table->string('cron', 64)->nullable();
            $table->string('timezone', 64)->nullable();
            // Minutes after midnight in the policy's timezone between which a scheduled backup may start.
            $table->unsignedSmallInteger('window_start')->nullable();
            $table->unsignedSmallInteger('window_end')->nullable();
            $table->unsignedSmallInteger('keep_last')->nullable();
            $table->unsignedSmallInteger('keep_days')->nullable();
            $table->json('ignored')->nullable();
            // Also copy the backups people make themselves in the Panel.
            $table->boolean('mirror_user_backups')->nullable();
            $table->timestamps();

            $table->unique(['scope', 'node_id', 'server_id'], 'gobia_backup_policies_scope_unique');
            $table->foreign('destination_id')->references('id')->on('gobia_backup_destinations')->nullOnDelete();
            $table->foreign('node_id')->references('id')->on('nodes')->cascadeOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
        });

        // One offsite backup of one server. The server may be deleted later: the uuid and name stay so the backup can
        // still be found and restored somewhere else.
        Schema::create('gobia_backup_runs', function (Blueprint $table) {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->unsignedInteger('server_id')->nullable();
            $table->char('server_uuid', 36);
            $table->string('server_name', 191);
            $table->unsignedInteger('node_id')->nullable();
            $table->unsignedInteger('destination_id');
            // The Panel backup Wings builds the archive for. Removed from the node once the copy is verified.
            $table->char('backup_uuid', 36)->nullable()->index();
            $table->string('trigger', 16);
            $table->unsignedInteger('requested_by')->nullable();
            $table->string('state', 16)->index();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->boolean('keep_local')->default(false);
            $table->boolean('encrypted')->default(false);
            $table->string('remote_path', 255)->nullable();
            // Size and SHA-256 of the archive Wings produced, and of the object stored on the Storage Box.
            $table->unsignedBigInteger('bytes')->default(0);
            $table->char('archive_sha256', 64)->nullable();
            $table->unsignedBigInteger('stored_bytes')->default(0);
            $table->char('stored_sha256', 64)->nullable();
            $table->unsignedBigInteger('transferred_bytes')->default(0);
            $table->string('verified_by', 16)->nullable();
            $table->string('error', 500)->nullable();
            $table->timestamp('retry_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('heartbeat_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['server_uuid', 'state']);
            $table->foreign('destination_id')->references('id')->on('gobia_backup_destinations')->restrictOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->nullOnDelete();
        });

        // One restore of an offsite backup into a server.
        Schema::create('gobia_backup_restores', function (Blueprint $table) {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->unsignedInteger('run_id');
            $table->unsignedInteger('server_id');
            // The placeholder Panel backup Wings reports the restore against. Removed when the restore ends.
            $table->char('backup_uuid', 36)->unique();
            $table->unsignedInteger('requested_by')->nullable();
            $table->boolean('truncate')->default(false);
            $table->string('state', 16)->index();
            $table->unsignedBigInteger('transferred_bytes')->default(0);
            $table->string('error', 500)->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->foreign('run_id')->references('id')->on('gobia_backup_runs')->cascadeOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('gobia_backup_restores');
        Schema::dropIfExists('gobia_backup_runs');
        Schema::dropIfExists('gobia_backup_policies');
        Schema::dropIfExists('gobia_backup_destinations');
    }
};
