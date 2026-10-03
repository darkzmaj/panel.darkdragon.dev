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
    <div class="gb-stats">
        @foreach($counts as $card)
            <a class="gb-stat" href="{{ route($card['route']) }}">
                <i class="fa fa-fw {{ $card['icon'] }}" aria-hidden="true"></i>
                <span><span class="gb-num">{{ number_format($card['value']) }}</span><span class="gb-label">{{ $card['label'] }}</span></span>
            </a>
        @endforeach
    </div>

    <div class="gb-section-title">Resources across all nodes <small class="gb-muted" id="gb-updated"></small></div>
    <div class="gb-gauges" id="gb-global">
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
            function level(p) { return p === null ? '' : p >= 90 ? 'crit' : p >= 75 ? 'warn' : ''; }

            function gauge(title, percent, rows) {
                var box = el('div', 'gb-gauge');
                var r = 32, c = 2 * Math.PI * r, p = percent === null ? 0 : percent;
                var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 80 80');
                svg.setAttribute('role', 'img');
                svg.setAttribute('aria-label', title + (percent === null ? ' unavailable' : ' ' + Math.round(percent) + ' percent'));
                [['gb-ring-bg', null], ['gb-ring-fg ' + level(percent), p]].forEach(function (spec) {
                    var ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    ring.setAttribute('class', spec[0]);
                    ring.setAttribute('cx', 40); ring.setAttribute('cy', 40); ring.setAttribute('r', r);
                    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke-width', 8);
                    if (spec[1] !== null) { ring.setAttribute('stroke-dasharray', (c * spec[1] / 100) + ' ' + c); ring.setAttribute('transform', 'rotate(-90 40 40)'); }
                    svg.appendChild(ring);
                });
                var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('class', 'gb-ring-text'); label.setAttribute('x', 40); label.setAttribute('y', 40);
                label.textContent = percent === null ? 'n/a' : Math.round(percent) + '%';
                svg.appendChild(label);
                box.appendChild(svg);
                var body = el('div'); body.appendChild(el('h4', null, title));
                var dl = el('dl');
                rows.forEach(function (row) { var d = el('div'); d.appendChild(el('dt', null, row[0])); d.appendChild(el('dd', null, row[1])); dl.appendChild(d); });
                body.appendChild(dl); box.appendChild(body);
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
                var live = function (v, total) { return v === null ? 'unavailable' : size(v) + (total ? ' (' + Math.round(pct(v, total)) + '%)' : ''); };
                box.appendChild(gauge('RAM', pct(g.ram.allocated, g.ram.total), [['Total', size(g.ram.total)], ['Allocated', size(g.ram.allocated)], ['Available', size(Math.max(0, g.ram.total - g.ram.allocated))], ['In use now', live(g.ram.used, g.ram.total)]]));
                box.appendChild(gauge('Storage', pct(g.storage.allocated, g.storage.total), [['Total', size(g.storage.total)], ['Allocated', size(g.storage.allocated)], ['Available', size(Math.max(0, g.storage.total - g.storage.allocated))], ['In use now', live(g.storage.used, g.storage.total)]]));
                box.appendChild(gauge('CPU', g.cpu.percent, [['Utilization', g.cpu.percent === null ? 'unavailable' : g.cpu.percent + '%'], ['Nodes reporting', g.cpu.nodes_reporting + ' of ' + g.nodes.total], ['Weighting', 'by core count']]));
                box.appendChild(gauge('Instances', g.instances.running === null ? null : pct(g.instances.running, g.instances.total), [['Total', String(g.instances.total)], ['Running', g.instances.running === null ? 'unavailable' : String(g.instances.running)], ['Nodes online', g.nodes.online + ' of ' + g.nodes.total], ['Offline', String(g.nodes.offline)]]));
                document.getElementById('gb-updated').textContent = '- updated ' + new Date(data.generated_at).toLocaleTimeString();

                var list = document.getElementById('gb-nodes');
                list.innerHTML = '';
                if (!data.nodes.length) { list.appendChild(el('div', 'gb-muted', 'No nodes have been created yet.')); }
                data.nodes.forEach(function (n) {
                    var card = el('div', 'gb-node is-' + n.status), head = el('header'), title = el('div');
                    var a = el('a', null, n.name); a.href = nodeUrl + '/' + n.id;
                    title.appendChild(a); title.appendChild(el('div', 'gb-sub', (n.location ? n.location + ' - ' : '') + n.fqdn));
                    head.appendChild(title); head.appendChild(el('span', 'gb-badge ' + n.status, n.status));
                    card.appendChild(head);
                    card.appendChild(el('div', 'gb-sub', n.instances + ' instance' + (n.instances === 1 ? '' : 's') + (n.instances_running !== null && n.instances_running !== undefined ? ', ' + n.instances_running + ' running' : '') + ' - ' + n.allocations.used + '/' + n.allocations.total + ' allocations' + (n.version ? ' - Wings ' + n.version : '')));
                    var offline = n.status === 'offline';
                    card.appendChild(meter('RAM', offline ? n.ram.allocated : n.ram.used, n.ram.total, (offline ? 'allocated ' + size(n.ram.allocated) : size(n.ram.used)) + ' / ' + size(n.ram.total)));
                    card.appendChild(meter('Storage', offline ? n.storage.allocated : n.storage.used, n.storage.total, (offline ? 'allocated ' + size(n.storage.allocated) : size(n.storage.used)) + ' / ' + size(n.storage.total)));
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
