@extends('layouts.admin')

@section('title')
    Overview
@endsection

@section('content-header')
    <h1>Overview<small>Infrastructure at a glance.</small></h1>
    <ol class="breadcrumb">
        <li><a href="{{ route('admin.index') }}">Dashboard</a></li>
        <li class="active">Overview</li>
    </ol>
@endsection

@section('content')
    <div class="gb-stats gb-stats-lg">
        @foreach($counts as $card)
            <a class="gb-stat" href="{{ route($card['route']) }}">
                <span class="gb-stat-icon"><i class="fa {{ $card['icon'] }}" aria-hidden="true"></i></span>
                <span><span class="gb-num">{{ number_format($card['value']) }}</span><span class="gb-label">{{ $card['label'] }}</span><span class="gb-note">{{ $card['note'] }}</span></span>
            </a>
        @endforeach
    </div>

    <div class="gb-section-title">Resources across all nodes <small class="gb-muted" id="gb-updated"></small></div>
    <div class="gb-gauges gb-gauges-lg" id="gb-global">
        <div class="gb-muted">Loading node statistics&hellip;</div>
    </div>

    <div class="gb-section-title">Nodes</div>
    <div class="gb-nodes" id="gb-nodes"></div>
@endsection

@section('footer-scripts')
    @parent
    <script>
        (function () {
            var url = @json(route('admin.stats.nodes'));
            var nodeUrl = @json(url('/admin/nodes/view'));
            var GB = 1073741824;

            function el(tag, cls, text) { var e = document.createElement(tag); if (cls) { e.className = cls; } if (text !== undefined) { e.textContent = text; } return e; }
            function size(bytes) { if (bytes === null || bytes === undefined) { return 'n/a'; } return bytes >= GB ? (bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1) + ' GB' : Math.round(bytes / 1048576) + ' MB'; }
            function pct(part, whole) { return whole > 0 && part !== null ? Math.min(100, part / whole * 100) : null; }
            function cap(p) { return p === null ? null : Math.min(100, p); }
            function level(p) { return p === null ? '' : p >= 90 ? 'crit' : p >= 75 ? 'warn' : ''; }

            // One resource: a ring for what is promised to instances (allocation) and, separately, a bar for what is
            // really being used right now. The two are never mixed.
            function gauge(title, percent, headline, caption, rows, live) {
                var box = el('div', 'gb-gauge');
                var r = 52, c = 2 * Math.PI * r, p = percent === null ? 0 : percent;
                var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 128 128');
                svg.setAttribute('role', 'img');
                svg.setAttribute('aria-label', title + (percent === null ? ' unavailable' : ' ' + Math.round(percent) + ' percent'));
                [['gb-ring-bg', null], ['gb-ring-fg ' + level(percent), p]].forEach(function (spec) {
                    var ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    ring.setAttribute('class', spec[0]);
                    ring.setAttribute('cx', 64); ring.setAttribute('cy', 64); ring.setAttribute('r', r);
                    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke-width', 12); ring.setAttribute('stroke-linecap', 'round');
                    if (spec[1] !== null) { ring.setAttribute('stroke-dasharray', (c * spec[1] / 100) + ' ' + c); ring.setAttribute('transform', 'rotate(-90 64 64)'); }
                    svg.appendChild(ring);
                });
                var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('class', 'gb-ring-text'); label.setAttribute('x', 64); label.setAttribute('y', 64);
                label.textContent = percent === null ? 'n/a' : Math.round(percent) + '%';
                svg.appendChild(label);
                var top = el('div', 'gb-gauge-top');
                top.appendChild(svg);
                var body = el('div', 'gb-gauge-body');
                body.appendChild(el('h4', null, title));
                body.appendChild(el('div', 'gb-gauge-value', headline));
                body.appendChild(el('div', 'gb-gauge-caption', caption));
                top.appendChild(body);
                box.appendChild(top);
                var dl = el('dl');
                rows.forEach(function (row) { var d = el('div'); d.appendChild(el('dt', null, row[0])); d.appendChild(el('dd', null, row[1])); dl.appendChild(d); });
                box.appendChild(dl);
                if (live) { box.appendChild(meter('Live usage', live[0], live[1], live[2])); }
                return box;
            }

            function meter(label, used, total, text) {
                var m = el('div', 'gb-meter'), head = el('div', 'gb-meter-head');
                head.appendChild(el('span', null, label)); head.appendChild(el('span', null, text));
                m.appendChild(head);
                var p = pct(used, total), bar = el('div', 'gb-bar'), fill = el('span', level(p));
                fill.style.width = (p === null ? 0 : p) + '%';
                bar.appendChild(fill); m.appendChild(bar);
                return m;
            }

            function render(data) {
                var g = data.global, box = document.getElementById('gb-global');
                box.innerHTML = '';
                var liveText = function (v, total) { return v === null ? 'unavailable' : size(v) + (total ? ' (' + Math.round(pct(v, total)) + '%)' : ''); };
                box.appendChild(gauge('RAM', pct(g.ram.allocated, g.ram.total), size(g.ram.allocated), 'allocated of ' + size(g.ram.total), [['Available to allocate', size(Math.max(0, g.ram.total - g.ram.allocated))], ['In use now', liveText(g.ram.used, g.ram.total)]], [g.ram.used, g.ram.total, g.ram.used === null ? 'unavailable' : size(g.ram.used) + ' / ' + size(g.ram.total)]));
                box.appendChild(gauge('Storage', pct(g.storage.allocated, g.storage.total), size(g.storage.allocated), 'allocated of ' + size(g.storage.total), [['Available to allocate', size(Math.max(0, g.storage.total - g.storage.allocated))], ['In use now', liveText(g.storage.used, g.storage.total)]], [g.storage.used, g.storage.total, g.storage.used === null ? 'unavailable' : size(g.storage.used) + ' / ' + size(g.storage.total)]));
                box.appendChild(gauge('CPU', cap(g.cpu.percent), g.cpu.percent === null ? 'n/a' : g.cpu.percent + '%', 'live utilisation', [['Nodes reporting', g.cpu.nodes_reporting + ' of ' + g.nodes.total], ['Weighting', 'by core count']], null));
                box.appendChild(gauge('Instances', g.instances.running === null ? null : pct(g.instances.running, g.instances.total), g.instances.running === null ? 'n/a' : g.instances.running + ' running', 'of ' + g.instances.total + ' instances', [['Nodes online', g.nodes.online + ' of ' + g.nodes.total], ['Nodes offline', String(g.nodes.offline)]], null));
                document.getElementById('gb-updated').textContent = '- updated ' + new Date(data.generated_at).toLocaleTimeString();

                var list = document.getElementById('gb-nodes');
                list.innerHTML = '';
                if (!data.nodes.length) { list.appendChild(el('div', 'gb-muted', 'No nodes have been created yet.')); }
                data.nodes.forEach(function (n) {
                    var offline = n.status === 'offline';
                    var card = el('div', 'gb-node is-' + n.status), head = el('header'), title = el('div');
                    var a = el('a', null, n.name); a.href = nodeUrl + '/' + n.id;
                    title.appendChild(a); title.appendChild(el('div', 'gb-sub', (n.location ? n.location + ' - ' : '') + n.fqdn));
                    head.appendChild(title); head.appendChild(el('span', 'gb-badge ' + n.status, n.status));
                    card.appendChild(head);
                    var facts = el('dl', 'gb-node-facts');
                    [['Instances', n.instances + (n.instances_running !== null && n.instances_running !== undefined ? ' (' + n.instances_running + ' running)' : '')],
                     ['Allocations', n.allocations.used + ' / ' + n.allocations.total],
                     ['Wings', n.version ? n.version : 'n/a']].forEach(function (row) { var d = el('div'); d.appendChild(el('dt', null, row[0])); d.appendChild(el('dd', null, row[1])); facts.appendChild(d); });
                    card.appendChild(facts);
                    card.appendChild(meter('RAM live', n.ram.used, n.ram.total, offline ? 'offline' : (n.ram.used === null ? 'unavailable' : size(n.ram.used) + ' / ' + size(n.ram.total))));
                    card.appendChild(meter('RAM allocated', n.ram.allocated, n.ram.total, size(n.ram.allocated) + ' / ' + size(n.ram.total)));
                    card.appendChild(meter('Storage live', n.storage.used, n.storage.total, offline ? 'offline' : (n.storage.used === null ? 'unavailable' : size(n.storage.used) + ' / ' + size(n.storage.total))));
                    card.appendChild(meter('Storage allocated', n.storage.allocated, n.storage.total, size(n.storage.allocated) + ' / ' + size(n.storage.total)));
                    card.appendChild(meter('CPU', n.cpu.percent, 100, n.cpu.percent === null ? 'unavailable' : n.cpu.percent + '%' + (n.cpu.cores ? ' of ' + n.cpu.cores + ' cores' : '')));
                    list.appendChild(card);
                });
            }

            function load() {
                if (document.hidden) { return; }
                fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
                    .then(function (r) { return r.json(); })
                    .then(render)
                    .catch(function () { document.getElementById('gb-global').textContent = 'Node statistics could not be loaded.'; });
            }
            load();
            setInterval(load, 60000);
            document.addEventListener('visibilitychange', function () { if (!document.hidden) { load(); } });
        })();
    </script>
@endsection
