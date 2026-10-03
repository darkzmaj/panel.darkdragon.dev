@extends('layouts.admin')

@section('title')
    List Nodes
@endsection

@section('scripts')
    @parent
    {!! Theme::css('vendor/fontawesome/animation.min.css') !!}
@endsection

@section('content-header')
    <h1>Nodes<small>The machines that run your instances.</small></h1>
    <ol class="breadcrumb">
        <li><a href="{{ route('admin.index') }}">Dashboard</a></li>
        <li class="active">Nodes</li>
    </ol>
@endsection

@section('content')
    @include('partials.admin.section-tabs', ['section' => 'nodes', 'active' => 'nodes'])
@php
    // Allocated amounts are what the instances on a node reserve, set against what the node offers (with overallocation).
    $percent = fn ($used, $total) => $total > 0 ? min(100, (int) round(($used / $total) * 100)) : 0;
    $size = fn ($mib) => $mib >= 1024 ? rtrim(rtrim(number_format($mib / 1024, 1), '0'), '.') . ' GiB' : (int) $mib . ' MiB';
@endphp
<div class="row">
    <div class="col-xs-12">
        <div class="box box-primary">
            <div class="box-header with-border">
                <h3 class="box-title">Node list <small class="gb-muted">{{ $nodes->total() }} total</small></h3>
                <div class="box-tools search01">
                    <form action="{{ route('admin.nodes') }}" method="GET">
                        <div class="input-group input-group-sm">
                            <input type="text" name="filter[name]" class="form-control pull-right" value="{{ request()->input('filter.name') }}" placeholder="Search nodes" aria-label="Search nodes">
                            <div class="input-group-btn">
                                <button type="submit" class="btn btn-default" aria-label="Search"><i class="fa fa-search"></i></button>
                                <a href="{{ route('admin.nodes.new') }}" class="btn btn-sm btn-primary">Create node</a>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
            <div class="box-body table-responsive no-padding">
                <table class="table table-hover gb-node-table">
                    <thead>
                        <tr>
                            <th style="width:56px;">Status</th>
                            <th>Node</th>
                            <th>Location</th>
                            <th class="text-center">Instances</th>
                            <th>Memory</th>
                            <th>Storage</th>
                            <th>CPU</th>
                            <th class="text-center">Allocations</th>
                            <th>Routing</th>
                            <th style="width:48px;"></th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($nodes as $node)
                            @php
                                $memoryCap = $node->memory * (1 + $node->memory_overallocate / 100);
                                $diskCap = $node->disk * (1 + $node->disk_overallocate / 100);
                                $memoryPct = $percent($node->allocated_memory, $memoryCap);
                                $diskPct = $percent($node->allocated_disk, $diskCap);
                            @endphp
                            <tr>
                                <td class="text-center text-muted" data-action="ping" data-secret="{{ $node->getDecryptedKey() }}" data-location="{{ $node->scheme }}://{{ $node->fqdn }}:{{ $node->daemonListen }}/api/system"><i class="fa fa-fw fa-refresh fa-spin"></i><span class="sr-only">Checking</span></td>
                                <td>
                                    <a href="{{ route('admin.nodes.view', $node->id) }}"><strong>{{ $node->name }}</strong></a>
                                    <div class="small gb-muted">{{ $node->fqdn }}:{{ $node->daemonListen }}</div>
                                </td>
                                <td>{{ $node->location->short }}</td>
                                <td class="text-center"><a href="{{ route('admin.servers', ['filter[node_id]' => $node->id]) }}">{{ $node->servers_count }}</a></td>
                                <td style="min-width:150px;">
                                    <div class="gb-bar-meter {{ $memoryPct >= 90 ? 'danger' : ($memoryPct >= 75 ? 'warn' : '') }}" role="progressbar" aria-label="Memory allocated on {{ $node->name }}" aria-valuenow="{{ $memoryPct }}" aria-valuemin="0" aria-valuemax="100"><div style="width:{{ $memoryPct }}%"></div></div>
                                    <div class="small gb-muted">{{ $size($node->allocated_memory ?? 0) }} of {{ $size($node->memory) }}@if($node->memory_overallocate > 0) (+{{ $node->memory_overallocate }}%)@endif</div>
                                </td>
                                <td style="min-width:150px;">
                                    <div class="gb-bar-meter {{ $diskPct >= 90 ? 'danger' : ($diskPct >= 75 ? 'warn' : '') }}" role="progressbar" aria-label="Storage allocated on {{ $node->name }}" aria-valuenow="{{ $diskPct }}" aria-valuemin="0" aria-valuemax="100"><div style="width:{{ $diskPct }}%"></div></div>
                                    <div class="small gb-muted">{{ $size($node->allocated_disk ?? 0) }} of {{ $size($node->disk) }}@if($node->disk_overallocate > 0) (+{{ $node->disk_overallocate }}%)@endif</div>
                                </td>
                                <td>
                                    @if(($node->allocated_cpu ?? 0) > 0)
                                        {{ (int) $node->allocated_cpu }}%
                                        <div class="small gb-muted">allocated</div>
                                    @else
                                        <span class="gb-muted">{{ $node->servers_count > 0 ? 'Unlimited' : '-' }}</span>
                                    @endif
                                </td>
                                <td class="text-center"><a href="{{ route('admin.nodes.view.allocation', $node->id) }}">{{ $node->allocations_used_count }} / {{ $node->allocations_count }}</a></td>
                                <td>
                                    @if($node->maintenance_mode)<span class="label label-warning">Maintenance</span>@endif
                                    <span class="label {{ $node->scheme === 'https' ? 'label-success' : 'label-danger' }}" title="{{ $node->scheme === 'https' ? 'Connections to this node use TLS.' : 'Connections to this node are not encrypted.' }}">{{ $node->scheme === 'https' ? 'TLS' : 'No TLS' }}</span>
                                    <span class="label label-default">{{ $node->public ? 'Public' : 'Private' }}</span>
                                </td>
                                <td class="text-right">
                                    <button type="button" class="gb-admin-menu" data-gb-menu aria-label="Actions for {{ $node->name }}" aria-haspopup="menu" aria-expanded="false"><i class="fa fa-ellipsis"></i></button>
                                    <div class="gb-dropdown-menu" role="menu" hidden>
                                        <a role="menuitem" href="{{ route('admin.nodes.view', $node->id) }}"><i class="fa fa-eye"></i> Overview</a>
                                        <a role="menuitem" href="{{ route('admin.nodes.view.settings', $node->id) }}"><i class="fa fa-wrench"></i> Settings</a>
                                        <a role="menuitem" href="{{ route('admin.nodes.view.allocation', $node->id) }}"><i class="fa fa-sitemap"></i> Allocations</a>
                                        <a role="menuitem" href="{{ route('admin.servers', ['filter[node_id]' => $node->id]) }}"><i class="fa fa-server"></i> Instances</a>
                                    </div>
                                </td>
                            </tr>
                        @empty
                            <tr><td colspan="10" class="text-center gb-muted" style="padding:28px;">No nodes yet. Create one to start hosting instances.</td></tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
            @if($nodes->hasPages())
                <div class="box-footer with-border">
                    <div class="col-md-12 text-center">{!! $nodes->appends(['query' => Request::input('query')])->render() !!}</div>
                </div>
            @endif
        </div>
    </div>
</div>
@endsection

@section('footer-scripts')
    @parent
    <script>
    (function pingNodes() {
        $('td[data-action="ping"]').each(function(i, element) {
            $.ajax({
                type: 'GET',
                url: $(element).data('location'),
                headers: {
                    'Authorization': 'Bearer ' + $(element).data('secret'),
                },
                timeout: 5000
            }).done(function (data) {
                $(element).find('i').tooltip({
                    title: 'Online, daemon v' + data.version,
                });
                $(element).removeClass('text-muted').find('i').removeClass().addClass('fa fa-fw fa-heartbeat faa-pulse animated').css('color', 'rgb(var(--gb-success))');
            }).fail(function (error) {
                var errorText = 'Error connecting to node! Check browser console for details.';
                try {
                    errorText = error.responseJSON.errors[0].detail || errorText;
                } catch (ex) {}

                $(element).removeClass('text-muted').find('i').removeClass().addClass('fa fa-fw fa-heart-o').css('color', 'rgb(var(--gb-danger))');
                $(element).find('i').tooltip({ title: errorText });
            });
        }).promise().done(function () {
            setTimeout(pingNodes, 10000);
        });
    })();
    </script>
@endsection
