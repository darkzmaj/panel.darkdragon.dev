@php
    $sections = [
        'settings' => [
            'general' => ['General', 'admin.settings'],
            'mail' => ['Mail', 'admin.settings.mail'],
            'advanced' => ['Advanced', 'admin.settings.advanced'],
            'api' => ['Application API', 'admin.api.index'],
            'updates' => ['Updates', 'admin.system.updates'],
        ],
        'nodes' => [
            'nodes' => ['Nodes', 'admin.nodes'],
            'instances' => ['Instances', 'admin.servers'],
            'locations' => ['Locations', 'admin.locations'],
        ],
        'services' => [
            'mounts' => ['Mounts', 'admin.mounts'],
            'nests' => ['Nests', 'admin.nests'],
            'databases' => ['Databases', 'admin.databases'],
        ],
    ];
@endphp
<ul class="gb-tabs" role="tablist">
    @foreach($sections[$section] as $key => [$label, $route])
        <li><a href="{{ route($route) }}" class="{{ $key === $active ? 'active' : '' }}" @if($key === $active) aria-current="page" @endif>{{ $label }}</a></li>
    @endforeach
</ul>
