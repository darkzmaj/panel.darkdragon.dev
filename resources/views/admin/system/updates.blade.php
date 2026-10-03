@extends('layouts.admin')

@section('title')
    Updates
@endsection

@section('content-header')
    <h1>Panel Updates<small>Install published releases of this Panel.</small></h1>
    <ol class="breadcrumb">
        <li><a href="{{ route('admin.index') }}">Dashboard</a></li>
        <li>System</li>
        <li class="active">Updates</li>
    </ol>
@endsection

@section('content')
    @include('partials.admin.section-tabs', ['section' => 'settings', 'active' => 'updates'])
    <div class="row">
        <div class="col-md-6">
            <div class="box" id="update-box">
                <div class="box-header with-border">
                    <h3 class="box-title">Version</h3>
                </div>
                <div class="box-body">
                    <table class="table table-condensed" style="margin-bottom:0;">
                        <tr><td style="width:40%;">Current Panel version</td><td><code id="u-current"></code></td></tr>
                        <tr><td>Upstream base</td><td id="u-upstream"></td></tr>
                        <tr><td>Latest available</td><td id="u-latest"></td></tr>
                        <tr><td>Status</td><td id="u-status"></td></tr>
                        <tr><td>Release date</td><td id="u-date"></td></tr>
                        <tr><td>Package size</td><td id="u-size"></td></tr>
                        <tr><td>Includes migrations</td><td id="u-migrations"></td></tr>
                        <tr><td>Requires service restart</td><td id="u-restart"></td></tr>
                        <tr><td>Last checked</td><td id="u-checked"></td></tr>
                    </table>
                </div>
                <div class="box-footer">
                    <button type="button" class="btn btn-sm btn-default" id="u-check"><i class="fa fa-refresh"></i> Check for Updates</button>
                    <button type="button" class="btn btn-sm btn-primary pull-right" id="u-update" disabled>Update Now</button>
                </div>
            </div>
            <div class="box" id="u-notes-box" style="display:none;">
                <div class="box-header with-border">
                    <h3 class="box-title">Release notes</h3>
                </div>
                <div class="box-body"><pre id="u-notes" style="white-space:pre-wrap;word-break:break-word;border:0;background:none;padding:0;margin:0;"></pre></div>
            </div>
        </div>
        <div class="col-md-6">
            <div class="box" id="u-progress-box" style="display:none;">
                <div class="box-header with-border">
                    <h3 class="box-title" id="u-progress-title">Update progress</h3>
                </div>
                <div class="box-body">
                    <div class="progress" style="margin-bottom:10px;"><div class="progress-bar progress-bar-primary" id="u-bar" style="width:0%"></div></div>
                    <ul class="list-unstyled" id="u-steps" style="margin:0;"></ul>
                    <p class="text-danger" id="u-error" style="margin-top:10px;display:none;"></p>
                </div>
            </div>
            <div class="box">
                <div class="box-header with-border">
                    <h3 class="box-title">History</h3>
                </div>
                <div class="box-body table-responsive no-padding">
                    <table class="table table-hover">
                        <thead><tr><th>Started (UTC)</th><th>From</th><th>To</th><th>Result</th><th></th></tr></thead>
                        <tbody id="u-history"></tbody>
                    </table>
                </div>
            </div>
            <div class="box" id="u-log-box" style="display:none;">
                <div class="box-header with-border">
                    <h3 class="box-title">Updater log <small id="u-log-id"></small></h3>
                </div>
                <div class="box-body"><pre id="u-log" style="max-height:300px;overflow:auto;font-size:12px;"></pre></div>
            </div>
        </div>
    </div>
@endsection

@section('footer-scripts')
    @parent
    <script>
        (function () {
            var urls = {
                status: @json(route('admin.system.updates.status')),
                check: @json(route('admin.system.updates.check')),
                start: @json(route('admin.system.updates.start')),
                run: @json(url('/admin/system/updates/runs')),
                progress: @json(route('system.update-progress'))
            };
            var csrf = @json(csrf_token());
            var state = @json($status);
            var timer = null;

            function $id(id) { return document.getElementById(id); }
            function text(id, value) { $id(id).textContent = value; }
            function request(method, url) {
                return fetch(url, { method: method, credentials: 'same-origin', headers: { 'Accept': 'application/json', 'X-CSRF-TOKEN': csrf, 'X-Requested-With': 'XMLHttpRequest' } })
                    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
            }
            function bytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }

            var STEP_ICON = { pending: 'fa-circle-o text-muted', running: 'fa-spinner fa-spin text-primary', done: 'fa-check text-green', failed: 'fa-times text-red', skipped: 'fa-minus text-muted' };

            function render() {
                var latest = state.latest && state.latest.release;
                var active = state.active;
                text('u-current', state.current);
                text('u-upstream', 'Pterodactyl ' + state.upstream);
                text('u-latest', latest ? latest.version : (state.latest ? 'none published' : 'not checked yet'));
                var status = 'Not checked';
                if (active) { status = 'Update in progress'; }
                else if (state.latest && state.latest.error) { status = 'Check failed'; }
                else if (state.latest && state.latest.available) { status = 'Update available'; }
                else if (state.latest) { status = 'Up to date'; }
                text('u-status', status);
                text('u-date', latest && latest.published_at ? new Date(latest.published_at).toLocaleString() : '-');
                text('u-size', latest ? bytes(latest.size) : '-');
                text('u-migrations', latest ? (latest.migrations ? 'Yes' : 'No') : '-');
                text('u-restart', latest ? (latest.requires_restart ? 'Yes' : 'No') : '-');
                text('u-checked', state.latest ? new Date(state.latest.checked_at).toLocaleString() : '-');

                var err = state.latest && state.latest.error;
                $id('u-notes-box').style.display = latest && latest.notes ? '' : 'none';
                text('u-notes', latest ? latest.notes : '');
                $id('u-update').disabled = !(state.latest && state.latest.available && !active);
                $id('u-update').textContent = latest && state.latest.available ? 'Update to ' + latest.version : 'Update Now';
                if (err && !active) { showError('Update check failed: ' + err); }

                renderRun(active || (state.history && state.history[0] && isRecent(state.history[0]) ? state.history[0] : null));
                renderHistory();
            }

            function isRecent(run) { return !run.finished_at || (Date.now() - Date.parse(run.finished_at)) < 600000; }

            function renderRun(run) {
                $id('u-progress-box').style.display = run ? '' : 'none';
                if (!run) { return; }
                var done = 0;
                var list = $id('u-steps');
                list.innerHTML = '';
                run.steps.forEach(function (step) {
                    if (step.status === 'done') { done++; }
                    var li = document.createElement('li');
                    var icon = document.createElement('i');
                    icon.className = 'fa fa-fw ' + STEP_ICON[step.status];
                    li.appendChild(icon);
                    li.appendChild(document.createTextNode(' ' + step.label));
                    list.appendChild(li);
                });
                $id('u-bar').style.width = Math.round(done / run.steps.length * 100) + '%';
                var title = 'Update to ' + run.to_version;
                if (run.state === 'completed') { title += ' - completed'; }
                else if (run.state === 'rolling_back') { title += ' - rolling back'; }
                else if (run.state === 'failed') { title += ' - ' + (run.result === 'rolled_back' ? 'failed, rolled back' : 'failed'); }
                text('u-progress-title', title);
                var errBox = $id('u-error');
                errBox.style.display = run.error ? '' : 'none';
                errBox.textContent = run.error ? ('Failed at "' + (run.failure_stage || '?') + '": ' + run.error + (run.rollback && run.rollback.attempted ? ' Rollback: ' + run.rollback.result + '.' : '')) : '';
            }

            function renderHistory() {
                var body = $id('u-history');
                body.innerHTML = '';
                (state.history || []).forEach(function (run) {
                    var tr = document.createElement('tr');
                    [run.started_at.replace('T', ' ').replace(/\+.*$/, ''), run.from_version, run.to_version, run.result || run.state].forEach(function (value) {
                        var td = document.createElement('td');
                        td.textContent = value;
                        tr.appendChild(td);
                    });
                    var td = document.createElement('td');
                    var a = document.createElement('a');
                    a.href = '#';
                    a.textContent = 'log';
                    a.onclick = function (e) { e.preventDefault(); showLog(run.id); };
                    td.appendChild(a);
                    tr.appendChild(td);
                    body.appendChild(tr);
                });
            }

            function showLog(id) {
                request('GET', urls.run + '/' + id).then(function (res) {
                    if (!res.ok) { return; }
                    $id('u-log-box').style.display = '';
                    text('u-log-id', id);
                    text('u-log', res.body.log || '(empty)');
                });
            }

            function showError(message) {
                var box = $id('u-error');
                box.style.display = '';
                box.textContent = message;
                $id('u-progress-box').style.display = '';
            }

            function poll() {
                clearTimeout(timer);
                request('GET', urls.status).then(function (res) {
                    if (res.ok) { state = res.body; render(); }
                    else { return fallbackProgress(); }
                }).catch(fallbackProgress).then(function () {
                    if (state.active) { timer = setTimeout(poll, 2000); }
                });
            }

            // While the Panel is in maintenance mode only the public progress endpoint answers.
            function fallbackProgress() {
                return fetch(urls.progress, { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (p) {
                    renderRun({ steps: p.steps.map(function (s) { return { label: s.label, status: s.status }; }), to_version: state.active ? state.active.to_version : '', state: p.state, result: p.result });
                    if (!p.active) { setTimeout(function () { location.reload(); }, 1500); }
                }).catch(function () {});
            }

            $id('u-check').onclick = function () {
                var button = this;
                button.disabled = true;
                request('POST', urls.check).then(function (res) {
                    if (res.ok) { state.latest = res.body; render(); }
                    else { showError(res.status === 429 ? 'Please wait a moment before checking again.' : 'The check failed.'); }
                }).then(function () { button.disabled = false; });
            };

            $id('u-update').onclick = function () {
                var latest = state.latest && state.latest.release;
                if (!latest || !confirm('Install ' + latest.version + '? The Panel will be in maintenance mode while it updates.')) { return; }
                this.disabled = true;
                fetch(urls.start, { method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf }, body: JSON.stringify({ version: latest.version }) })
                    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
                    .then(function (res) {
                        if (!res.ok) { showError(res.body.error || 'The update could not be started.'); render(); return; }
                        state.active = res.body.run;
                        render();
                        poll();
                    });
            };

            render();
            if (state.active) { poll(); }
        })();
    </script>
@endsection
