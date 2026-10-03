@extends('layouts.admin')

@php
    $exists = $template->exists;
    // Value of a field: what was just submitted (after a validation error) or what is stored.
    $val = fn (string $key, $default = '') => old($key, $template->{$key} ?? $default);
    $checked = fn (string $key) => (bool) old($key, $template->{$key});
    $selectedAllowed = old('allowed_nodes', $allowedNodes);
@endphp

@section('title')
    Templates &rarr; {{ $exists ? $template->name : 'New' }}
@endsection

@section('content-header')
    <h1>{{ $exists ? $template->name : 'New Template' }}<small>{{ $exists ? 'Revision ' . $template->revision : 'Define a blueprint for new servers.' }}</small></h1>
    <ol class="breadcrumb">
        <li><a href="{{ route('admin.index') }}">Dashboard</a></li>
        <li><a href="{{ route('admin.templates') }}">Templates</a></li>
        <li class="active">{{ $exists ? $template->name : 'New' }}</li>
    </ol>
@endsection

@section('content')
<div class="nav-tabs-custom nav-tabs-floating">
    <ul class="nav nav-tabs" id="templateTabs">
        <li class="active"><a href="#tab-general" data-toggle="tab">General</a></li>
        <li><a href="#tab-software" data-toggle="tab">Software</a></li>
        <li><a href="#tab-resources" data-toggle="tab">Resources</a></li>
        <li><a href="#tab-placement" data-toggle="tab">Placement</a></li>
        <li><a href="#tab-variables" data-toggle="tab">Variables</a></li>
        <li><a href="#tab-files" data-toggle="tab">Files</a></li>
        <li><a href="#tab-lifecycle" data-toggle="tab">Lifecycle</a></li>
        @if($exists)
            <li><a href="#tab-instances" data-toggle="tab">Instances</a></li>
            <li><a href="#tab-revisions" data-toggle="tab">Revisions</a></li>
        @endif
    </ul>
</div>

<form id="templateForm" action="{{ $exists ? route('admin.templates.view', $template->id) : route('admin.templates.new') }}" method="POST">
    @if($exists) {{ method_field('PATCH') }} @endif
    {{ csrf_field() }}
    <div class="tab-content" style="padding: 0;">
        <div class="tab-pane active" id="tab-general">
            <div class="box box-primary">
                <div class="box-header with-border"><h3 class="box-title">General</h3></div>
                <div class="box-body">
                    <div class="row">
                        <div class="form-group col-md-6">
                            <label for="tName">Name</label>
                            <input type="text" id="tName" name="name" class="form-control" maxlength="80" value="{{ $val('name') }}" required>
                        </div>
                        <div class="form-group col-md-6">
                            <label for="tSlug">Identifier</label>
                            <input type="text" id="tSlug" name="slug" class="form-control" maxlength="80" value="{{ $val('slug') }}" placeholder="generated from the name">
                            <p class="small text-muted no-margin-bottom">Lowercase letters, numbers and dashes. Used by integrations.</p>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="tDescription">Description</label>
                        <textarea id="tDescription" name="description" class="form-control" rows="3" maxlength="500">{{ $val('description') }}</textarea>
                    </div>
                    <input type="hidden" name="enabled" value="0">
                    <div class="checkbox checkbox-primary no-margin-bottom">
                        <input type="checkbox" id="tEnabled" name="enabled" value="1" @if($checked('enabled')) checked @endif>
                        <label for="tEnabled">Enabled <span class="text-muted">&mdash; disabled templates cannot be used to create servers</span></label>
                    </div>
                </div>
            </div>
        </div>

        <div class="tab-pane" id="tab-software">
            <div class="box box-primary">
                <div class="box-header with-border"><h3 class="box-title">Software</h3></div>
                <div class="box-body">
                    <div class="row">
                        <div class="form-group col-md-6">
                            <label for="tNest">Nest</label>
                            <select id="tNest" name="nest_id" class="form-control"></select>
                        </div>
                        <div class="form-group col-md-6">
                            <label for="tEgg">Egg</label>
                            <select id="tEgg" name="egg_id" class="form-control"></select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="tImage">Docker image</label>
                        <select id="tImage" name="docker_image" class="form-control"></select>
                    </div>
                    <div class="form-group">
                        <label for="tStartup">Startup command override</label>
                        <textarea id="tStartup" name="startup" class="form-control" rows="3" placeholder="Leave empty to use the egg's startup command">{{ $val('startup') }}</textarea>
                        <p class="small text-muted no-margin-bottom">Fixed in the template. Instances created from it cannot change the startup command.</p>
                    </div>
                </div>
            </div>
        </div>

        <div class="tab-pane" id="tab-resources">
            <div class="box box-primary">
                <div class="box-header with-border"><h3 class="box-title">Resources</h3></div>
                <div class="box-body">
                    <div class="row">
                        <div class="form-group col-md-4"><label for="tMemory">Memory (MB)</label><input type="number" min="0" id="tMemory" name="memory" class="form-control" value="{{ $val('memory') }}" required></div>
                        <div class="form-group col-md-4"><label for="tSwap">Swap (MB)</label><input type="number" min="-1" id="tSwap" name="swap" class="form-control" value="{{ $val('swap', 0) }}" required><p class="small text-muted no-margin-bottom">-1 for unlimited.</p></div>
                        <div class="form-group col-md-4"><label for="tDisk">Disk (MB)</label><input type="number" min="0" id="tDisk" name="disk" class="form-control" value="{{ $val('disk') }}" required></div>
                    </div>
                    <div class="row">
                        <div class="form-group col-md-4"><label for="tCpu">CPU limit (%)</label><input type="number" min="0" id="tCpu" name="cpu" class="form-control" value="{{ $val('cpu', 0) }}" required><p class="small text-muted no-margin-bottom">0 for unlimited.</p></div>
                        <div class="form-group col-md-4"><label for="tIo">Block IO weight</label><input type="number" min="10" max="1000" id="tIo" name="io" class="form-control" value="{{ $val('io', 500) }}" required></div>
                        <div class="form-group col-md-4">
                            <label>Out of memory killer</label>
                            <input type="hidden" name="oom_disabled" value="0">
                            <div class="checkbox checkbox-primary no-margin-bottom"><input type="checkbox" id="tOom" name="oom_disabled" value="1" @if($checked('oom_disabled')) checked @endif><label for="tOom">Disable OOM killer</label></div>
                        </div>
                    </div>
                    <hr>
                    <div class="row">
                        <div class="form-group col-md-4"><label for="tDb">Database limit</label><input type="number" min="0" id="tDb" name="database_limit" class="form-control" value="{{ $val('database_limit', 0) }}"></div>
                        <div class="form-group col-md-4"><label for="tAl">Allocation limit</label><input type="number" min="0" id="tAl" name="allocation_limit" class="form-control" value="{{ $val('allocation_limit', 0) }}"></div>
                        <div class="form-group col-md-4"><label for="tBk">Backup limit</label><input type="number" min="0" id="tBk" name="backup_limit" class="form-control" value="{{ $val('backup_limit', 0) }}"></div>
                    </div>
                </div>
            </div>
        </div>

        <div class="tab-pane" id="tab-placement">
            <div class="box box-primary">
                <div class="box-header with-border"><h3 class="box-title">Placement</h3></div>
                <div class="box-body">
                    <div class="form-group">
                        <label for="tMode">Where can instances run?</label>
                        <select id="tMode" name="placement_mode" class="form-control">
                            <option value="fixed_node" @if($val('placement_mode') === 'fixed_node') selected @endif>On one specific node</option>
                            <option value="allowed_nodes" @if($val('placement_mode') === 'allowed_nodes') selected @endif>On any of the nodes I choose</option>
                            <option value="any" @if($val('placement_mode') === 'any') selected @endif>On any compatible node</option>
                        </select>
                        <p class="small text-muted no-margin-bottom">The best node is chosen by free memory, disk and allocations. Offline and maintenance nodes are never used.</p>
                    </div>
                    <div class="form-group" data-mode="fixed_node">
                        <label for="tNode">Node</label>
                        <select id="tNode" name="node_id" class="form-control">
                            <option value="">Select a node…</option>
                            @foreach($nodes as $node)
                                <option value="{{ $node->id }}" @if((string) $val('node_id') === (string) $node->id) selected @endif>{{ $node->name }}</option>
                            @endforeach
                        </select>
                    </div>
                    <div class="form-group" data-mode="allowed_nodes">
                        <label for="tAllowed">Allowed nodes</label>
                        <select id="tAllowed" name="allowed_nodes[]" class="form-control" multiple size="6">
                            @foreach($nodes as $node)
                                <option value="{{ $node->id }}" @if(in_array($node->id, array_map('intval', (array) $selectedAllowed), true)) selected @endif>{{ $node->name }}</option>
                            @endforeach
                        </select>
                    </div>
                    <div class="form-group" data-mode="allowed_nodes any">
                        <label for="tLocation">Limit to location</label>
                        <select id="tLocation" name="location_id" class="form-control">
                            <option value="">Any location</option>
                            @foreach($locations as $location)
                                <option value="{{ $location->id }}" @if((string) $val('location_id') === (string) $location->id) selected @endif>{{ $location->short }}</option>
                            @endforeach
                        </select>
                    </div>
                    <hr>
                    <div class="row">
                        <div class="form-group col-md-4">
                            <label for="tExtra">Additional allocations</label>
                            <input type="number" min="0" max="50" id="tExtra" name="additional_allocations" class="form-control" value="{{ $val('additional_allocations', 0) }}">
                        </div>
                        <div class="form-group col-md-8">
                            <label for="tPorts">Preferred ports</label>
                            <input type="text" id="tPorts" name="preferred_ports" class="form-control" value="{{ $val('preferred_ports') }}" placeholder="25565, 25570-25580">
                            <p class="small text-muted no-margin-bottom">Free allocations on these ports are used first, then the lowest free port.</p>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="tMax">Maximum instances</label>
                        <input type="number" min="1" id="tMax" name="max_instances" class="form-control" value="{{ $val('max_instances') }}" placeholder="No limit">
                    </div>
                </div>
            </div>
        </div>

        <div class="tab-pane" id="tab-variables">
            <div class="box box-primary">
                <div class="box-header with-border"><h3 class="box-title">Variables</h3></div>
                <div class="box-body table-responsive no-padding">
                    <table class="table table-hover" id="variablesTable">
                        <thead><tr><th>Variable</th><th>Value</th><th class="text-center">Instances may override</th></tr></thead>
                        <tbody></tbody>
                    </table>
                    <p id="noVariables" class="text-muted" style="padding: 16px; display: none;">The selected software has no variables.</p>
                </div>
            </div>
        </div>

        <div class="tab-pane" id="tab-lifecycle">
            <div class="box box-primary">
                <div class="box-header with-border"><h3 class="box-title">Lifecycle</h3></div>
                <div class="box-body">
                    <input type="hidden" name="start_automatically" value="0">
                    <div class="checkbox checkbox-primary"><input type="checkbox" id="tStart" name="start_automatically" value="1" @if($checked('start_automatically')) checked @endif><label for="tStart">Start automatically once files are in place</label></div>
                    <input type="hidden" name="temporary" value="0">
                    <div class="checkbox checkbox-primary"><input type="checkbox" id="tTemp" name="temporary" value="1" @if($checked('temporary')) checked @endif><label for="tTemp">Temporary instances (removed automatically)</label></div>
                    <div class="form-group" style="max-width: 280px;">
                        <label for="tTtl">Time to live (minutes)</label>
                        <input type="number" min="1" id="tTtl" name="ttl_minutes" class="form-control" value="{{ $val('ttl_minutes') }}" placeholder="Never expires">
                    </div>
                    <input type="hidden" name="allow_instance_delete" value="0">
                    <div class="checkbox checkbox-primary no-margin-bottom"><input type="checkbox" id="tDel" name="allow_instance_delete" value="1" @if($checked('allow_instance_delete')) checked @endif><label for="tDel">Allow the API to delete instances <span class="text-muted">&mdash; a safeguard; deleting still needs the delete permission</span></label></div>
                </div>
            </div>
        </div>
    </div>

    <div class="box box-primary" id="templateActions">
        <div class="box-footer">
            <button type="submit" class="btn btn-success btn-sm pull-right">{{ $exists ? 'Save Changes' : 'Create Template' }}</button>
            @if($exists)
                <span class="text-muted small" style="line-height: 30px;">Saving creates a new revision. Servers that already exist keep the revision they were created from.</span>
            @endif
        </div>
    </div>
</form>

<div class="tab-content" style="padding: 0;">
    <div class="tab-pane" id="tab-files" style="display: none;" data-pane-for="files"></div>
</div>

@if($exists)
    <div class="row" id="templateExtra">
        <div class="col-xs-12">
            <div class="tab-content" style="padding: 0;">
                <div class="tab-pane" id="tab-instances" data-extra>
                    <div class="box box-primary">
                        <div class="box-header with-border"><h3 class="box-title">Create Instance</h3></div>
                        <form action="{{ route('admin.templates.instances', $template->id) }}" method="POST">
                            {{ csrf_field() }}
                            <div class="box-body">
                                @if(!$template->enabled)
                                    <div class="alert alert-warning no-margin-bottom">This template is disabled. Enable it to create instances.</div>
                                @else
                                    <div class="row">
                                        <div class="form-group col-md-6"><label for="iName">Server name</label><input type="text" id="iName" name="name" class="form-control" maxlength="191" required></div>
                                        <div class="form-group col-md-6">
                                            <label for="iOwner">Owner</label>
                                            <select id="iOwner" name="owner_id" class="form-control" required>
                                                @foreach($users as $user)
                                                    <option value="{{ $user->id }}" @if($user->id === auth()->id()) selected @endif>{{ $user->username }} ({{ $user->email }})</option>
                                                @endforeach
                                            </select>
                                        </div>
                                    </div>
                                    <div class="form-group no-margin-bottom"><label for="iDesc">Description</label><input type="text" id="iDesc" name="description" class="form-control" maxlength="255"></div>
                                @endif
                            </div>
                            @if($template->enabled)
                                <div class="box-footer"><button type="submit" class="btn btn-primary btn-sm pull-right">Queue Instance</button></div>
                            @endif
                        </form>
                    </div>
                    <div class="box box-primary">
                        <div class="box-header with-border"><h3 class="box-title">Recent Instances</h3></div>
                        <div class="box-body table-responsive no-padding">
                            <table class="table table-hover">
                                <tbody>
                                    <tr><th>Name</th><th>Revision</th><th>State</th><th>Server</th><th>Details</th><th></th></tr>
                                    @forelse($instances as $instance)
                                        <tr data-instance="{{ $instance->uuid }}" data-finished="{{ $instance->isFinished() ? 1 : 0 }}">
                                            <td>{{ $instance->name }}</td>
                                            <td>r{{ $instance->template_revision }}</td>
                                            <td><span class="label label-{{ $instance->state === 'ready' ? 'success' : ($instance->state === 'failed' ? 'danger' : 'info') }}" data-state>{{ str_replace('_', ' ', $instance->state) }}</span></td>
                                            <td>@if($instance->server)<a href="{{ route('admin.servers.view', $instance->server->id) }}">{{ $instance->server->name }}</a>@else <span class="text-muted">&mdash;</span>@endif</td>
                                            <td class="small" data-error>@if($instance->error){{ $instance->failed_stage }}: {{ $instance->error }}@endif</td>
                                            <td class="text-right">
                                                @if($instance->state === 'failed')
                                                    <form action="{{ route('admin.templates.instances.retry', [$template->id, $instance->uuid]) }}" method="POST" style="display:inline">{{ csrf_field() }}<button class="btn btn-xs btn-default">Retry</button></form>
                                                @endif
                                            </td>
                                        </tr>
                                    @empty
                                        <tr><td colspan="6" class="text-center text-muted" style="padding: 20px;">No instances have been created from this template.</td></tr>
                                    @endforelse
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="tab-pane" id="tab-revisions" data-extra>
                    <div class="box box-primary">
                        <div class="box-header with-border"><h3 class="box-title">Revisions</h3></div>
                        <div class="box-body table-responsive no-padding">
                            <table class="table table-hover">
                                <tbody>
                                    <tr><th>Revision</th><th>Created</th></tr>
                                    @foreach($revisions as $revision)
                                        <tr><td>r{{ $revision->revision }} @if($revision->revision === $template->revision)<span class="label label-primary">current</span>@endif</td><td>{{ $revision->created_at }}</td></tr>
                                    @endforeach
                                </tbody>
                            </table>
                        </div>
                        <div class="box-footer">
                            <form action="{{ route('admin.templates.duplicate', $template->id) }}" method="POST" style="display:inline">{{ csrf_field() }}<button class="btn btn-sm btn-default">Duplicate</button></form>
                            <form action="{{ route('admin.templates.toggle', $template->id) }}" method="POST" style="display:inline">{{ csrf_field() }}<button class="btn btn-sm btn-warning">{{ $template->enabled ? 'Disable' : 'Enable' }}</button></form>
                            <form action="{{ route('admin.templates.view', $template->id) }}" method="POST" style="display:inline" onsubmit="return confirm('Delete this template? This cannot be undone.');">{{ method_field('DELETE') }}{{ csrf_field() }}<button class="btn btn-sm btn-danger pull-right">Delete</button></form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endif
@endsection

@section('footer-scripts')
    @parent
    <script>
        (function () {
            var catalog = @json($catalog);
            var stored = @json((object) $storedVariables);
            var current = {
                nest: {{ (int) old('nest_id', $template->nest_id ?? 0) }},
                egg: {{ (int) old('egg_id', $template->egg_id ?? 0) }},
                image: @json((string) old('docker_image', $template->docker_image ?? ''))
            };
            var oldVars = @json((object) (old('variables') ?? []));
            var $nest = $('#tNest'), $egg = $('#tEgg'), $image = $('#tImage');

            function fill($select, items, selected, label) {
                $select.empty();
                items.forEach(function (item) {
                    $select.append($('<option>').val(item.value).text(item.label).prop('selected', String(item.value) === String(selected)));
                });
                if (!items.length) { $select.append($('<option>').val('').text(label)); }
            }
            function nestEntry() { return catalog.find(function (n) { return n.id === parseInt($nest.val(), 10); }); }
            function eggEntry() { var n = nestEntry(); return n && n.eggs.find(function (e) { return e.id === parseInt($egg.val(), 10); }); }

            function renderVariables() {
                var egg = eggEntry(), $body = $('#variablesTable tbody').empty();
                var rows = (egg && egg.variables) || [];
                $('#noVariables').toggle(!rows.length);
                rows.forEach(function (v) {
                    var s = oldVars[v.env] || stored[v.env] || {};
                    var value = s.value !== undefined && s.value !== null ? s.value : '';
                    var $tr = $('<tr>');
                    $tr.append($('<td>').append($('<strong>').text(v.name)).append('<br>').append($('<code>').text(v.env)));
                    $tr.append($('<td>').append($('<input type="text" class="form-control">').attr('name', 'variables[' + v.env + '][value]').attr('placeholder', v.default || '').val(value)));
                    var $box = $('<div class="checkbox checkbox-primary no-margin-bottom" style="display:inline-block">');
                    var id = 'ov_' + v.env;
                    $box.append($('<input type="hidden">').attr('name', 'variables[' + v.env + '][overridable]').val('0'));
                    $box.append($('<input type="checkbox" value="1">').attr({ id: id, name: 'variables[' + v.env + '][overridable]' }).prop('checked', !!(s.overridable && s.overridable !== '0')));
                    $box.append($('<label>').attr('for', id));
                    $tr.append($('<td class="text-center">').append($box));
                    $body.append($tr);
                });
            }
            function renderImages() {
                var egg = eggEntry();
                fill($image, ((egg && egg.images) || []).map(function (i) { return { value: i, label: i }; }), current.image, 'No images');
            }
            function renderEggs() {
                var n = nestEntry();
                fill($egg, (n ? n.eggs : []).map(function (e) { return { value: e.id, label: e.name }; }), current.egg, 'No eggs');
                renderImages(); renderVariables();
            }
            fill($nest, catalog.map(function (n) { return { value: n.id, label: n.name }; }), current.nest, 'No nests');
            renderEggs();
            $nest.on('change', function () { current.egg = 0; renderEggs(); });
            $egg.on('change', function () { current.image = ''; renderImages(); renderVariables(); });

            function toggleMode() {
                var mode = $('#tMode').val();
                $('[data-mode]').each(function () { $(this).toggle($(this).attr('data-mode').split(' ').indexOf(mode) !== -1); });
            }
            $('#tMode').on('change', toggleMode); toggleMode();

            // The form tabs, the files editor and the extra panes share one tab strip.
            function showPane(hash) {
                var isForm = $('#templateForm .tab-pane' + hash).length > 0;
                var isFiles = hash === '#tab-files', isExtra = $('[data-extra]' + hash).length > 0;
                $('#templateForm').toggle(!isFiles && !isExtra);
                $('#templateForm .tab-pane').removeClass('active').filter(hash).addClass('active');
                $('#templateActions').toggle(isForm);
                $('[data-extra]').removeClass('active').filter(hash).addClass('active');
                $('#tab-files').toggle(isFiles).toggleClass('active', isFiles);
                if (isFiles) { window.dispatchEvent(new Event('template-files-shown')); }
            }
            $('#templateTabs a[data-toggle=tab]').on('shown.bs.tab', function (e) { showPane($(e.target).attr('href')); });
            $('#templateTabs a[data-toggle=tab]').on('click', function () { showPane($(this).attr('href')); });
            $('#templateForm').on('submit', function () { $('#templateForm .tab-pane').addClass('active'); });

            // Live progress for instances that are still being provisioned.
            var statusUrl = @json($exists ? url('/admin/templates/view/' . $template->id . '/instances') : '');
            function poll() {
                $('tr[data-instance][data-finished="0"]').each(function () {
                    var $tr = $(this);
                    $.getJSON(statusUrl + '/' + $tr.data('instance'), function (s) {
                        $tr.find('[data-state]').text(String(s.state).replace('_', ' ')).attr('class', 'label label-' + (s.state === 'ready' ? 'success' : (s.state === 'failed' ? 'danger' : 'info')));
                        if (s.error) { $tr.find('[data-error]').text((s.failed_stage || '') + ': ' + s.error); }
                        if (s.finished) { $tr.attr('data-finished', '1'); }
                    });
                });
            }
            if (statusUrl) { setInterval(poll, 4000); }
        })();
    </script>

    @if($exists)
        <div id="template-file-editor"
             data-list-url="{{ route('admin.templates.files', $template->id) }}"
             data-read-url="{{ route('admin.templates.files.read', $template->id) }}"
             data-write-url="{{ route('admin.templates.files.write', $template->id) }}"
             data-delete-url="{{ route('admin.templates.files.delete', $template->id) }}"
             data-csrf="{{ csrf_token() }}" style="display:none"></div>
        {!! app(\Pterodactyl\Services\Helpers\AssetHashService::class)->js('template-editor.js') !!}
    @else
        <script>$('#templateTabs a[href="#tab-files"]').parent().addClass('disabled').find('a').attr('title', 'Save the template first, then add files.').on('click', function (e) { e.preventDefault(); e.stopImmediatePropagation(); return false; });</script>
    @endif
@endsection
