@php
    $sections = [
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
    // Settings pages share one local menu on the left instead of a row of tabs.
    $settingsMenu = [
        'general' => ['General', route('admin.settings'), 'fa-cog'],
        'branding' => ['Branding', route('admin.settings.branding'), 'fa-picture-o'],
        'mail' => ['Mail', route('admin.settings.mail'), 'fa-envelope'],
        'advanced' => ['Advanced', route('admin.settings.advanced'), 'fa-wrench'],
        'api' => ['Application API', route('admin.api.index'), 'fa-code'],
        'updates' => ['Updates', route('admin.system.updates'), 'fa-cloud-download'],
    ];
@endphp
@if($section === 'settings')
    @php(view()->share('gbSubnav', true))
    <nav class="gb-subnav" aria-label="Settings">
        <p class="gb-subnav-title">Settings</p>
        @foreach($settingsMenu as $key => [$label, $href, $icon])
            <a href="{{ $href }}" class="{{ $key === $active ? 'active' : '' }}" @if($key === $active) aria-current="page" @endif>
                <i class="fa {{ $icon }}"></i> {{ $label }}
            </a>
        @endforeach
    </nav>
@else
    <ul class="gb-tabs">
        @foreach($sections[$section] as $key => [$label, $route])
            <li><a href="{{ route($route) }}" class="{{ $key === $active ? 'active' : '' }}" @if($key === $active) aria-current="page" @endif>{{ $label }}</a></li>
        @endforeach
    </ul>
@endif
